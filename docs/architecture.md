# Arquitetura — WePledge

## Visão geral

WePledge é uma plataforma de crowdfunding descentralizado onde todas as regras de captação e liberação de fundos são executadas por smart contract na EVM, sem intermediário central.

O modelo é **todo-ou-nada com vesting por tempo**:
- Se a meta não for atingida no prazo → contribuintes recebem reembolso garantido por código.
- Se a meta for atingida → os fundos são liberados ao criador em parcelas definidas no cronograma (vesting), reduzindo o risco de fuga com o dinheiro.

---

## Máquina de estados

```
                    contribuir()
                        │
              ┌─────────▼──────────┐
              │      Captacao      │  ← estado inicial de toda campanha
              └────────────────────┘
                /         |          \
  meta atingida +    prazo expirado   + meta atingida +
  criador chama      + meta < meta      janela composta
  finalizarCampanha  │                  expirada
               │     │                 │
               │  marcarFracasso()   marcarAbandono()
               │     │                 │
               │     └────────┬────────┘
               │              ▼
               │        ┌──────────┐
               │        │Fracassada│ ← reembolsar() disponível
               │        └──────────┘
               ▼
      ┌─────────────────┐
      │    EmVesting    │  ← sacarTranche() disponível por ordem de cronograma
      └─────────────────┘
               │
       última tranche sacada
               │
               ▼
      ┌─────────────────┐
      │    Concluida    │ ← estado terminal de sucesso
      └─────────────────┘
```

### Transições

| De | Para | Função | Quem pode chamar |
|---|---|---|---|
| Captacao | EmVesting | `finalizarCampanha()` | Criador |
| Captacao | Fracassada | `marcarFracasso()` | Qualquer um |
| Captacao | Fracassada | `marcarAbandono()` | Qualquer um |
| EmVesting | Concluida | `sacarTranche()` (última) | Criador |

**Captacao → Fracassada via `marcarFracasso`**: prazo expirado + `valorArrecadado < meta`

**Captacao → Fracassada via `marcarAbandono`**: `valorArrecadado >= meta` + `block.timestamp > prazoCaptacao + JANELA_FINALIZACAO + JANELA_ABANDONO`

Os dois caminhos para Fracassada são **mutuamente exclusivos** e auditáveis via eventos distintos (`CampanhaFracassada` vs `CampanhaAbandonada`).

---

## Janelas de tempo

```
prazoCaptacao
     │
     ├──── JANELA_FINALIZACAO ────┤
     │   criador pode finalizar   │
     │                            ├──── JANELA_ABANDONO ────┤
     │                            │  qualquer um pode marcar │
     │                            │  abandono                │
     ▼                            ▼                          ▼
  t_prazo               t_prazo + JF               t_prazo + JF + JA
                                                         ↑
                                               marcarAbandono() ativa
                                               a partir deste ponto
                                               (estrito: block.timestamp >)
```

| Parâmetro | Demo | Produção |
|---|---|---|
| `JANELA_FINALIZACAO` | 2 min | 7 dias |
| `JANELA_ABANDONO` | 5 min | 30 dias |

---

## Padrões de segurança

### CEI (Checks-Effects-Interactions)
Toda função que transfere ETH (`sacarTranche`, `reembolsar`) atualiza o estado **antes** de executar a transferência externa. Garante que re-entrada encontre estado já atualizado e reverta.

### Pull payment
Reembolsos e saques de tranche são **puxados** pelo beneficiário, não empurrados pelo contrato. Elimina ponto único de falha de um batch-refund e escala para número arbitrário de contribuintes.

### Nonreentrant
`sacarTranche` e `reembolsar` usam o mutex do `ReentrancyGuard` do OpenZeppelin como segunda camada de defesa além do CEI.

### receive() revertendo
ETH enviado diretamente ao endereço do contrato (sem calldata) reverte com mensagem explícita. ETH deve entrar exclusivamente via `contribuir()`.

---

## Stack tecnológico

| Camada | Tecnologia |
|---|---|
| Smart contract | Solidity 0.8.24, OpenZeppelin ReentrancyGuard |
| Desenvolvimento / testes | Hardhat, Ethers.js v6, Chai, @nomicfoundation/hardhat-toolbox |
| Frontend | Angular 22, Ethers.js v6 (BrowserProvider) |
| Rede de teste | Sepolia (chainId 11155111) |
| Verificação | Etherscan API |
