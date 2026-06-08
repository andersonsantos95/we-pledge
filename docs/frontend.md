# Frontend — WePledge

## Tecnologias

- **Angular 22** — componentes standalone, signals, control flow `@if`/`@for`
- **Ethers.js v6** — `BrowserProvider` (MetaMask), `JsonRpcProvider` (leitura sem carteira)
- **TypeScript** — tipagem completa incluindo `bigint` para valores wei

---

## Pré-requisitos

- Node.js 20+
- MetaMask instalado no navegador
- Contrato deployado na Sepolia (ver [`deploy.md`](./deploy.md))

---

## Configuração

Edite `src/environments/environment.ts` com o endereço do contrato após o deploy:

```typescript
export const environment = {
  production: false,
  contractAddress: '0xSEU_ENDERECO_AQUI',
  networkName: 'sepolia',
  chainId: 11155111,
  publicRpcUrl: 'https://rpc2.sepolia.org',
};
```

> **`publicRpcUrl`** é um fallback de leitura sem MetaMask. Campanhas podem ser visualizadas por qualquer visitante; ações que escrevem na blockchain exigem carteira conectada.

---

## Rodar localmente

```bash
cd frontend
npm install
npm start        # http://localhost:4200
```

## Build de produção

```bash
npm run build    # gera dist/frontend/
```

---

## Estrutura de pastas

```
frontend/src/
├── app/
│   ├── abi/
│   │   └── wepledge.abi.ts          # ABI human-readable (ethers.js v6)
│   ├── core/
│   │   ├── models/
│   │   │   └── campaign.model.ts    # Interfaces Campaign, Tranche; enum CampaignState
│   │   └── services/
│   │       ├── wallet.service.ts    # Conexão MetaMask, signals de endereço/chainId
│   │       └── contract.service.ts  # Chamadas ao contrato (leitura e escrita)
│   ├── shared/
│   │   └── header/                  # Navbar com botão de conexão de carteira
│   ├── pages/
│   │   ├── home/                    # Lista de campanhas com progresso e badges
│   │   ├── create/                  # Formulário reativo de criação de campanha
│   │   └── campaign/                # Detalhe + ações (contribuir, finalizar, sacar, etc.)
│   ├── app.routes.ts                # Lazy loading: / | /criar | /campanha/:id
│   ├── app.ts / app.html            # Shell: <app-header> + <router-outlet>
│   └── app.config.ts                # provideRouter + provideBrowserGlobalErrorListeners
├── environments/
│   └── environment.ts               # Endereço do contrato, chainId, RPC público
└── styles.css                       # Design tokens (CSS vars), utilitários globais
```

---

## Serviços principais

### `WalletService`

| Membro | Tipo | Descrição |
|---|---|---|
| `address` | `Signal<string \| null>` | Endereço conectado ou `null` |
| `isConnected` | `Signal<boolean>` | Atalho para `address() != null` |
| `chainId` | `Signal<number \| null>` | Chain ID atual |
| `connect()` | `Promise<void>` | Solicita acesso ao MetaMask |
| `disconnect()` | `void` | Limpa o estado local |
| `getSigner()` | `JsonRpcSigner` | Signer para transações (lança se não conectado) |
| `getReadProvider()` | `Provider` | MetaMask se conectado, `JsonRpcProvider` público caso contrário |

### `ContractService`

| Método | Descrição |
|---|---|
| `getCampaign(id)` | Lê dados de uma campanha + cronograma em paralelo |
| `getCampaigns()` | Lista todas as campanhas em ordem decrescente de id |
| `getMyBalance(id)` | Saldo do usuário conectado em uma campanha |
| `getJanelas()` | Lê `JANELA_FINALIZACAO` e `JANELA_ABANDONO` do contrato |
| `getMaxPrazoCaptacao()` | Lê `MAX_PRAZO_CAPTACAO` para validação do formulário |
| `criarCampanha(meta, prazo, cronograma)` | Cria campanha e extrai id do evento `CampanhaCriada` |
| `contribuir(id, value)` | Envia ETH para uma campanha |
| `finalizarCampanha(id)` | Inicia o vesting |
| `sacarTranche(id)` | Saca a próxima tranche disponível |
| `marcarFracasso(id)` | Marca campanha como fracassada |
| `marcarAbandono(id)` | Marca campanha como abandonada |
| `reembolsar(id)` | Resgata saldo em campanha fracassada |

---

## Validações do formulário de criação

Todas espelham exatamente os `require` do contrato:

| Campo | Regra no frontend | `require` correspondente no contrato |
|---|---|---|
| Meta | `> 0` (custom validator) | `meta_ > 0` |
| Prazo | Futuro + `<= now + MAX_PRAZO_CAPTACAO` | `prazoCaptacao_ > block.timestamp` + `<= MAX_PRAZO_CAPTACAO` |
| Cronograma | Não vazio, `<= MAX_TRANCHES` | `length > 0`, `length <= MAX_TRANCHES` |
| Percentual por tranche | `>= 1 && <= 100` | `percentual > 0` |
| Soma dos percentuais | `=== 100` | `somaPercentuais == 100` |
| Dias | Estritamente crescentes | `tempoAposVesting[i] > tempoAposVesting[i-1]` |
