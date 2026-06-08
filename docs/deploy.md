# Deploy e configuração — WePledge

## Pré-requisitos

| Requisito | Como obter |
|---|---|
| ETH de teste na Sepolia (~0.05 ETH) | [sepoliafaucet.com](https://sepoliafaucet.com) ou [faucet.sepolia.dev](https://faucet.sepolia.dev) |
| RPC URL da Sepolia | [alchemy.com](https://alchemy.com) → Create App → Ethereum Sepolia → copiar HTTPS URL |
| Chave privada da carteira de deploy | MetaMask → conta de teste → Detalhes da conta → Exportar chave privada |
| API key do Etherscan (opcional) | [etherscan.io/myapikey](https://etherscan.io/myapikey) → Create API Key |

> Use sempre uma carteira dedicada a testes. Nunca exponha a chave privada da carteira principal.

---

## 1. Configurar variáveis de ambiente

Na raiz do projeto, copie o exemplo e preencha:

```bash
cp .env.example .env
```

```env
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/SUA_CHAVE
PRIVATE_KEY=chave_privada_sem_prefixo_0x
ETHERSCAN_API_KEY=chave_etherscan_opcional
```

---

## 2. Instalar dependências

```bash
npm install
```

---

## 3. Compilar e testar

```bash
npm test                  # roda os 5 suites de testes
npx hardhat compile       # compila o contrato (gera artifacts/ e typechain-types/)
```

---

## 4. Deploy na Sepolia

```bash
# Modo demo — janelas curtas (2 min finalização / 5 min abandono)
# Recomendado para apresentação ao vivo
DEMO=true npx hardhat run scripts/deploy.ts --network sepolia

# Modo produção — janelas realistas (7 dias / 30 dias)
npx hardhat run scripts/deploy.ts --network sepolia
```

O script imprime o endereço e salva os dados em `deployments/sepolia.json`:

```json
{
  "address": "0x...",
  "network": "sepolia",
  "chainId": 11155111,
  "blockNumber": 123456,
  "deployedAt": "2026-06-08T00:00:00.000Z",
  "constructorArgs": {
    "janelaFinalizacao": 120,
    "janelaAbandono": 300,
    "maxTranches": 5,
    "maxPrazoCaptacao": 31536000
  }
}
```

---

## 5. Verificar no Etherscan (opcional)

Se `ETHERSCAN_API_KEY` estiver no `.env`, a verificação ocorre automaticamente ao final do deploy.

Para verificar manualmente depois:

```bash
npx hardhat verify --network sepolia <ENDERECO> \
  <JANELA_FINALIZACAO> <JANELA_ABANDONO> <MAX_TRANCHES> <MAX_PRAZO_CAPTACAO>

# Exemplo (modo demo):
npx hardhat verify --network sepolia 0xSEU_ENDERECO 120 300 5 31536000
```

---

## 6. Configurar o frontend

Edite `frontend/src/environments/environment.ts`:

```typescript
export const environment = {
  production: false,
  contractAddress: '0xENDERECO_DO_DEPLOY',   // copiado de deployments/sepolia.json
  networkName: 'sepolia',
  chainId: 11155111,
  publicRpcUrl: 'https://rpc2.sepolia.org',
};
```

---

## 7. Popular com dados de demonstração (opcional)

O script `seed.ts` executa o fluxo completo: cria campanha → contribui → finaliza → saca primeira tranche.

```bash
npm run seed:sepolia
```

> Requer o deploy feito anteriormente (lê o endereço de `deployments/sepolia.json`).

---

## 8. Rodar o frontend

```bash
cd frontend
npm install
npm start     # http://localhost:4200
```

---

## Parâmetros do constructor

| Parâmetro | Demo | Produção | Descrição |
|---|---|---|---|
| `JANELA_FINALIZACAO` | 120s (2 min) | 604.800s (7 dias) | Janela exclusiva do criador para finalizar após o prazo |
| `JANELA_ABANDONO` | 300s (5 min) | 2.592.000s (30 dias) | Janela pública para marcar abandono após a janela do criador |
| `MAX_TRANCHES` | 5 | 5 | Máximo de tranches por campanha |
| `MAX_PRAZO_CAPTACAO` | 31.536.000s (1 ano) | 31.536.000s (1 ano) | Duração máxima de captação |

---

## Estrutura de pastas do projeto

```
we-pledge/
├── contracts/          Contrato WePledge.sol
├── frontend/           DApp em Angular 22
├── scripts/            deploy.ts e seed.ts
├── test/               5 suites de testes com Hardhat
├── docs/               Esta documentação
├── deployments/        Arquivos JSON gerados pelo deploy (por rede)
├── assets/             Recursos estáticos (logos, diagramas)
├── hardhat.config.ts   Configuração do Hardhat (Sepolia, Etherscan, otimizador)
└── .env.example        Modelo das variáveis de ambiente necessárias
```
