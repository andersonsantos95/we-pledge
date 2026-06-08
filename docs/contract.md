# Referência do Contrato — WePledge

## Parâmetros do constructor

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `janelaFinalizacao_` | `uint256` | Segundos após `prazoCaptacao` em que só o criador pode finalizar |
| `janelaAbandono_` | `uint256` | Segundos após `janelaFinalizacao_` em que qualquer um pode marcar abandono |
| `maxTranches_` | `uint8` | Número máximo de tranches por campanha (recomendado: 5) |
| `maxPrazoCaptacao_` | `uint256` | Duração máxima de captação em segundos (recomendado: 31.536.000 = 1 ano) |

---

## Variáveis de estado públicas

| Nome | Tipo | Descrição |
|---|---|---|
| `JANELA_FINALIZACAO` | `uint256 immutable` | Janela exclusiva do criador após o prazo |
| `JANELA_ABANDONO` | `uint256 immutable` | Janela pública de abandono após a janela do criador |
| `MAX_TRANCHES` | `uint8 immutable` | Limite de tranches por campanha |
| `MAX_PRAZO_CAPTACAO` | `uint256 immutable` | Duração máxima de captação |
| `campanhas` | `mapping(uint256 => Campanha)` | Dados de cada campanha por id |
| `saldoContribuido` | `mapping(uint256 => mapping(address => uint256))` | Saldo por (campanha, contribuinte) |
| `proximoId` | `uint256` | Próximo id a ser atribuído (começa em 1; id 0 é sentinela) |

---

## Structs

### `Campanha`

| Campo | Tipo | Descrição |
|---|---|---|
| `criador` | `address` | Endereço do criador da campanha |
| `meta` | `uint256` | Valor mínimo em wei para considerar a campanha bem-sucedida |
| `prazoCaptacao` | `uint256` | Timestamp Unix após o qual contribuições não são aceitas |
| `valorArrecadado` | `uint256` | Total em wei recebido via `contribuir()` |
| `valorJaSacado` | `uint256` | Acumulador das tranches já transferidas ao criador |
| `dataInicioVesting` | `uint256` | Timestamp de quando o vesting começou (0 até `finalizarCampanha`) |
| `estado` | `EstadoCampanha` | Estado atual na máquina de estados |
| `cronograma` | `Tranche[]` | Parcelas de vesting definidas na criação |

### `Tranche`

| Campo | Tipo | Descrição |
|---|---|---|
| `percentual` | `uint8` | % do total a liberar nesta parcela (1–100) |
| `tempoAposVesting` | `uint256` | Segundos após `dataInicioVesting` para a tranche ficar disponível |
| `sacada` | `bool` | `true` após o criador sacar esta parcela |

### `TrancheInput` (apenas entrada)

| Campo | Tipo | Descrição |
|---|---|---|
| `percentual` | `uint8` | % desta parcela |
| `tempoAposVesting` | `uint256` | Segundos após início do vesting |

---

## Funções

### `criarCampanha`
```solidity
function criarCampanha(
    uint256 meta_,
    uint256 prazoCaptacao_,
    TrancheInput[] calldata cronograma_
) external returns (uint256 id)
```
Cria uma nova campanha. Valida: `meta_ > 0`, prazo futuro dentro de `MAX_PRAZO_CAPTACAO`, cronograma não vazio e dentro de `MAX_TRANCHES`, percentuais somam 100, tempos estritamente crescentes, cada percentual > 0.

---

### `contribuir`
```solidity
function contribuir(uint256 idCampanha) external payable
```
Deposita ETH em uma campanha em captação. Aceita contribuições até `block.timestamp <= prazoCaptacao`. Overfunding é permitido.

---

### `finalizarCampanha`
```solidity
function finalizarCampanha(uint256 idCampanha) external
```
Exclusivo do criador. Disponível quando `valorArrecadado >= meta` e estado é `Captacao`. Transiciona para `EmVesting` e registra `dataInicioVesting = block.timestamp`.

---

### `sacarTranche`
```solidity
function sacarTranche(uint256 idCampanha) external nonReentrant
```
Exclusivo do criador. Saca a próxima tranche não sacada do cronograma, se `block.timestamp >= dataInicioVesting + tranche.tempoAposVesting`. A última tranche usa `valorArrecadado - valorJaSacado` para absorver dust de divisão inteira. Transiciona para `Concluida` ao sacar a última.

---

### `marcarFracasso`
```solidity
function marcarFracasso(uint256 idCampanha) external
```
Qualquer endereço pode chamar quando `block.timestamp > prazoCaptacao` e `valorArrecadado < meta`. Transiciona para `Fracassada`.

---

