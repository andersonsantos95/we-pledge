# Glossário — WePledge

Referência dos termos técnicos usados no projeto, organizados por área.

---

## Blockchain e EVM

**Blockchain**
Banco de dados distribuído e imutável onde cada bloco contém um conjunto de transações validadas. Nenhuma entidade central controla o histórico — ele é replicado por milhares de nós independentes.

**EVM (Ethereum Virtual Machine)**
Máquina virtual que executa smart contracts na rede Ethereum. Todo nó da rede roda a mesma EVM, garantindo que o mesmo código produz o mesmo resultado em qualquer lugar do mundo.

**Nó (node)**
Computador que participa da rede Ethereum mantendo uma cópia do histórico de blocos e validando transações.

**Bloco**
Agrupamento de transações confirmadas. Cada bloco referencia o anterior, formando a cadeia. Na Sepolia, um novo bloco é produzido a cada ~12 segundos.

**Transação (tx)**
Operação enviada à blockchain: transferência de ETH, chamada de função de contrato, deploy de contrato. Toda transação custa gas e é assinada pela chave privada do remetente.

**Gas**
Unidade de medida do esforço computacional de uma transação. Cada opcode da EVM tem um custo em gas. O remetente paga `gas_usado × gas_price` em ETH pelo processamento.

**Wei**
Menor unidade do ETH. `1 ETH = 10^18 wei`. Todos os valores monetários no contrato WePledge são denominados em wei.

**Gwei**
`1 Gwei = 10^9 wei`. Usado para expressar preços de gas (`gasPrice`).

**Endereço (address)**
Identificador de 20 bytes (40 caracteres hexadecimais) que representa uma carteira ou contrato na rede. Exemplo: `0x742d35Cc6634C0532925a3b8D4C9C0B3e5d3f2a1`.

**Chave privada**
Número secreto de 256 bits que prova propriedade de um endereço. Quem tem a chave privada controla todos os fundos e pode assinar transações em nome daquele endereço. **Nunca deve ser compartilhada.**

**Carteira (wallet)**
Interface que gerencia chaves privadas e assina transações. No WePledge, o usuário usa o MetaMask como carteira no navegador.

---

## Smart Contracts

**Smart Contract**
Programa imutável deployado na blockchain. Suas funções executam exatamente como escritas — sem possibilidade de alteração posterior pelo autor ou por terceiros. No WePledge, o contrato `WePledge.sol` controla todo o fluxo de captação, vesting e reembolso.

**Solidity**
Linguagem de programação orientada a objetos usada para escrever smart contracts na EVM. O WePledge usa Solidity 0.8.24.

**ABI (Application Binary Interface)**
Dicionário que descreve as funções, parâmetros, tipos de retorno e eventos de um contrato. O frontend usa o ABI para saber como serializar chamadas em bytes antes de enviá-las à rede. Sem o ABI correto, o frontend não consegue se comunicar com o contrato.

**Bytecode**
Resultado da compilação do Solidity — sequência de instruções que a EVM executa. É o que realmente fica armazenado na blockchain após o deploy.

**Deploy**
Ato de publicar um smart contract na blockchain. Gera um endereço único e permanente para o contrato. No WePledge, o deploy é feito via `scripts/deploy.ts`.

**Constructor**
Função especial executada uma única vez no momento do deploy. No WePledge, recebe `JANELA_FINALIZACAO`, `JANELA_ABANDONO`, `MAX_TRANCHES` e `MAX_PRAZO_CAPTACAO`.

**Função `view` / `pure`**
Funções que apenas leem dados da blockchain sem modificar estado. Não custam gas quando chamadas diretamente (fora de uma transação).

**Função `payable`**
Função que pode receber ETH junto com a chamada. No WePledge, apenas `contribuir()` é payable.

**`msg.sender`**
Endereço de quem chamou a função no contexto atual. Usado para verificar autorização (ex: `require(msg.sender == c.criador)`).

**`msg.value`**
Quantidade de ETH (em wei) enviada junto com a chamada a uma função payable.

**`block.timestamp`**
Timestamp Unix do bloco atual em segundos. Usado no WePledge para verificar prazos de captação, janelas de finalização e disponibilidade de tranches.

**Evento (event)**
Log imutável emitido pelo contrato durante a execução de uma transação. Não custa gas para leitura posterior. O WePledge emite eventos como `CampanhaCriada`, `Contribuicao`, `MetaAtingida` para que o frontend acompanhe o estado sem fazer múltiplas chamadas RPC.

**Revert**
Quando uma transação falha (ex: um `require` não é satisfeito), todas as alterações de estado são desfeitas e o gas já consumido é cobrado. O chamador recebe uma mensagem de erro.

