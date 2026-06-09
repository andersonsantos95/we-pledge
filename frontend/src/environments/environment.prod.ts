// Configuração de produção (Sepolia testnet).
// Preencha CONTRACT_ADDRESS após fazer o deploy com: npx hardhat run scripts/deploy.ts --network sepolia
export const environment = {
  production: true,
  contractAddress: '0x0000000000000000000000000000000000000000', // substituir após deploy
  networkName: 'sepolia',
  chainId: 11155111,
  publicRpcUrl: 'https://rpc.sepolia.org',
};
