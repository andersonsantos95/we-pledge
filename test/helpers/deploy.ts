import hre from "hardhat";

export const JANELA_FINALIZACAO = 2 * 60;
export const JANELA_ABANDONO    = 5 * 60;
export const MAX_TRANCHES       = 5;
export const MAX_PRAZO_CAPTACAO = 365 * 24 * 3600;

export async function deploy() {
  const [deployer, criador, contrib1, contrib2, terceiro] = await hre.ethers.getSigners();
  const WePledge = await hre.ethers.getContractFactory("WePledge");
  const wepledge = await WePledge.deploy(
    JANELA_FINALIZACAO,
    JANELA_ABANDONO,
    MAX_TRANCHES,
    MAX_PRAZO_CAPTACAO
  );
  return { wepledge, deployer, criador, contrib1, contrib2, terceiro };
}
