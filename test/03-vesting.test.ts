/**
 * Fase 3 — finalizarCampanha + sacarTranche
 *
 * Estes testes cobrem o caminho feliz completo do vesting e seus invariantes:
 *   - finalizarCampanha: transição Captacao → EmVesting, registro de dataInicioVesting
 *   - sacarTranche: saque sequencial por tranche, cálculo de valor, última tranche
 *     com saldo restante, transição EmVesting → Concluida
 *
 * Máquina de estados exercitada:
 *   Captacao → EmVesting (finalizarCampanha)
 *   EmVesting → EmVesting (sacarTranche, não última)
 *   EmVesting → Concluida (sacarTranche, última tranche)
 *
 * Invariantes centrais:
 *   - Apenas o criador finaliza e saca.
 *   - Tranches são sacadas em ordem sequencial.
 *   - valorJaSacado acumula corretamente após cada saque.
 *   - Última tranche absorve dust de divisão inteira.
 *   - ETH sai do contrato e chega ao criador em cada saque.
 */

import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { advanceTime } from "./helpers/time";

// ─── Constantes de deploy ─────────────────────────────────────────────────────

const JANELA_FINALIZACAO = 2 * 60;
const JANELA_ABANDONO    = 5 * 60;
const MAX_TRANCHES       = 5;
const MAX_PRAZO_CAPTACAO = 365 * 24 * 3600;

const UM_DIA    = 24 * 3600;
const TRINTA_DIAS = 30 * UM_DIA;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

async function deployFixture() {
  const [deployer, criador, contrib1, contrib2] = await hre.ethers.getSigners();

  const WePledge = await hre.ethers.getContractFactory("WePledge");
  const wepledge = await WePledge.deploy(
    JANELA_FINALIZACAO,
    JANELA_ABANDONO,
    MAX_TRANCHES,
    MAX_PRAZO_CAPTACAO
  );

  return { wepledge, deployer, criador, contrib1, contrib2 };
}

// Campanha criada com meta de 2 ETH e cronograma de duas tranches (50%/50%).
async function campanhaComMetaAtingidaFixture() {
  const base = await deployFixture();
  const { wepledge, criador, contrib1 } = base;

  const agora = await time.latest();
  const meta          = hre.ethers.parseEther("2");
  const prazoCaptacao = agora + 7 * UM_DIA;

  await wepledge.connect(criador).criarCampanha(
    meta,
    prazoCaptacao,
    [
      { percentual: 50, tempoAposVesting: 0 },
      { percentual: 50, tempoAposVesting: TRINTA_DIAS },
    ]
  );

  await wepledge.connect(contrib1).contribuir(1n, { value: meta });

  return { ...base, idCampanha: 1n, meta, prazoCaptacao };
}