### `marcarAbandono`
```solidity
function marcarAbandono(uint256 idCampanha) external
```
Qualquer endereço pode chamar quando `block.timestamp > prazoCaptacao + JANELA_FINALIZACAO + JANELA_ABANDONO` e `valorArrecadado >= meta`. Transiciona para `Fracassada`.

---

### `reembolsar`
```solidity
function reembolsar(uint256 idCampanha) external nonReentrant
```
Pull payment: o contribuinte resgata seu saldo em campanha `Fracassada`. Zera o saldo antes da transferência (CEI).

---

### `getCronograma`
```solidity
function getCronograma(uint256 id) external view returns (Tranche[] memory)
```
Retorna o array completo de tranches. Necessário porque o getter automático do mapping não expõe arrays dinâmicos dentro de structs.

---

### `getTotalTranches`
```solidity
function getTotalTranches(uint256 id) external view returns (uint256)
```
Retorna o número de tranches de uma campanha.

---

## Eventos

| Evento | Quando emitido |
|---|---|
| `CampanhaCriada(id, criador, meta, prazoCaptacao, cronograma)` | Criação bem-sucedida |
| `Contribuicao(id, contribuinte, valor)` | Cada aporte via `contribuir()` |
| `MetaAtingida(id, valorTotal, timestamp)` | Apenas no bloco em que `valorArrecadado` cruza a meta |
| `CampanhaFinalizada(id, valorArrecadado, dataInicioVesting)` | Início do vesting |
| `TrancheLiberada(id, numeroDaTranche, valor)` | Cada saque de tranche |
| `CampanhaConcluida(id)` | Última tranche sacada |
| `CampanhaFracassada(id, valorArrecadado)` | Fracasso por meta não atingida |
| `CampanhaAbandonada(id)` | Fracasso por abandono do criador |
| `Reembolso(id, contribuinte, valor)` | Cada reembolso individual |

---

## Erros (mensagens de `require`)

| Mensagem | Função | Condição |
|---|---|---|
| `WePledge: campanha inexistente` | Todas | `campanhas[id].criador == address(0)` |
| `WePledge: meta deve ser positiva` | `criarCampanha` | `meta_ == 0` |
| `WePledge: prazo deve ser no futuro` | `criarCampanha` | `prazoCaptacao_ <= block.timestamp` |
| `WePledge: prazo excede MAX_PRAZO_CAPTACAO` | `criarCampanha` | `prazoCaptacao_ - block.timestamp > MAX_PRAZO_CAPTACAO` |
| `WePledge: cronograma vazio` | `criarCampanha` | `cronograma_.length == 0` |
| `WePledge: muitas tranches` | `criarCampanha` | `cronograma_.length > MAX_TRANCHES` |
| `WePledge: percentual deve ser positivo` | `criarCampanha` | `cronograma_[i].percentual == 0` |
| `WePledge: tempos devem ser estritamente crescentes` | `criarCampanha` | `tempoAposVesting[i] <= tempoAposVesting[i-1]` |
| `WePledge: percentuais devem somar 100` | `criarCampanha` | `somaPercentuais != 100` |
| `WePledge: campanha nao esta em captacao` | Várias | `estado != Captacao` |
| `WePledge: prazo de captacao expirou` | `contribuir` | `block.timestamp > prazoCaptacao` |
| `WePledge: contribuicao deve ser positiva` | `contribuir` | `msg.value == 0` |
| `WePledge: apenas o criador pode finalizar` | `finalizarCampanha` | `msg.sender != criador` |
| `WePledge: meta nao atingida` | `finalizarCampanha` | `valorArrecadado < meta` |
| `WePledge: apenas o criador pode sacar` | `sacarTranche` | `msg.sender != criador` |
| `WePledge: campanha nao esta em vesting` | `sacarTranche` | `estado != EmVesting` |
| `WePledge: tranche ainda nao disponivel` | `sacarTranche` | `block.timestamp < dataInicioVesting + tempoAposVesting` |
| `WePledge: prazo nao expirou` | `marcarFracasso` | `block.timestamp <= prazoCaptacao` |
| `WePledge: meta foi atingida` | `marcarFracasso` | `valorArrecadado >= meta` |
| `WePledge: meta nao foi atingida` | `marcarAbandono` | `valorArrecadado < meta` |
| `WePledge: janela de abandono nao expirou` | `marcarAbandono` | `block.timestamp <= prazoCaptacao + JF + JA` |
| `WePledge: campanha nao esta fracassada` | `reembolsar` | `estado != Fracassada` |
| `WePledge: sem saldo para reembolso` | `reembolsar` | `saldoContribuido == 0` |
| `WePledge: transferencia falhou` | `sacarTranche`, `reembolsar` | `call` retornou `false` |
| `WePledge: use contribuir()` | `receive()` | ETH enviado diretamente ao contrato |
