// Endereço local: determinístico — sempre o mesmo no Hardhat (deployer Account #0, nonce 0).
// Troque por deployments/sepolia.json antes de apontar para a Sepolia.
export const environment = {
  production: false,
  contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  networkName: 'localhost',
  chainId: 31337,
  publicRpcUrl: 'http://127.0.0.1:8545',
};
