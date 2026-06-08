/**
 * Seed de demonstração — cria campanhas na rede configurada e executa o fluxo completo.
 *
 * Uso:
 *   npx hardhat run scripts/seed.ts --network sepolia
 *
 * Pré-requisito:
 *   O contrato deve estar deployado. Execute deploy.ts primeiro.
 *   O arquivo deployments/<network>.json deve existir com o endereço do contrato.
 *
 * O que este script faz:
 *   1. Cria uma campanha demo (meta pequena, prazo curto, 2 tranches).
 *   2. Contribui o valor exato da meta (atingindo a meta imediatamente).
 *   3. Finaliza a campanha (inicia o vesting).
 *   4. Saca a tranche 1 (disponível em t=0 imediatamente após a finalização).
 *   5. Imprime o resumo com os IDs, saldos e próximos passos.
 *
 * A tranche 2 (t=60s) fica pendente e pode ser sacada manualmente ou via frontend.
 */

import hre, { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ─── Parâmetros da campanha demo ──────────────────────────────────────────────

// Meta pequena para minimizar gas cost na Sepolia (0.005 ETH = 5_000_000_000_000_000 wei).
const META_DEMO         = ethers.parseEther("0.005");
// Prazo: 30 minutos a partir de agora — tempo suficiente para a demo ao vivo.
const PRAZO_MINUTOS     = 30;
// Cronograma: 60% disponível imediatamente após finalizar; 40% após 60 segundos.
const CRONOGRAMA_DEMO   = [
  { percentual: 60, tempoAposVesting: 0  },
  { percentual: 40, tempoAposVesting: 60 },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadDeployment(networkName: string): { address: string; constructorArgs: Record<string, number> } {
  const filePath = path.resolve(__dirname, "..", "deployments", `${networkName}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Arquivo de deploy não encontrado: deployments/${networkName}.json\n` +
      `Execute primeiro: npm run deploy:${networkName === "sepolia" ? "demo" : networkName}`
    );
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sep(): void {
  console.log("─".repeat(62));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  const networkName = hre.network.name;

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║              WePledge — Seed Demo                       ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log();
  console.log(`Rede:     ${networkName}`);
  console.log(`Carteira: ${deployer.address}`);
  console.log();

  // ── Carrega endereço do deploy ───────────────────────────────────────────────
  const deployment = loadDeployment(networkName);
  console.log(`Contrato: ${deployment.address}`);
  console.log();

  const wepledge = await ethers.getContractAt("WePledge", deployment.address);

  // ── Verificação de saldo ─────────────────────────────────────────────────────
  const balance = await ethers.provider.getBalance(deployer.address);
  // Estimativa conservadora: meta + gas (0.02 ETH de folga)
  const minBalance = META_DEMO + ethers.parseEther("0.02");
  if (balance < minBalance) {
    throw new Error(
      `Saldo insuficiente: ${ethers.formatEther(balance)} ETH.\n` +
      `Necessário ~${ethers.formatEther(minBalance)} ETH (meta + gas estimado).`
    );
  }
  console.log(`Saldo:    ${ethers.formatEther(balance)} ETH`);
  console.log();

  sep();
  console.log("PASSO 1 — Criar campanha demo");
  sep();

  const agora     = BigInt(Math.floor(Date.now() / 1000));
  const prazo     = agora + BigInt(PRAZO_MINUTOS * 60);
  const prazoDate = new Date(Number(prazo) * 1000).toLocaleString("pt-BR");

  console.log(`Meta:     ${ethers.formatEther(META_DEMO)} ETH`);
  console.log(`Prazo:    ${prazoDate} (${PRAZO_MINUTOS} min)`);
  console.log(`Tranches: ${CRONOGRAMA_DEMO[0].percentual}% em t=0, ${CRONOGRAMA_DEMO[1].percentual}% em t=${CRONOGRAMA_DEMO[1].tempoAposVesting}s`);
  console.log();

  const txCriar = await wepledge.criarCampanha(
    META_DEMO,
    prazo,
    CRONOGRAMA_DEMO.map((t) => ({ percentual: t.percentual, tempoAposVesting: t.tempoAposVesting }))
  );
  const receiptCriar = await txCriar.wait();

  // Extrai o id da campanha do evento CampanhaCriada
  const eventoCriada = receiptCriar?.logs
    .map((log) => {
      try { return wepledge.interface.parseLog(log); } catch { return null; }
    })
    .find((e) => e?.name === "CampanhaCriada");

  const idCampanha: bigint = eventoCriada?.args[0] ?? 1n;

  console.log(`✓  Campanha criada com id = ${idCampanha}`);
  console.log(`   Tx: ${txCriar.hash}`);
  console.log();

  sep();
  console.log("PASSO 2 — Contribuir (atingir a meta)");
  sep();
  console.log(`Aportando ${ethers.formatEther(META_DEMO)} ETH...`);
  console.log();

  const txContribuir = await wepledge.contribuir(idCampanha, { value: META_DEMO });
  await txContribuir.wait();

  const campanha = await wepledge.campanhas(idCampanha);
  console.log(`✓  Meta atingida`);
  console.log(`   valorArrecadado: ${ethers.formatEther(campanha.valorArrecadado)} ETH`);
  console.log(`   Tx: ${txContribuir.hash}`);
  console.log();

  sep();
  console.log("PASSO 3 — Finalizar campanha (iniciar vesting)");
  sep();

  const txFinalizar = await wepledge.finalizarCampanha(idCampanha);
  const receiptFinalizar = await txFinalizar.wait();

  const blocoFinalizar = await ethers.provider.getBlock(receiptFinalizar!.blockNumber);
  const dataInicio = new Date(Number(blocoFinalizar!.timestamp) * 1000).toLocaleString("pt-BR");

  console.log(`✓  Campanha em vesting`);
  console.log(`   dataInicioVesting: ${dataInicio}`);
  console.log(`   Tx: ${txFinalizar.hash}`);
  console.log();

  sep();
  console.log("PASSO 4 — Sacar tranche 1 (60%, disponível em t=0)");
  sep();

  const saldoAntes = await ethers.provider.getBalance(deployer.address);
  const txSaque    = await wepledge.sacarTranche(idCampanha);
  const receiptSaque = await txSaque.wait();
  const saldoDepois  = await ethers.provider.getBalance(deployer.address);

  const gasGasto   = receiptSaque!.gasUsed * receiptSaque!.gasPrice;
  const recebido   = saldoDepois - saldoAntes + gasGasto;

  console.log(`✓  Tranche 1 sacada`);
  console.log(`   Recebido: ${ethers.formatEther(recebido)} ETH`);
  console.log(`   Gas:      ${ethers.formatEther(gasGasto)} ETH`);
  console.log(`   Tx: ${txSaque.hash}`);
  console.log();

  // ── Resumo final ────────────────────────────────────────────────────────────
  const campanhaFinal = await wepledge.campanhas(idCampanha);
  const estados       = ["Captacao", "EmVesting", "Concluida", "Fracassada"];

  sep();
  console.log("RESUMO");
  sep();
  console.log(`Campanha #${idCampanha}`);
  console.log(`  Estado          : ${estados[Number(campanhaFinal.estado)]}`);
  console.log(`  valorArrecadado : ${ethers.formatEther(campanhaFinal.valorArrecadado)} ETH`);
  console.log(`  valorJaSacado   : ${ethers.formatEther(campanhaFinal.valorJaSacado)} ETH`);
  console.log(`  Saldo contrato  : ${ethers.formatEther(await ethers.provider.getBalance(deployment.address))} ETH`);
  console.log();
  console.log("Próximos passos:");
  console.log(`  Aguarde 60 segundos e execute sacarTranche(${idCampanha}) para a tranche 2 (40%).`);
  if (networkName === "sepolia") {
    console.log(`  Acompanhe no Etherscan: https://sepolia.etherscan.io/address/${deployment.address}`);
  }
  sep();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
