# WePledge — Crowdfunding descentralizado com vesting por tempo

Projeto desenvolvido para o desafio **TrustCode (Smart Contracts)** do **Hackweb — RESTIC 29**.

## Problema

Plataformas tradicionais de crowdfunding dependem de um intermediário para custodiar os fundos e garantir o reembolso caso a meta não seja atingida. Não há mecanismo que impeça o criador de receber tudo de uma vez e abandonar o projeto. O resultado é necessidade de confiança em terceiros, taxas de 5–10% e barreiras geográficas.

## Solução

WePledge é uma plataforma de crowdfunding descentralizada onde todas as regras são executadas por um smart contract, sem intermediário. O modelo é todo-ou-nada: se a meta não for atingida no prazo, os contribuintes recebem reembolso garantido por código. Se for atingida, os fundos são liberados ao criador em parcelas por tempo (vesting), reduzindo o risco de abandono. Se o criador não iniciar o vesting dentro da janela definida, qualquer pessoa pode marcar a campanha como abandonada e liberar os reembolsos.

## Público e contexto

Criadores de projetos que precisam captar recursos de forma transparente e contribuintes que querem garantia contratual de reembolso ou de liberação gradual dos fundos — sem depender de uma plataforma centralizada.

## Web3 no projeto

- O smart contract em Solidity é a única camada de regras: captação, reembolso, vesting e proteção contra abandono são executados on-chain, sem backend proprietário.
- Os fundos ficam custodiados pelo próprio contrato até as condições serem atendidas; nenhuma parte consegue movê-los fora das regras definidas.
- O frontend conecta-se ao contrato via Ethers.js v6 usando a carteira do próprio usuário (MetaMask), sem servidor intermediário.
- Todo o histórico de contribuições, saques e eventos é público e auditável na blockchain.

## Fluxo principal

```
Captacao → (meta atingida + criador finaliza) → EmVesting → (tranches sacadas) → Concluida
Captacao → (prazo expirado, meta não atingida) → Fracassada → reembolsos disponíveis
Captacao → (criador some, janela expirada)     → Fracassada → reembolsos disponíveis
```

## Estrutura

```
contracts/
  WePledge.sol              Contrato principal
scripts/
  deploy.ts                 Deploy do contrato (produção ou modo demo)
  seed.ts                   Seed de demonstração: cria campanha, contribui, finaliza e saca
deployments/
  sepolia.json              Endereço e parâmetros do último deploy na Sepolia (gerado pelo deploy.ts)
test/
  helpers/
    deploy.ts               Fixture e constantes compartilhadas
    time.ts                 Helpers de manipulação de tempo
  criar-campanha.test.ts    criarCampanha e constructor
  contribuir.test.ts        contribuir
  vesting.test.ts           finalizarCampanha e sacarTranche
  fracasso-reembolso.test.ts  marcarFracasso e reembolsar
  abandono.test.ts          marcarAbandono
frontend/                   Interface web (Next.js + Ethers.js v6) — em desenvolvimento
```

## Como executar

### Pré-requisitos

- Node.js 18+
- npm 9+
- MetaMask (para interação com a Sepolia)

### Instalar dependências

```bash
npm install
```

### Compilar contratos

```bash
npx hardhat compile
```

### Rodar testes

```bash
npm test
```

Com relatório de gas:

```bash
npm run test:gas
```

### Deploy na Sepolia

Copie `.env.example` para `.env` e preencha as variáveis:

```bash
cp .env.example .env
```

**Modo demo** — janelas curtas (2 min finalização / 5 min abandono) para apresentação ao vivo:

```bash
DEMO=true npx hardhat run scripts/deploy.ts --network sepolia
```

**Modo produção** — janelas longas (7 dias / 30 dias):

```bash
npm run deploy:sepolia
```

O endereço e os parâmetros do deploy são salvos em `deployments/sepolia.json`.

### Seed de demonstração

Após o deploy, cria uma campanha, contribui até a meta, finaliza e saca a primeira tranche:

```bash
npm run seed:sepolia
```

A segunda tranche (40%, disponível após 60 s) fica pendente para demonstração manual ou via frontend.

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `SEPOLIA_RPC_URL` | URL RPC da Sepolia (Alchemy ou Infura) |
| `PRIVATE_KEY` | Chave privada da carteira de deploy (sem `0x`) |
| `ETHERSCAN_API_KEY` | API key para verificação automática no Etherscan |
| `DEMO` | `true` para usar janelas curtas no deploy (padrão: produção) |

## Tecnologias

- **Solidity 0.8.24** com checked arithmetic nativa
- **Hardhat** para desenvolvimento, testes e deploy
- **OpenZeppelin** (`ReentrancyGuard`)
- **Ethers.js v6** + **TypeScript** para scripts e testes
- **Next.js** para o frontend (em desenvolvimento)
- **Sepolia testnet** para deploy público

## Requisitos mínimos do desafio

- [x] Contrato deployado
- [x] Fluxo demonstrável
- [x] README funcional
- [ ] Vídeo-pitch

## Equipe

- Anderson Santos da Silva
