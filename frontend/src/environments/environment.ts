/**
 * Atualize CONTRACT_ADDRESS com o endereço gerado por deploy.ts
 * (salvo em deployments/sepolia.json).
 * Após editar, reinicie o servidor: npm start
 */
export const environment = {
  production: false,
  contractAddress: '0x0000000000000000000000000000000000000000',
  networkName: 'sepolia',
  chainId: 11155111,
  // RPC público de leitura — usado quando carteira não está conectada
  publicRpcUrl: 'https://rpc2.sepolia.org',
};
