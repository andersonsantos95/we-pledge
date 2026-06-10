// Configuração de produção (Sepolia testnet).
// Preencha CONTRACT_ADDRESS após fazer o deploy com: npx hardhat run scripts/deploy.ts --network sepolia
export const environment = {
  production: true,
  contractAddress: '0x4255FAC8944f333ca31106d482614ADA53cF8c74',
  networkName: 'sepolia',
  chainId: 11155111,
  publicRpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
};
