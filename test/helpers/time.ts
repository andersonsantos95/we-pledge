import { ethers, network } from "hardhat";

export async function advanceTime(seconds: number): Promise<void> {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine");
}

export async function latestTimestamp(): Promise<number> {
  const block = await ethers.provider.getBlock("latest");
  return block!.timestamp;
}

export async function advanceToTimestamp(target: number): Promise<void> {
  await network.provider.send("evm_setNextBlockTimestamp", [target]);
  await network.provider.send("evm_mine");
}