// Campanha já finalizada (estado EmVesting).
async function campanhaEmVestingFixture() {
  const base = await campanhaComMetaAtingidaFixture();
  const { wepledge, criador, idCampanha } = base;

  await wepledge.connect(criador).finalizarCampanha(idCampanha);

  const campanha = await wepledge.campanhas(idCampanha);
  const dataInicioVesting = campanha.dataInicioVesting;

  return { ...base, dataInicioVesting };
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe("WePledge — Fase 3: finalizarCampanha e sacarTranche", function () {

  // ── finalizarCampanha ────────────────────────────────────────────────────────
  describe("finalizarCampanha", function () {

    it("transiciona para EmVesting quando meta atingida", async function () {
      // Captacao → EmVesting: estado muda após finalizarCampanha.
      const { wepledge, criador, idCampanha } = await loadFixture(campanhaComMetaAtingidaFixture);

      await wepledge.connect(criador).finalizarCampanha(idCampanha);

      const campanha = await wepledge.campanhas(idCampanha);
      expect(campanha.estado).to.equal(1n); // EstadoCampanha.EmVesting = 1
    });

    it("registra dataInicioVesting no bloco da chamada", async function () {
      // dataInicioVesting define t=0 do cronograma; deve ser o timestamp exato da tx.
      const { wepledge, criador, idCampanha } = await loadFixture(campanhaComMetaAtingidaFixture);

      const txTimestamp = (await time.latest()) + 1; // próximo bloco
      await wepledge.connect(criador).finalizarCampanha(idCampanha);

      const campanha = await wepledge.campanhas(idCampanha);
      expect(campanha.dataInicioVesting).to.equal(BigInt(txTimestamp));
    });

    it("emite CampanhaFinalizada com valorArrecadado e dataInicioVesting corretos", async function () {
      const { wepledge, criador, idCampanha, meta } = await loadFixture(campanhaComMetaAtingidaFixture);

      const txTimestamp = (await time.latest()) + 1;
      await expect(wepledge.connect(criador).finalizarCampanha(idCampanha))
        .to.emit(wepledge, "CampanhaFinalizada")
        .withArgs(idCampanha, meta, BigInt(txTimestamp));
    });

    it("pode ser chamada após o prazoCaptacao (meta atingida antes do prazo)", async function () {
      // Criador pode finalizar mesmo após o prazo de captação expirar.
      const { wepledge, criador, idCampanha, prazoCaptacao } = await loadFixture(campanhaComMetaAtingidaFixture);

      await time.setNextBlockTimestamp(prazoCaptacao + 1);
      await expect(wepledge.connect(criador).finalizarCampanha(idCampanha)).to.not.be.reverted;
    });

    it("rejeita se meta não foi atingida", async function () {
      const { wepledge, criador } = await loadFixture(deployFixture);
      const agora = await time.latest();
      const meta  = hre.ethers.parseEther("2");

      await wepledge.connect(criador).criarCampanha(
        meta, agora + 3600, [{ percentual: 100, tempoAposVesting: 0 }]
      );
      // nenhuma contribuição

      await expect(
        wepledge.connect(criador).finalizarCampanha(1n)
      ).to.be.revertedWith("WePledge: meta nao atingida");
    });

    it("rejeita se chamada por endereço que não é o criador", async function () {
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaComMetaAtingidaFixture);

      await expect(
        wepledge.connect(contrib1).finalizarCampanha(idCampanha)
      ).to.be.revertedWith("WePledge: apenas o criador pode finalizar");
    });

    it("rejeita dupla finalização (estado já é EmVesting)", async function () {
      const { wepledge, criador, idCampanha } = await loadFixture(campanhaComMetaAtingidaFixture);

      await wepledge.connect(criador).finalizarCampanha(idCampanha);
      await expect(
        wepledge.connect(criador).finalizarCampanha(idCampanha)
      ).to.be.revertedWith("WePledge: campanha nao esta em captacao");
    });

    it("rejeita campanha inexistente", async function () {
      const { wepledge, criador } = await loadFixture(deployFixture);

      await expect(
        wepledge.connect(criador).finalizarCampanha(999n)
      ).to.be.revertedWith("WePledge: campanha inexistente");
    });
  });

  // ── sacarTranche ─────────────────────────────────────────────────────────────
  describe("sacarTranche", function () {

    it("saca primeira tranche com tempoAposVesting = 0 imediatamente após vesting", async function () {
      // Tranche 0 tem tempo 0: disponível no mesmo bloco de finalizarCampanha.
      const { wepledge, criador, idCampanha } = await loadFixture(campanhaEmVestingFixture);

      await expect(wepledge.connect(criador).sacarTranche(idCampanha)).to.not.be.reverted;
    });

    it("transfere o valor correto da tranche ao criador", async function () {
      // Tranche 0: 50% de 2 ETH = 1 ETH transferido ao criador.
      const { wepledge, criador, idCampanha, meta } = await loadFixture(campanhaEmVestingFixture);

      const valorEsperado = meta / 2n; // 50% de 2 ETH

      await expect(
        wepledge.connect(criador).sacarTranche(idCampanha)
      ).to.changeEtherBalance(criador, valorEsperado);
    });

    it("reduz o saldo do contrato em exatamente o valor da tranche", async function () {
      const { wepledge, criador, idCampanha, meta } = await loadFixture(campanhaEmVestingFixture);

      const valorEsperado = meta / 2n;

      await expect(
        wepledge.connect(criador).sacarTranche(idCampanha)
      ).to.changeEtherBalance(wepledge, -valorEsperado);
    });

    it("atualiza valorJaSacado após o saque", async function () {
      const { wepledge, criador, idCampanha, meta } = await loadFixture(campanhaEmVestingFixture);

      await wepledge.connect(criador).sacarTranche(idCampanha);

      const campanha = await wepledge.campanhas(idCampanha);
      expect(campanha.valorJaSacado).to.equal(meta / 2n);
    });

    it("marca a tranche como sacada no storage", async function () {
      const { wepledge, criador, idCampanha } = await loadFixture(campanhaEmVestingFixture);

      await wepledge.connect(criador).sacarTranche(idCampanha);

      const cronograma = await wepledge.getCronograma(idCampanha);
      expect(cronograma[0].sacada).to.be.true;
      expect(cronograma[1].sacada).to.be.false; // segunda ainda não sacada
    });

    it("emite TrancheLiberada com índice e valor corretos", async function () {
      const { wepledge, criador, idCampanha, meta } = await loadFixture(campanhaEmVestingFixture);

      await expect(wepledge.connect(criador).sacarTranche(idCampanha))
        .to.emit(wepledge, "TrancheLiberada")
        .withArgs(idCampanha, 0, meta / 2n); // índice 0, 1 ETH
    });

    it("estado permanece EmVesting após saque de tranche não final", async function () {
      const { wepledge, criador, idCampanha } = await loadFixture(campanhaEmVestingFixture);

      await wepledge.connect(criador).sacarTranche(idCampanha);

      const campanha = await wepledge.campanhas(idCampanha);
      expect(campanha.estado).to.equal(1n); // EmVesting
    });

    it("rejeita saque de segunda tranche antes do seu tempoAposVesting", async function () {
      // Tranche 1 tem tempo 30 dias; não pode sacar antes.
      const { wepledge, criador, idCampanha } = await loadFixture(campanhaEmVestingFixture);

      await wepledge.connect(criador).sacarTranche(idCampanha); // saca tranche 0

      await expect(
        wepledge.connect(criador).sacarTranche(idCampanha)
      ).to.be.revertedWith("WePledge: tranche ainda nao disponivel");
    });

    it("permite saque de segunda tranche após seu tempoAposVesting", async function () {
      const { wepledge, criador, idCampanha } = await loadFixture(campanhaEmVestingFixture);

      await wepledge.connect(criador).sacarTranche(idCampanha); // tranche 0
      await advanceTime(TRINTA_DIAS);

      await expect(wepledge.connect(criador).sacarTranche(idCampanha)).to.not.be.reverted;
    });

    it("última tranche transiciona para Concluida e emite CampanhaConcluida", async function () {
      // EmVesting → Concluida na última tranche.
      const { wepledge, criador, idCampanha } = await loadFixture(campanhaEmVestingFixture);

      await wepledge.connect(criador).sacarTranche(idCampanha); // tranche 0
      await advanceTime(TRINTA_DIAS);

      await expect(wepledge.connect(criador).sacarTranche(idCampanha))
        .to.emit(wepledge, "CampanhaConcluida")
        .withArgs(idCampanha);

      const campanha = await wepledge.campanhas(idCampanha);
      expect(campanha.estado).to.equal(2n); // Concluida
    });

    it("última tranche recebe o saldo restante (absorve dust)", async function () {
      // Campanha com 3 tranches de 33%/33%/34% e valor que não divide exatamente.
      // Tranche 2 (34%) recebe valorArrecadado - valorJaSacado para evitar dust.
      const { wepledge, criador, contrib1 } = await loadFixture(deployFixture);
      const agora = await time.latest();

      // 1 ETH dividido em 33/33/34: tranche 0 = 0,33 ETH, tranche 1 = 0,33 ETH,
      // tranche 2 = remainder (0,34 ETH + eventual dust de wei).
      const meta = hre.ethers.parseEther("1");
      await wepledge.connect(criador).criarCampanha(
        meta,
        agora + 3600,
        [
          { percentual: 33, tempoAposVesting: 0 },
          { percentual: 33, tempoAposVesting: UM_DIA },
          { percentual: 34, tempoAposVesting: 2 * UM_DIA },
        ]
      );
      await wepledge.connect(contrib1).contribuir(1n, { value: meta });
      await wepledge.connect(criador).finalizarCampanha(1n);

      const t0 = (meta * 33n) / 100n;
      const t1 = (meta * 33n) / 100n;
      const t2Restante = meta - t0 - t1; // saldo real, sem dust

      await wepledge.connect(criador).sacarTranche(1n); // tranche 0
      await advanceTime(UM_DIA);
      await wepledge.connect(criador).sacarTranche(1n); // tranche 1
      await advanceTime(UM_DIA);

      // Última tranche: criador deve receber exatamente o saldo restante.
      await expect(
        wepledge.connect(criador).sacarTranche(1n)
      ).to.changeEtherBalance(criador, t2Restante);

      // Contrato deve ficar com balance zero — nenhum dust preso.
      expect(await hre.ethers.provider.getBalance(await wepledge.getAddress())).to.equal(0n);
    });

    it("saque completo (todas as tranches): contrato fica com balance zero", async function () {
      const { wepledge, criador, idCampanha } = await loadFixture(campanhaEmVestingFixture);

      await wepledge.connect(criador).sacarTranche(idCampanha); // tranche 0
      await advanceTime(TRINTA_DIAS);
      await wepledge.connect(criador).sacarTranche(idCampanha); // tranche 1 (última)

      expect(await hre.ethers.provider.getBalance(await wepledge.getAddress())).to.equal(0n);
    });

    it("rejeita saque após campanha Concluida", async function () {
      // Estado Concluida rejeita sacarTranche (require estado == EmVesting).
      const { wepledge, criador, idCampanha } = await loadFixture(campanhaEmVestingFixture);

      await wepledge.connect(criador).sacarTranche(idCampanha);
      await advanceTime(TRINTA_DIAS);
      await wepledge.connect(criador).sacarTranche(idCampanha); // última → Concluida

      await expect(
        wepledge.connect(criador).sacarTranche(idCampanha)
      ).to.be.revertedWith("WePledge: campanha nao esta em vesting");
    });

    it("rejeita saque por endereço que não é o criador", async function () {
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaEmVestingFixture);

      await expect(
        wepledge.connect(contrib1).sacarTranche(idCampanha)
      ).to.be.revertedWith("WePledge: apenas o criador pode sacar");
    });

    it("rejeita saque com campanha em estado Captacao", async function () {
      // sacarTranche em campanha não finalizada deve falhar.
      const { wepledge, criador, idCampanha } = await loadFixture(campanhaComMetaAtingidaFixture);

      await expect(
        wepledge.connect(criador).sacarTranche(idCampanha)
      ).to.be.revertedWith("WePledge: campanha nao esta em vesting");
    });

    it("rejeita campanha inexistente", async function () {
      const { wepledge, criador } = await loadFixture(deployFixture);

      await expect(
        wepledge.connect(criador).sacarTranche(999n)
      ).to.be.revertedWith("WePledge: campanha inexistente");
    });
  });
});
