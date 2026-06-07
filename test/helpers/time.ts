import { ethers, network } from "hardhat";

// Avança o tempo da rede local em `seconds` segundos e minera um bloco.
// Usado para simular expiração de prazos sem esperar tempo real.
export async function advanceTime(seconds: number): Promise<void> {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine");
}

// Retorna o timestamp Unix do bloco mais recente.
export async function latestTimestamp(): Promise<number> {
  const block = await ethers.provider.getBlock("latest");
  return block!.timestamp;
}

// Salta para um timestamp absoluto específico e minera um bloco.
// Útil quando o teste precisa de um instante exato, não apenas de um delta.
export async function advanceToTimestamp(target: number): Promise<void> {
  await network.provider.send("evm_setNextBlockTimestamp", [target]);
  await network.provider.send("evm_mine");
}
