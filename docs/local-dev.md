# Ambiente local de desenvolvimento — WePledge

Guia para subir o contrato e o frontend inteiramente na sua máquina, sem precisar de ETH real ou de conexão com a Sepolia.

---

## Como funciona

O Hardhat sobe um nó Ethereum emulado em `http://127.0.0.1:8545`. Ele cria 20 carteiras pré-carregadas com 10.000 ETH de teste cada. O contrato é deployado nesse nó local e o MetaMask é configurado para apontar para ele.

```
┌─────────────┐        ┌──────────────────────┐        ┌───────────┐
│  Frontend   │  RPC   │  Hardhat Node        │        │ MetaMask  │
│  :4200      │◄──────►│  127.0.0.1:8545      │◄──────►│ (browser) │
└─────────────┘        │  chainId: 31337      │        └───────────┘
                       │  20 contas de teste  │
                       └──────────────────────┘
```

---

## Pré-requisitos

- Node.js 20+
- MetaMask instalado no navegador
- Dependências instaladas (`npm install` na raiz e em `frontend/`)

---

## Passo 1 — Subir o nó Hardhat

Abra um terminal e deixe-o rodando durante todo o desenvolvimento:

```bash
npx hardhat node
```

A saída mostra 20 contas com suas chaves privadas:

```
Account #0: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (10000 ETH)
Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

Account #1: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 (10000 ETH)
Private Key: 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
...
```

> Essas chaves são públicas e conhecidas — use-as **apenas** para testes locais.

---

## Passo 2 — Deploy do contrato

Em um **segundo terminal**, na raiz do projeto:

```bash
# Modo demo (janelas curtas: 2 min / 5 min) — recomendado para testes locais
DEMO=true npx hardhat run scripts/deploy.ts --network localhost
```

Anote o endereço impresso na saída:

```
✓  WePledge deployado
   Endereço : 0x5FbDB2315678afecb367f032d93F642f64180aa3
```

O endereço também é salvo em `deployments/localhost.json` (gitignored).

---

## Passo 3 — Configurar o MetaMask

### 3.1 Adicionar a rede local

No MetaMask: **Configurações → Redes → Adicionar rede → Adicionar rede manualmente**

| Campo | Valor |
|---|---|
| Nome da rede | Hardhat Local |
| URL do RPC | `http://127.0.0.1:8545` |
| ID da rede (chainId) | `31337` |
| Símbolo da moeda | `ETH` |

### 3.2 Importar uma conta de teste

No MetaMask: **Selecionar conta → Importar conta → Chave privada**

Cole a chave da `Account #0` (ou qualquer outra do Passo 1):
```
0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

> Importe pelo menos duas contas para testar fluxos de criador + contribuinte.

---

## Passo 4 — Configurar o frontend

Edite `frontend/src/environments/environment.ts` com o endereço do Passo 2:

```typescript
export const environment = {
  production: false,
  contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',  // endereço local
  networkName: 'localhost',
  chainId: 31337,
  publicRpcUrl: 'http://127.0.0.1:8545',
};
```

> **Não commite esta alteração.** Use `git stash` antes de commitar e `git stash pop` para retomar.

---

## Passo 5 — Subir o frontend

Em um **terceiro terminal**:

```bash
cd frontend
npm start
```

Acesse `http://localhost:4200` no navegador com MetaMask aberto na rede **Hardhat Local**.

---

## Passo 6 — Popular com dados de teste (opcional)

Para criar uma campanha de exemplo automaticamente, em um quarto terminal:

```bash
npm run seed:local
```

Isso executa o fluxo completo: cria campanha → contribui → finaliza → saca primeira tranche.

> Verifique se `scripts/seed.ts` aponta para `localhost` ou ajuste o script de npm em `package.json`:
> ```json
> "seed:local": "hardhat run scripts/seed.ts --network localhost"
> ```

---

## Reiniciando o nó

Toda vez que o `npx hardhat node` é parado e reiniciado, **o estado da blockchain é zerado** — contratos, transações e saldos são perdidos. É necessário repetir os Passos 2 e 4.

O MetaMask armazena o nonce das contas localmente e pode ficar dessincronizado. Se transações ficarem pendentes para sempre:

MetaMask → Configurações → Avançado → **Limpar dados de atividade e nonce**

---

## Resumo dos terminais

| Terminal | Comando | Fica rodando? |
|---|---|---|
| 1 | `npx hardhat node` | Sim |
| 2 | `DEMO=true npx hardhat run scripts/deploy.ts --network localhost` | Não (executa uma vez) |
| 3 | `cd frontend && npm start` | Sim |
| 4 | `npm run seed:local` (opcional) | Não (executa uma vez) |

---

## Diferenças entre ambientes

| | Local | Sepolia | Mainnet |
|---|---|---|---|
| ETH necessário | Não (gerado pelo Hardhat) | Sim (faucet gratuito) | Sim (ETH real) |
| Velocidade dos blocos | Instantâneo | ~12 segundos | ~12 segundos |
| Estado persiste? | Não (apagado ao reiniciar) | Sim | Sim |
| Custo de gas | Zero | Zero | ETH real |
| Versão/release | Nenhuma | `v1.0.0-rc.1` (prerelease) | `v1.0.0` |
