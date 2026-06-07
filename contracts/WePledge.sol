// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title WePledge — Crowdfunding descentralizado com vesting por tempo
/// @notice Plataforma de crowdfunding onde as regras de captação e liberação de fundos
///         são executadas por smart contract, sem intermediário central. A meta é todo-ou-nada:
///         se não for atingida, contribuintes recebem reembolso garantido por código.
///         Se for atingida, os fundos são liberados ao criador em parcelas por tempo (vesting),
///         reduzindo o risco de "criador some com o dinheiro".
/// @dev Herda ReentrancyGuard da OpenZeppelin para proteção em profundidade nas funções
///      que transferem ETH (sacarTranche e reembolsar). criarCampanha e contribuir não
///      precisam do modifier porque não realizam chamadas externas (contribuir só recebe ETH).
///
///      Máquina de estados:
///        Captacao → EmVesting → Concluida
///        Captacao → Fracassada
///      Transições são explícitas: nenhuma transição ocorre "automaticamente" —
///      blockchain não tem scheduler, alguém sempre paga o gas da transição.
contract WePledge is ReentrancyGuard {

    // ─────────────────────────────────────────────────────────────────────────
    // Tipos
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Estado atual de uma campanha na máquina de estados.
    /// @dev Enum preferível a constantes uint256 porque o compilador valida
    ///      exaustividade em switch/if-else, torna transições legíveis no código
    ///      e no ABI, e ocupa apenas uint8 no storage (4 valores → 2 bits, mas
    ///      Solidity alinha em uint8 — ainda assim menor que uint256).
    enum EstadoCampanha {
        Captacao,   // Janela de captação aberta; aceita contribuições.
        EmVesting,  // Meta atingida, criador finalizou; tranches sendo liberadas.
        Concluida,  // Todas as tranches sacadas; campanha encerrada com sucesso.
        Fracassada  // Meta não atingida no prazo, ou criador abandonou; reembolsos disponíveis.
    }

    /// @notice Parcela do cronograma de vesting.
    /// @dev `percentual` usa uint8 (range 0–255) porque o domínio é 1–100; cabe
    ///      com folga e é empacotado com `sacada` (bool = 1 byte) no mesmo slot de
    ///      32 bytes, economizando SSTORE quando ambos são escritos juntos.
    ///      `tempoAposVesting` é uint256 porque representa segundos Unix; uint32
    ///      transbordaria em 2106, e o custo de armazenar uint256 vs uint32 em slot
    ///      isolado é idêntico (32 bytes por slot de qualquer forma).
    ///      `sacada` é bool em vez de bitmap porque há no máximo MAX_TRANCHES tranches
    ///      por campanha (≤5); o overhead de um bitmap não compensa a complexidade.
    struct Tranche {
        uint8 percentual;           // Percentual do total a liberar nesta parcela (1–100).
        uint256 tempoAposVesting;   // Segundos após dataInicioVesting em que a tranche fica disponível.
        bool sacada;                // Protege contra duplo-saque; marcada true em sacarTranche.
    }

    /// @notice Parâmetros de entrada para definir uma tranche na criação da campanha.
    /// @dev Separado de Tranche para que chamadores não precisem especificar `sacada = false`
    ///      explicitamente. O contrato inicializa `sacada` sempre como false em criarCampanha.
    ///      Isso também previne que um chamador tente criar uma campanha com tranches
    ///      pré-marcadas como sacadas — campo não existe no input.
    struct TrancheInput {
        uint8 percentual;
        uint256 tempoAposVesting;
    }

    /// @notice Dados completos de uma campanha.
    /// @dev `criador` é `address` (não `address payable`) porque pagamentos usam
    ///      `call{value}("")` que aceita plain address; manter payable no storage seria
    ///      desnecessário e poderia confundir leitores sobre onde ETH é transferido.
    ///
    ///      Todos os valores monetários (meta, valorArrecadado, valorJaSacado) são uint256
    ///      porque são denominados em wei. uint128 caberia (max ≈ 3,4 × 10^20 wei ≈
    ///      340 bilhões de ETH), mas uint256 é o tipo nativo da EVM — operações em
    ///      tipos menores exigem mascaramento extra e não economizam gas em slots isolados.
    ///
    ///      `valorJaSacado` é armazenado (em vez de calculado iterando o cronograma) porque:
    ///      (1) leitura e escrita em uma variável é O(1) vs O(n) no array; (2) facilita
    ///      calcular o valor da última tranche como `valorArrecadado - valorJaSacado`
    ///      sem reprocessar o cronograma; (3) simplifica testes (assert direto no campo).
    ///
    ///      `Tranche[]` como array dinâmico dentro do struct é necessário porque o número
    ///      de tranches varia por campanha. mapping seria O(1) por índice mas exigiria
    ///      armazenar o comprimento separadamente e não seria iterável sem índice externo.
    struct Campanha {
        address criador;
        uint256 meta;
        uint256 prazoCaptacao;      // Timestamp absoluto após o qual contribuições encerram.
        uint256 valorArrecadado;
        uint256 valorJaSacado;      // Acumulador: soma das tranches já transferidas ao criador.
        uint256 dataInicioVesting;  // 0 até finalizarCampanha; define t=0 do cronograma.
        EstadoCampanha estado;
        Tranche[] cronograma;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Eventos
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Emitido quando uma campanha é criada com sucesso.
    /// @dev `id` e `criador` são indexed para que o frontend possa filtrar campanhas
    ///      por criador sem varrer todos os eventos. `cronograma` é incluído no evento
    ///      para que o frontend reconstitua o cronograma sem precisar chamar getCronograma
    ///      (economiza chamadas RPC na listagem de campanhas).
    event CampanhaCriada(
        uint256 indexed id,
        address indexed criador,
        uint256 meta,
        uint256 prazoCaptacao,
        Tranche[] cronograma
    );

    /// @notice Emitido a cada contribuição individual.
    /// @dev `id` e `contribuinte` indexed permitem filtrar "quais campanhas este endereço apoiou"
    ///      e "quem contribuiu para esta campanha" com eficiência via eth_getLogs.
    event Contribuicao(uint256 indexed id, address indexed contribuinte, uint256 valor);

    /// @notice Emitido no instante exato em que a meta é cruzada pela primeira vez.
    /// @dev Não representa mudança de estado — "meta atingida" é fato derivado
    ///      (valorArrecadado >= meta), não estado armazenado. O evento serve como
    ///      marcação histórica auditável: "neste bloco, a meta foi cruzada".
    ///      Overfunding não emite este evento novamente.
    event MetaAtingida(uint256 indexed id, uint256 valorTotal, uint256 timestamp);

    /// @notice Emitido quando o criador finaliza a campanha e inicia o vesting.
    event CampanhaFinalizada(uint256 indexed id, uint256 valorArrecadado, uint256 dataInicioVesting);

    /// @notice Emitido a cada tranche sacada pelo criador.
    /// @dev `numeroDaTranche` é uint8 (índice base-0 no cronograma) para correlação
    ///      com o cronograma definido em CampanhaCriada.
    event TrancheLiberada(uint256 indexed id, uint8 numeroDaTranche, uint256 valor);

    /// @notice Emitido quando a última tranche é sacada e a campanha encerra com sucesso.
    event CampanhaConcluida(uint256 indexed id);

    /// @notice Emitido quando a campanha é marcada como fracassada por não atingir a meta no prazo.
    event CampanhaFracassada(uint256 indexed id, uint256 valorArrecadado);

    /// @notice Emitido quando a campanha é marcada como abandonada após a janela de finalização.
    /// @dev Distinto de CampanhaFracassada: aqui a meta FOI atingida, mas o criador
    ///      não finalizou dentro da janela. Estado terminal é o mesmo (Fracassada),
    ///      mas o motivo é diferente e auditável via evento.
    event CampanhaAbandonada(uint256 indexed id);

    /// @notice Emitido a cada reembolso individual de contribuinte.
    event Reembolso(uint256 indexed id, address indexed contribuinte, uint256 valor);

    // ─────────────────────────────────────────────────────────────────────────
    // Parâmetros imutáveis
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Janela exclusiva do criador após prazoCaptacao para finalizar campanha bem-sucedida.
    /// @dev `immutable`: definido no constructor, lido de bytecode (não de storage).
    ///      Mais barato que variável de estado (sem SLOAD) e mais flexível que `constant`
    ///      (que exige literal no código-fonte, impossibilitando configuração no deploy).
    ///      Produção sugerida: 7 dias. Demo: 2 minutos.
    uint256 public immutable JANELA_FINALIZACAO;

    /// @notice Janela após JANELA_FINALIZACAO durante a qual qualquer um pode marcar abandono.
    /// @dev A soma (prazoCaptacao + JANELA_FINALIZACAO + JANELA_ABANDONO) define o timestamp
    ///      a partir do qual marcarAbandono fica disponível.
    ///      Produção sugerida: 30 dias. Demo: 5 minutos.
    uint256 public immutable JANELA_ABANDONO;

    /// @notice Número máximo de tranches por campanha.
    /// @dev uint8 porque o valor típico é ≤ 10; economiza gas no loop de validação.
    ///      Limitar a MAX_TRANCHES evita: (1) loops muito caros em sacarTranche/deploy;
    ///      (2) campanhas spam com cronogramas gigantes que inflam storage.
    ///      Valor sugerido: 5.
    uint8 public immutable MAX_TRANCHES;

    /// @notice Prazo máximo de captação em segundos a partir de block.timestamp na criação.
    /// @dev Impede campanhas com prazo de anos/décadas que ocupariam storage indefinidamente
    ///      sem possibilidade de marcação de fracasso por um tempo muito longo.
    ///      Valor sugerido: 365 dias (31_536_000 segundos).
    uint256 public immutable MAX_PRAZO_CAPTACAO;

    // ─────────────────────────────────────────────────────────────────────────
    // Storage principal
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Mapa de campanhas por id.
    /// @dev mapping(uint256 => Campanha) preferível a Campanha[] porque:
    ///      (1) acesso O(1) por id sem iterar; (2) id nunca é reordenado ou removido;
    ///      (3) array dinâmico de structs com sub-arrays seria caro em push/acesso.
    ///      O getter automático retorna os campos escalares; cronograma requer getCronograma().
    mapping(uint256 => Campanha) public campanhas;

    /// @notice Saldo contribuído por (campanha, endereço) para pull-payment refund.
    /// @dev Nested mapping em vez de array dentro de Campanha porque:
    ///      (1) acesso O(1) por endereço, independente do número de contribuintes;
    ///      (2) array exigiria iterar todos os contribuintes para encontrar um — O(n);
    ///      (3) isola storage de contribuintes do storage da campanha, sem slot collision.
    ///      Pull payment: cada contribuinte chama reembolsar() e paga o próprio gas.
    ///      Batch refund foi rejeitado: escala mal (excederia gas limit do bloco em
    ///      campanhas com muitos contribuintes) e cria ponto único de falha.
    mapping(uint256 => mapping(address => uint256)) public saldoContribuido;

    /// @notice Próximo id de campanha a ser atribuído.
    /// @dev Começa em 1: id 0 fica reservado como sentinela "campanha inexistente",
    ///      permitindo validações do tipo `require(c.criador != address(0))` sem
    ///      precisar de um campo explícito `existe`.
    ///      uint256 porque IDs crescem monotonicamente; overflow seria absurdo mas
    ///      Solidity 0.8+ reverteria de qualquer forma (checked arithmetic).
    uint256 public proximoId;

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Inicializa o contrato com os parâmetros operacionais imutáveis.
    /// @dev Validações no constructor são preferíveis a descobrir configuração inválida
    ///      na primeira campanha: falha rápida e explícita no deploy.
    ///      proximoId começa em 1 explicitamente (storage default é 0, mas a intenção
    ///      de "id 0 = sentinela" deve ser documentada no código, não assumida do default).
    /// @param janelaFinalizacao_ Segundos após prazoCaptacao em que só o criador pode finalizar.
    /// @param janelaAbandono_ Segundos após janelaFinalizacao_ em que qualquer um pode marcar abandono.
    /// @param maxTranches_ Máximo de tranches por campanha (recomendado: 5).
    /// @param maxPrazoCaptacao_ Prazo máximo de captação em segundos (recomendado: 31_536_000).
    constructor(
        uint256 janelaFinalizacao_,
        uint256 janelaAbandono_,
        uint8 maxTranches_,
        uint256 maxPrazoCaptacao_
    ) {
        require(janelaFinalizacao_ > 0, "WePledge: janelaFinalizacao deve ser positiva");
        require(janelaAbandono_ > 0,    "WePledge: janelaAbandono deve ser positiva");
        require(maxTranches_ > 0,       "WePledge: maxTranches deve ser positivo");
        require(maxPrazoCaptacao_ > 0,  "WePledge: maxPrazoCaptacao deve ser positivo");

        JANELA_FINALIZACAO = janelaFinalizacao_;
        JANELA_ABANDONO    = janelaAbandono_;
        MAX_TRANCHES       = maxTranches_;
        MAX_PRAZO_CAPTACAO = maxPrazoCaptacao_;

        // id 0 reservado como sentinela; campanhas reais começam em 1.
        proximoId = 1;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fase 1 — Criação de campanha
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Cria uma nova campanha de crowdfunding com meta, prazo e cronograma de vesting.
    /// @dev `external` em vez de `public`: criarCampanha não é chamada internamente por
    ///      nenhuma outra função do contrato; external é marginalmente mais barato porque
    ///      os parâmetros calldata não são copiados para memory.
    ///      Não é `payable`: o criador não deposita ETH ao criar — apenas define parâmetros.
    ///      ETH entra via contribuir(), não aqui.
    ///
    ///      A inicialização da Campanha usa storage pointer + push individual no cronograma
    ///      porque Solidity não permite copiar memory struct com dynamic array para storage
    ///      diretamente (memory-to-storage copy de dynamic arrays requer push explícito).
    ///
    /// @param meta_ Valor mínimo em wei para a campanha ser considerada bem-sucedida. Deve ser > 0.
    /// @param prazoCaptacao_ Timestamp absoluto Unix após o qual contribuições não são aceitas.
    ///                       Deve ser estritamente maior que block.timestamp na criação,
    ///                       e no máximo block.timestamp + MAX_PRAZO_CAPTACAO.
    /// @param cronograma_ Tranches de vesting. Percentuais devem somar 100.
    ///                    Tempos devem ser estritamente crescentes (primeiro pode ser 0).
    /// @return id Identificador único da campanha criada (começa em 1).
    function criarCampanha(
        uint256 meta_,
        uint256 prazoCaptacao_,
        TrancheInput[] calldata cronograma_
    ) external returns (uint256 id) {
        // ── CHECKS ────────────────────────────────────────────────────────────
        // Invariante: meta positiva.
        // Campanha com meta 0 seria trivialmente "bem-sucedida" antes de qualquer
        // contribuição, e finalizarCampanha poderia ser chamado imediatamente com
        // valorArrecadado = 0, transferindo nada ao criador via tranches — inútil.
        require(meta_ > 0, "WePledge: meta deve ser positiva");

        // Invariante: prazo estritamente no futuro.
        // prazoCaptacao_ == block.timestamp significaria captação encerrada imediatamente
        // (require em contribuir usa <=, então prazo expirado no mesmo bloco).
        // prazoCaptacao_ < block.timestamp seria passado; subtração na próxima linha
        // reverteria por underflow, mas validamos explicitamente para mensagem clara.
        require(prazoCaptacao_ > block.timestamp, "WePledge: prazo deve ser no futuro");

        // Invariante: prazo dentro do limite máximo.
        // Subtração segura: prazoCaptacao_ > block.timestamp garantido acima.
        // Impede campanhas com prazo de décadas que ocupariam storage indefinidamente.
        require(
            prazoCaptacao_ - block.timestamp <= MAX_PRAZO_CAPTACAO,
            "WePledge: prazo excede MAX_PRAZO_CAPTACAO"
        );

        // Invariante: cronograma não vazio.
        // Sem tranches, o contrato nunca transferiria ETH ao criador — fundos ficariam
        // presos após finalizarCampanha, o que violaria a garantia de distribuição total.
        require(cronograma_.length > 0, "WePledge: cronograma vazio");

        // Invariante: número de tranches dentro do limite.
        // Evita loops caros em gas durante sacarTranche e previne campanhas spam
        // com cronogramas gigantes. MAX_TRANCHES é imutável, definido no deploy.
        require(cronograma_.length <= MAX_TRANCHES, "WePledge: muitas tranches");

        // Validação do cronograma: percentuais, unicidade de tempos.
        // Loop único: valida percentual, ordem e acumula soma — O(n) com n ≤ MAX_TRANCHES.
        uint256 somaPercentuais;
        for (uint256 i = 0; i < cronograma_.length; i++) {
            // Invariante: percentual positivo por tranche.
            // Tranche com percentual 0 não libera nada e infla o array sem utilidade.
            require(cronograma_[i].percentual > 0, "WePledge: percentual deve ser positivo");

            // Invariante: tempos estritamente crescentes.
            // Duas tranches com o mesmo tempoAposVesting criam ambiguidade sobre qual
            // é a "próxima tranche" em sacarTranche (que identifica a próxima não-sacada
            // por índice, não por tempo). Tempo decrescente seria logicamente incoerente.
            // i == 0 não tem predecessor; comparação começa em i == 1.
            if (i > 0) {
                require(
                    cronograma_[i].tempoAposVesting > cronograma_[i - 1].tempoAposVesting,
                    "WePledge: tempos devem ser estritamente crescentes"
                );
            }

            somaPercentuais += cronograma_[i].percentual;
        }

        // Invariante: percentuais somam exatamente 100.
        // Garante que 100% do valorArrecadado será distribuído ao criador via tranches:
        // nem dust preso no contrato, nem tentativa de saque além do arrecadado.
        // Verificado após o loop para um único require (em vez de checar overflow incremental).
        require(somaPercentuais == 100, "WePledge: percentuais devem somar 100");

        // ── EFFECTS ───────────────────────────────────────────────────────────
        // Atribuir id e incrementar contador atomicamente antes de qualquer escrita
        // no storage de campanhas. proximoId começa em 1; id 0 é sentinela.
        id = proximoId++;

        // Inicializar via storage pointer: necessário porque Solidity não suporta
        // copiar memory struct com dynamic array para storage em uma única atribuição.
        // Campos numéricos (valorArrecadado, valorJaSacado, dataInicioVesting) não são
        // escritos explicitamente — storage default é 0, equivalente ao estado inicial.
        Campanha storage c = campanhas[id];
        c.criador       = msg.sender;
        c.meta          = meta_;
        c.prazoCaptacao = prazoCaptacao_;
        c.estado        = EstadoCampanha.Captacao;
        // c.valorArrecadado = 0  (default)
        // c.valorJaSacado   = 0  (default)
        // c.dataInicioVesting = 0 (default; preenchido em finalizarCampanha)

        for (uint256 i = 0; i < cronograma_.length; i++) {
            c.cronograma.push(Tranche({
                percentual:        cronograma_[i].percentual,
                tempoAposVesting:  cronograma_[i].tempoAposVesting,
                sacada:            false  // sempre false na criação; atualizado em sacarTranche
            }));
        }

        // ── INTERACTIONS ──────────────────────────────────────────────────────
        // Nenhuma transferência de ETH nesta função. Emitir evento é efeito externo
        // observável, mas não executa código de terceiros — sem risco de reentrância.
        // Emitimos c.cronograma (storage) para incluir o campo `sacada` na ABI do evento,
        // consistente com o tipo Tranche usado no restante do contrato.
        emit CampanhaCriada(id, msg.sender, meta_, prazoCaptacao_, c.cronograma);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fase 2 — Contribuição
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Permite que qualquer endereço aporte ETH em uma campanha durante a captação.
    /// @dev `payable` porque recebe ETH diretamente via msg.value. O contribuinte paga
    ///      o gas da própria contribuição — design intencional, consistente com pull-payment
    ///      no reembolso (cada um paga pelo próprio movimento de fundos).
    ///      `external` porque não há chamada interna; calldata mais barata que memory.
    ///      Não usa `nonReentrant` porque não realiza chamadas externas — apenas recebe ETH
    ///      e atualiza storage. Reentrância nesta função exigiria que msg.sender fosse um
    ///      contrato que chamasse de volta contribuir durante a execução, o que é impossível
    ///      pois não há nenhuma call de saída aqui.
    ///
    ///      Overfunding é permitido: contribuições continuam aceitas após a meta ser atingida,
    ///      enquanto o prazo não expirou e o criador não finalizou. O excedente vai ao criador
    ///      via tranches (percentual × valorArrecadado total).
    ///
    /// @param idCampanha Identificador da campanha. Deve corresponder a uma campanha existente
    ///                   em estado Captacao com prazo ainda válido.
    function contribuir(uint256 idCampanha) external payable {
        Campanha storage c = campanhas[idCampanha];

        // ── CHECKS ────────────────────────────────────────────────────────────
        // Ordem de validações: existência primeiro (curto-circuito barato — lê apenas
        // um campo do storage), depois estado, depois timestamp (SLOAD vs BLOCKTIMESTAMP),
        // depois valor. Esta ordem minimiza gas desperdiçado em chamadas inválidas.

        // Invariante: campanha existe.
        // address(0) é o valor default de storage — se criador é zero, o id nunca foi criado.
        // Sentinela mais barato que um mapping(uint256 => bool) separado ou campo `existe`.
        require(c.criador != address(0), "WePledge: campanha inexistente");

        // Invariante: campanha em captacao.
        // Rejeita contribuições em campanhas já finalizadas (EmVesting, Concluida, Fracassada).
        // Protege contra contribuir após finalizarCampanha — ETH ficaria "perdido" no contrato
        // sem mecanismo de resgate (saldo não seria contabilizado em reembolso nem em vesting).
        require(c.estado == EstadoCampanha.Captacao, "WePledge: campanha nao esta em captacao");

        // Invariante: prazo não expirado.
        // Usa <= (inclusivo): contribuições são aceitas até o segundo exato do prazoCaptacao.
        // Complementar a marcarFracasso que exige block.timestamp > prazoCaptacao (estrito).
        // Assim, no bloco exato do prazo: contribuir aceita, marcarFracasso rejeita —
        // sem sobreposição ambígua no mesmo bloco.
        require(block.timestamp <= c.prazoCaptacao, "WePledge: prazo de captacao expirou");

        // Invariante: contribuição positiva.
        // msg.value == 0 não altera estado mas consumiria gas e emitiria evento enganoso.
        require(msg.value > 0, "WePledge: contribuicao deve ser positiva");

        // ── EFFECTS ───────────────────────────────────────────────────────────
        // Capturar valorArrecadado ANTES da atualização para detectar cruzamento da meta.
        // Necessário porque MetaAtingida deve ser emitido apenas no instante do cruzamento,
        // não em contribuições subsequentes (overfunding).
        uint256 valorAnterior = c.valorArrecadado;

        // Atualizar saldo individual para suportar pull-payment refund em Fracassada.
        // += em vez de = para acumular contribuições múltiplas do mesmo endereço.
        saldoContribuido[idCampanha][msg.sender] += msg.value;

        // Atualizar total arrecadado. Overflow impossível na prática (uint256 max ≈
        // 1.15 × 10^59 ETH) e impossível na teoria (Solidity 0.8+ reverte em overflow).
        c.valorArrecadado += msg.value;

        // ── INTERACTIONS ──────────────────────────────────────────────────────
        // Emitir eventos é a única "interação" desta função — não executa código externo,
        // portanto não há vetor de reentrância. Emitimos após os EFFECTS por consistência
        // com CEI, para que qualquer listener veja o estado já atualizado.
        emit Contribuicao(idCampanha, msg.sender, msg.value);

        // MetaAtingida: emitido apenas no instante exato em que a meta é cruzada.
        // "Meta atingida" é fato derivado (valorArrecadado >= meta), não estado armazenado.
        // Emitir o evento marca historicamente o bloco do cruzamento para auditoria.
        // Condição: valorAnterior < meta E valorAtual >= meta → primeira e única vez que cruza.
        if (valorAnterior < c.meta && c.valorArrecadado >= c.meta) {
            emit MetaAtingida(idCampanha, c.valorArrecadado, block.timestamp);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views auxiliares
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Retorna o cronograma de tranches de uma campanha.
    /// @dev O getter automático de `campanhas` (public mapping) não inclui o array
    ///      dinâmico `cronograma` — Solidity não gera getters para dynamic arrays
    ///      dentro de structs. Esta função é necessária para frontend e testes lerem
    ///      o cronograma completo em uma única chamada.
    /// @param id Identificador da campanha.
    /// @return Array de Tranche com percentual, tempoAposVesting e sacada de cada parcela.
    function getCronograma(uint256 id) external view returns (Tranche[] memory) {
        return campanhas[id].cronograma;
    }

    /// @notice Retorna o número de tranches do cronograma de uma campanha.
    /// @dev Útil para iterar o cronograma no frontend sem carregar o array inteiro.
    function getTotalTranches(uint256 id) external view returns (uint256) {
        return campanhas[id].cronograma.length;
    }
}
