# WePledge

## Problema

Plataformas de crowdfunding tradicionais exigem confiança em um intermediário para custodiar os fundos e garantir que o criador os utilize conforme prometido. Não há mecanismo que impeça o criador de receber o dinheiro e abandonar o projeto.

## Solução

WePledge é uma plataforma de crowdfunding descentralizada onde as regras são executadas por um smart contract. A lógica é todo-ou-nada: se a meta não for atingida no prazo, os contribuintes recebem reembolso automático. Se for atingida, os fundos são liberados ao criador em parcelas por tempo (vesting), reduzindo o risco de abandono após o recebimento.

## Público e contexto

Criadores de projetos que precisam arrecadar fundos publicamente e contribuintes que querem garantia de reembolso ou de liberação gradual dos recursos — sem depender de uma plataforma centralizada.

## Uso de Web3

- **Smart contract em Solidity** define e executa todas as regras: captação, meta, reembolso e vesting.
- **Ethers.js v6** conecta o frontend ao contrato via carteira do usuário (MetaMask).
- **Nenhum backend proprietário**: o contrato é a única fonte de verdade; qualquer um pode auditá-lo ou interagir diretamente.
- Os fundos ficam custodiados pelo próprio contrato até as condições de liberação serem atendidas on-chain.
