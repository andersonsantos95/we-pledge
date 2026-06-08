# WePledge — Crowdfunding descentralizado com vesting por tempo

Projeto desenvolvido para o desafio **TrustCode (Smart Contracts)** do **Hackweb — RESTIC 29**.

## Problema

Plataformas tradicionais de crowdfunding (Kickstarter, Indiegogo) atuam como intermediários centrais que seguram o dinheiro dos apoiadores. Contribuintes precisam confiar que a plataforma devolverá o dinheiro se a meta não for atingida, que não bloqueará saques arbitrariamente, e que o criador não receberá tudo de uma vez e sumirá.

Esses problemas geram desconfiança, barreiras geográficas e taxas altas (5–10% do total arrecadado).

## Solução

**WePledge** é uma plataforma de crowdfunding descentralizado implementada como smart contract na Ethereum (Sepolia testnet). O contrato garante matematicamente o modelo todo-ou-nada e libera os fundos ao criador em parcelas por tempo (vesting), sem depender de intermediário.

**Diferenciais:**
- Reembolso garantido por código se a meta não for atingida
- Liberação gradual via vesting por tempo, reduzindo risco de abandono pelo criador
- Janela de proteção: se o criador não inicia o vesting dentro do prazo, contribuintes recuperam o aporte
- Sem taxas de plataforma (apenas gas das transações)
- Auditável publicamente: histórico completo na blockchain

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
    time.ts                 Helpers de manipulação de tempo nos testes
  01-criar.test.ts          Fase 1: criarCampanha
  02-captacao.test.ts       Fase 2: contribuir
  03-vesting.test.ts        Fase 3: finalizarCampanha e sacarTranche
  04-fracasso-reembolso.test.ts  Fase 4: marcarFracasso e reembolsar
  05-abandono.test.ts       Fase 5: marcarAbandono
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