**`require`**
Instrução Solidity que valida uma condição. Se falsa, a transação reverte com a mensagem fornecida. Ex: `require(meta_ > 0, "WePledge: meta deve ser positiva")`.

---

## Padrões de segurança

**CEI (Checks-Effects-Interactions)**
Padrão de organização de funções: primeiro validações (`require`), depois alterações de estado, por último chamadas externas. Evita que re-entrada (reentrancy) explore estado inconsistente.

**Reentrância (reentrancy)**
Ataque onde um contrato malicioso chama de volta a função do contrato-vítima antes que ela termine de executar, explorando estado ainda não atualizado. O WePledge usa CEI + `nonReentrant` como defesas em camadas.

**`nonReentrant`**
Modificador do OpenZeppelin `ReentrancyGuard` que impede que uma função seja chamada novamente enquanto ainda está em execução. Aplicado em `sacarTranche` e `reembolsar`.

**Pull payment**
Padrão onde o beneficiário chama ativamente a função de saque em vez do contrato empurrar o pagamento. Elimina ponto único de falha de um loop de pagamentos e escala para qualquer número de participantes.

**Atomicidade**
Propriedade da EVM: ou toda a transação é executada com sucesso, ou nenhuma alteração de estado persiste. Se um `require` falha após alterações, tudo é revertido — incluindo os efeitos que já haviam sido escritos.

---

## Vesting e modelo financeiro

**Vesting**
Liberação gradual de fundos ao longo do tempo conforme um cronograma pré-definido. No WePledge, o criador define no momento da criação da campanha quantas parcelas (tranches) receberá e quando cada uma estará disponível.

**Tranche**
Parcela do cronograma de vesting. Cada tranche tem um percentual do total arrecadado e um tempo (em segundos após o início do vesting) a partir do qual pode ser sacada.

**Meta (goal)**
Valor mínimo em ETH que a campanha precisa arrecadar para ser considerada bem-sucedida. Se não atingida no prazo, contribuintes recebem reembolso.

**Modelo todo-ou-nada**
Se a meta não for atingida até o prazo de captação, nenhum valor é liberado ao criador — tudo fica disponível para reembolso. Só há liberação de fundos se `valorArrecadado >= meta`.

**Overfunding**
Situação em que a campanha continua recebendo contribuições após a meta ser atingida. O WePledge permite overfunding — o excedente também vai ao criador via tranches.

**Prazo de captação**
Timestamp Unix após o qual novas contribuições não são aceitas. Definido pelo criador na criação da campanha.

**Janela de finalização (`JANELA_FINALIZACAO`)**
Período exclusivo do criador após o prazo de captação para chamar `finalizarCampanha()` e iniciar o vesting. Expirado sem ação do criador, abre-se a janela de abandono.

**Janela de abandono (`JANELA_ABANDONO`)**
Período após a janela de finalização em que qualquer endereço pode chamar `marcarAbandono()`, liberando reembolsos caso o criador tenha desaparecido mesmo com a meta atingida.

---

## Infraestrutura e ferramentas

**RPC (Remote Procedure Call)**
Protocolo de comunicação entre o frontend e um nó Ethereum. O frontend envia chamadas JSON-RPC para ler dados ou submeter transações. No WePledge, o `ContractService` usa um RPC público da Sepolia para leitura sem carteira.

**Hardhat**
Framework de desenvolvimento Ethereum usado no projeto para compilar contratos, rodar testes locais e executar scripts de deploy.

**Ethers.js**
Biblioteca JavaScript/TypeScript para interagir com a EVM. O frontend usa a versão 6 com `BrowserProvider` (MetaMask) e `JsonRpcProvider` (leitura pública).

**MetaMask**
Extensão de navegador que funciona como carteira Ethereum. Injeta o objeto `window.ethereum` na página, permitindo que o frontend solicite assinaturas e envio de transações ao usuário.

**Sepolia**
Rede de testes (testnet) do Ethereum usada no WePledge. Possui ETH de teste gratuito obtido via faucets e funciona identicamente à mainnet para fins de desenvolvimento.

**Faucet**
Serviço que distribui ETH de teste gratuitamente em testnets. Usado para obter ETH na Sepolia antes do deploy.

**Etherscan**
Explorador de blocos da rede Ethereum. Permite visualizar transações, saldos, código-fonte verificado e eventos de qualquer contrato. O WePledge exibe links para `sepolia.etherscan.io` após o deploy.

**Typechain**
Plugin do Hardhat que gera tipos TypeScript a partir do ABI, permitindo chamadas ao contrato com autocompletar e verificação de tipos em tempo de compilação.

**OpenZeppelin**
Biblioteca de contratos Solidity auditados e amplamente utilizados. O WePledge usa `ReentrancyGuard` do OpenZeppelin para proteção contra ataques de reentrância.
