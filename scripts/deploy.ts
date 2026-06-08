/**
 * Deploy do contrato WePledge na rede configurada.
 *
 * Uso:
 *   npx hardhat run scripts/deploy.ts --network sepolia
 *   DEMO=true npx hardhat run scripts/deploy.ts --network sepolia
 *
 * Variáveis de ambiente (opcionais — sobrescrevem os defaults):
 *   DEMO=true              Usa janelas curtas (2 min / 5 min) para demonstração ao vivo.
 *   ETHERSCAN_API_KEY      Aciona verificação automática do código-fonte no Etherscan.
 *
 * Saída:
 *   deployments/<network>.json  Endereço + parâmetros do deploy para uso pelo seed.ts e frontend.
 */

import hre, { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ─── Parâmetros ────────────────────────────────────────────────────────────────

// DEMO=true usa janelas curtas para apresentação ao vivo na Sepolia.
// Sem a flag, usa parâmetros de produção realistas.
const DEMO = process.env.DEMO === "true";

const JANELA_FINALIZACAO: number = DEMO
  ? 2 * 60            // 2 minutos — demo
  : 7 * 24 * 3600;    // 7 dias   — produção

const JANELA_ABANDONO: number = DEMO
  ? 5 * 60            // 5 minutos — demo
  : 30 * 24 * 3600;   // 30 dias   — produção

const MAX_TRANCHES       = 5;
const MAX_PRAZO_CAPTACAO = 365 * 24 * 3600; // 1 ano

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (seconds < 60)    return `${seconds}s`;
  if (seconds < 3600)  return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h`;
  return `${Math.floor(seconds / 86400)} dias`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  const networkName = hre.network.name;
  const balance     = await ethers.provider.getBalance(deployer.address);

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║              WePledge — Deploy Script                   ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log();
  console.log(`Rede:        ${networkName}`);
  console.log(`Deployer:    ${deployer.address}`);
  console.log(`Saldo:       ${ethers.formatEther(balance)} ETH`);
  console.log(`Modo:        ${DEMO ? "DEMO (janelas curtas para apresentação)" : "PRODUÇÃO"}`);
  console.log();
  console.log("Parâmetros do constructor:");
  console.log(`  JANELA_FINALIZACAO : ${JANELA_FINALIZACAO}s  (${formatDuration(JANELA_FINALIZACAO)})`);
  console.log(`  JANELA_ABANDONO    : ${JANELA_ABANDONO}s  (${formatDuration(JANELA_ABANDONO)})`);
  console.log(`  MAX_TRANCHES       : ${MAX_TRANCHES}`);
  console.log(`  MAX_PRAZO_CAPTACAO : ${MAX_PRAZO_CAPTACAO}s  (${formatDuration(MAX_PRAZO_CAPTACAO)})`);
  console.log();

  // Alerta se saldo baixo (estimativa conservadora: ~0.01 ETH cobre o deploy)
  if (balance < ethers.parseEther("0.01")) {
    console.warn("⚠  Saldo baixo — pode não ser suficiente para cobrir o gas do deploy.");
  }

  // ── Deploy ──────────────────────────────────────────────────────────────────
  console.log("Deployando WePledge...");
  const WePledge = await ethers.getContractFactory("WePledge");
  const wepledge = await WePledge.deploy(
    JANELA_FINALIZACAO,
    JANELA_ABANDONO,
    MAX_TRANCHES,
    MAX_PRAZO_CAPTACAO
  );

  await wepledge.waitForDeployment();

  const contractAddress = await wepledge.getAddress();
  const deployTx        = wepledge.deploymentTransaction()!;
  // 1 confirmação é suficiente em redes de teste; aumente em mainnet.
  const receipt = await deployTx.wait(1);

  console.log(`✓  WePledge deployado`);
  console.log(`   Endereço : ${contractAddress}`);
  console.log(`   Bloco    : ${receipt?.blockNumber}`);
  console.log(`   Tx hash  : ${deployTx.hash}`);
  console.log();

  // ── Persistência ────────────────────────────────────────────────────────────
  const deploymentData = {
    address:      contractAddress,
    network:      networkName,
    chainId:      hre.network.config.chainId ?? null,
    blockNumber:  receipt?.blockNumber ?? null,
    deployedAt:   new Date().toISOString(),
    constructorArgs: {
      janelaFinalizacao: JANELA_FINALIZACAO,
      janelaAbandono:    JANELA_ABANDONO,
      maxTranches:       MAX_TRANCHES,
      maxPrazoCaptacao:  MAX_PRAZO_CAPTACAO,
    },
  };

  const deploymentsDir = path.resolve(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const outFile = path.join(deploymentsDir, `${networkName}.json`);
  fs.writeFileSync(outFile, JSON.stringify(deploymentData, null, 2) + "\n");
  console.log(`✓  Dados de deploy salvos em deployments/${networkName}.json`);
  console.log();

  // ── Verificação Etherscan ────────────────────────────────────────────────────
  const hasEtherscanKey = Boolean(process.env.ETHERSCAN_API_KEY);
  const isPublicNetwork = networkName !== "hardhat" && networkName !== "localhost";

  if (isPublicNetwork && hasEtherscanKey) {
    console.log("Verificando código-fonte no Etherscan...");
    // Aguarda propagação do bloco antes de submeter a verificação.
    await new Promise((r) => setTimeout(r, 20_000));
    try {
      await hre.run("verify:verify", {
        address: contractAddress,
        constructorArguments: [
          JANELA_FINALIZACAO,
          JANELA_ABANDONO,
          MAX_TRANCHES,
          MAX_PRAZO_CAPTACAO,
        ],
      });
      console.log("✓  Contrato verificado no Etherscan");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Already Verified") || msg.includes("already verified")) {
        console.log("✓  Contrato já estava verificado");
      } else {
        console.warn(`⚠  Verificação automática falhou: ${msg}`);
        console.warn("   Tente manualmente:");
        console.warn(
          `   npx hardhat verify --network ${networkName} ${contractAddress}` +
          ` ${JANELA_FINALIZACAO} ${JANELA_ABANDONO} ${MAX_TRANCHES} ${MAX_PRAZO_CAPTACAO}`
        );
      }
    }
    console.log();
  } else if (isPublicNetwork && !hasEtherscanKey) {
    console.log(
      "ℹ  ETHERSCAN_API_KEY não definida — verificação pulada.\n" +
      "   Adicione ao .env para verificação automática."
    );
    console.log();
  }

  // ── Resumo final ────────────────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Contrato : ${contractAddress}`);
  if (networkName === "sepolia") {
    console.log(`  Etherscan: https://sepolia.etherscan.io/address/${contractAddress}`);
  }
  console.log("═══════════════════════════════════════════════════════════");
  console.log();
  console.log("Próximos passos:");
  console.log(`  Seed (demo):  npm run seed:sepolia`);
  console.log(`  Testes:       npm test`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
