import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import hre from "hardhat";
import { deploy } from "./helpers/deploy";
import { advanceTime } from "./helpers/time";

const UM_DIA     = 24 * 3600;
const TRINTA_DIAS = 30 * UM_DIA;

async function campanhaComMetaFixture() {
  const base = await deploy();
  const { wepledge, criador, contrib1 } = base;
  const agora = await time.latest();
  const meta          = hre.ethers.parseEther("2");
  const prazoCaptacao = agora + 7 * UM_DIA;
  await wepledge.connect(criador).criarCampanha(
    "Campanha Teste", "Descrição.",
    meta, prazoCaptacao,
    [
      { percentual: 50, tempoAposVesting: 0 },
      { percentual: 50, tempoAposVesting: TRINTA_DIAS },
    ]
  );
  await wepledge.connect(contrib1).contribuir(1n, { value: meta });
  return { ...base, idCampanha: 1n, meta, prazoCaptacao };
}

async function campanhaEmVestingFixture() {
  const base = await campanhaComMetaFixture();
  await base.wepledge.connect(base.criador).finalizarCampanha(base.idCampanha);
  const c = await base.wepledge.campanhas(base.idCampanha);
  return { ...base, dataInicioVesting: c.dataInicioVesting };
}

describe("finalizarCampanha e sacarTranche", function () {

  describe("finalizarCampanha", function () {
    it("transiciona para EmVesting", async function () {
      const { wepledge, criador, idCampanha } = await loadFixture(campanhaComMetaFixture);
      await wepledge.connect(criador).finalizarCampanha(idCampanha);
      const c = await wepledge.campanhas(idCampanha);
      expect(c.estado).to.equal(1n);
    });

    it("registra dataInicioVesting no bloco da chamada", async function () {
      const { wepledge, criador, idCampanha } = await loadFixture(campanhaComMetaFixture);
      const tx      = await wepledge.connect(criador).finalizarCampanha(idCampanha);
      const receipt = await tx.wait();
      const block   = await hre.ethers.provider.getBlock(receipt!.blockNumber);
      const c = await wepledge.campanhas(idCampanha);
      expect(c.dataInicioVesting).to.equal(BigInt(block!.timestamp));
    });

    it("emite CampanhaFinalizada com valorArrecadado correto", async function () {
      const { wepledge, criador, idCampanha, meta } = await loadFixture(campanhaComMetaFixture);
      await expect(wepledge.connect(criador).finalizarCampanha(idCampanha))
        .to.emit(wepledge, "CampanhaFinalizada")
        .withArgs(idCampanha, meta, anyValue);
    });

    it("pode ser chamada após o prazoCaptacao expirar", async function () {
      const { wepledge, criador, idCampanha, prazoCaptacao } = await loadFixture(campanhaComMetaFixture);
      await time.setNextBlockTimestamp(prazoCaptacao + 1);
      await expect(wepledge.connect(criador).finalizarCampanha(idCampanha)).to.not.be.reverted;
    });

    it("rejeita se meta não foi atingida", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      await wepledge.connect(criador).criarCampanha(
        "T", "", hre.ethers.parseEther("2"), agora + 3600,
        [{ percentual: 100, tempoAposVesting: 0 }]
      );
      await expect(wepledge.connect(criador).finalizarCampanha(1n))
        .to.be.revertedWith("WePledge: meta nao atingida");
    });

    it("rejeita chamada por endereço que não é o criador", async function () {
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaComMetaFixture);
      await expect(wepledge.connect(contrib1).finalizarCampanha(idCampanha))
        .to.be.revertedWith("WePledge: apenas o criador pode finalizar");
    });

    it("rejeita dupla finalização", async function () {
      const { wepledge, criador, idCampanha } = await loadFixture(campanhaComMetaFixture);
      await wepledge.connect(criador).finalizarCampanha(idCampanha);
      await expect(wepledge.connect(criador).finalizarCampanha(idCampanha))
        .to.be.revertedWith("WePledge: campanha nao esta em captacao");
    });

    it("rejeita campanha inexistente", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      await expect(wepledge.connect(criador).finalizarCampanha(999n))
        .to.be.revertedWith("WePledge: campanha inexistente");
    });
  });

  describe("sacarTranche", function () {
    it("saca a primeira tranche imediatamente (tempoAposVesting = 0)", async function () {
      const { wepledge, criador, idCampanha } = await loadFixture(campanhaEmVestingFixture);
      await expect(wepledge.connect(criador).sacarTranche(idCampanha)).to.not.be.reverted;
    });

    it("transfere o valor correto ao criador", async function () {
      const { wepledge, criador, idCampanha, meta } = await loadFixture(campanhaEmVestingFixture);
      await expect(wepledge.connect(criador).sacarTranche(idCampanha))
        .to.changeEtherBalance(criador, meta / 2n);
    });

    it("reduz o saldo do contrato", async function () {
      const { wepledge, criador, idCampanha, meta } = await loadFixture(campanhaEmVestingFixture);
      await expect(wepledge.connect(criador).sacarTranche(idCampanha))
        .to.changeEtherBalance(wepledge, -(meta / 2n));
    });

    it("atualiza valorJaSacado", async function () {
      const { wepledge, criador, idCampanha, meta } = await loadFixture(campanhaEmVestingFixture);
      await wepledge.connect(criador).sacarTranche(idCampanha);
      const c = await wepledge.campanhas(idCampanha);
      expect(c.valorJaSacado).to.equal(meta / 2n);
    });

    it("marca a tranche como sacada no storage", async function () {
      const { wepledge, criador, idCampanha } = await loadFixture(campanhaEmVestingFixture);
      await wepledge.connect(criador).sacarTranche(idCampanha);
      const cron = await wepledge.getCronograma(idCampanha);
      expect(cron[0].sacada).to.be.true;
      expect(cron[1].sacada).to.be.false;
    });

    it("emite TrancheLiberada com índice e valor", async function () {
      const { wepledge, criador, idCampanha, meta } = await loadFixture(campanhaEmVestingFixture);
      await expect(wepledge.connect(criador).sacarTranche(idCampanha))
        .to.emit(wepledge, "TrancheLiberada")
        .withArgs(idCampanha, 0, meta / 2n);
    });

    it("permanece EmVesting após saque de tranche não final", async function () {
      const { wepledge, criador, idCampanha } = await loadFixture(campanhaEmVestingFixture);
      await wepledge.connect(criador).sacarTranche(idCampanha);
      const c = await wepledge.campanhas(idCampanha);
      expect(c.estado).to.equal(1n);
    });

    it("rejeita saque da segunda tranche antes do seu tempo", async function () {
      const { wepledge, criador, idCampanha } = await loadFixture(campanhaEmVestingFixture);
      await wepledge.connect(criador).sacarTranche(idCampanha);
      await expect(wepledge.connect(criador).sacarTranche(idCampanha))
        .to.be.revertedWith("WePledge: tranche ainda nao disponivel");
    });

    it("permite saque da segunda tranche após tempoAposVesting", async function () {
      const { wepledge, criador, idCampanha } = await loadFixture(campanhaEmVestingFixture);
      await wepledge.connect(criador).sacarTranche(idCampanha);
      await advanceTime(TRINTA_DIAS);
      await expect(wepledge.connect(criador).sacarTranche(idCampanha)).to.not.be.reverted;
    });

    it("última tranche transiciona para Concluida", async function () {
      const { wepledge, criador, idCampanha } = await loadFixture(campanhaEmVestingFixture);
      await wepledge.connect(criador).sacarTranche(idCampanha);
      await advanceTime(TRINTA_DIAS);
      await expect(wepledge.connect(criador).sacarTranche(idCampanha))
        .to.emit(wepledge, "CampanhaConcluida").withArgs(idCampanha);
      const c = await wepledge.campanhas(idCampanha);
      expect(c.estado).to.equal(2n);
    });

    it("contrato fica com balance zero após todos os saques", async function () {
      const { wepledge, criador, idCampanha } = await loadFixture(campanhaEmVestingFixture);
      await wepledge.connect(criador).sacarTranche(idCampanha);
      await advanceTime(TRINTA_DIAS);
      await wepledge.connect(criador).sacarTranche(idCampanha);
      expect(await hre.ethers.provider.getBalance(await wepledge.getAddress())).to.equal(0n);
    });

    it("rejeita após estado Concluida", async function () {
      const { wepledge, criador, idCampanha } = await loadFixture(campanhaEmVestingFixture);
      await wepledge.connect(criador).sacarTranche(idCampanha);
      await advanceTime(TRINTA_DIAS);
      await wepledge.connect(criador).sacarTranche(idCampanha);
      await expect(wepledge.connect(criador).sacarTranche(idCampanha))
        .to.be.revertedWith("WePledge: campanha nao esta em vesting");
    });

    it("rejeita saque por endereço que não é o criador", async function () {
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaEmVestingFixture);
      await expect(wepledge.connect(contrib1).sacarTranche(idCampanha))
        .to.be.revertedWith("WePledge: apenas o criador pode sacar");
    });

    it("rejeita campanha em Captacao", async function () {
      const { wepledge, criador, idCampanha } = await loadFixture(campanhaComMetaFixture);
      await expect(wepledge.connect(criador).sacarTranche(idCampanha))
        .to.be.revertedWith("WePledge: campanha nao esta em vesting");
    });

    it("rejeita campanha inexistente", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      await expect(wepledge.connect(criador).sacarTranche(999n))
        .to.be.revertedWith("WePledge: campanha inexistente");
    });

    it("tranche única de 100% conclui em um único saque", async function () {
      const { wepledge, criador, contrib1 } = await loadFixture(deploy);
      const agora = await time.latest();
      const meta  = hre.ethers.parseEther("1");
      await wepledge.connect(criador).criarCampanha("T", "", meta, agora + 3600, [{ percentual: 100, tempoAposVesting: 0 }]);
      await wepledge.connect(contrib1).contribuir(1n, { value: meta });
      await wepledge.connect(criador).finalizarCampanha(1n);
      await expect(wepledge.connect(criador).sacarTranche(1n))
        .to.emit(wepledge, "CampanhaConcluida").withArgs(1n)
        .and.to.emit(wepledge, "TrancheLiberada").withArgs(1n, 0, meta);
      const c = await wepledge.campanhas(1n);
      expect(c.estado).to.equal(2n);
      expect(await hre.ethers.provider.getBalance(await wepledge.getAddress())).to.equal(0n);
    });
  });

  describe("aritmética de divisão inteira (dust)", function () {
    it("última tranche absorve o remainder (33/33/34 com 1001 wei)", async function () {
      // 1001 * 33 / 100 = 330 (trunca). Remainder = 1001 - 330 - 330 = 341.
      // Cálculo por percentual daria 1001 * 34 / 100 = 340 — 1 wei a menos.
      const { wepledge, criador, contrib1 } = await loadFixture(deploy);
      const agora = await time.latest();
      await wepledge.connect(criador).criarCampanha("T", "", 1000n, agora + 3600,
        [
          { percentual: 33, tempoAposVesting: 0 },
          { percentual: 33, tempoAposVesting: UM_DIA },
          { percentual: 34, tempoAposVesting: 2 * UM_DIA },
        ]
      );
      await wepledge.connect(contrib1).contribuir(1n, { value: 1001n });
      await wepledge.connect(criador).finalizarCampanha(1n);

      await wepledge.connect(criador).sacarTranche(1n);         // 330 wei
      await advanceTime(UM_DIA);
      await wepledge.connect(criador).sacarTranche(1n);         // 330 wei
      await advanceTime(UM_DIA);

      await expect(wepledge.connect(criador).sacarTranche(1n))
        .to.changeEtherBalance(criador, 341n);                  // 341, não 340

      expect(await hre.ethers.provider.getBalance(await wepledge.getAddress())).to.equal(0n);
    });

    it("tranche com resultado 0 por truncamento ainda é sacada com sucesso", async function () {
      // 1 wei, 50/50: T0 = 1*50/100 = 0 (trunca); T1 (remainder) = 1 - 0 = 1 wei.
      // sacarTranche com valorTranche=0 deve completar sem reverter.
      const { wepledge, criador, contrib1 } = await loadFixture(deploy);
      const agora = await time.latest();
      await wepledge.connect(criador).criarCampanha("T", "", 1n, agora + 3600,
        [
          { percentual: 50, tempoAposVesting: 0 },
          { percentual: 50, tempoAposVesting: UM_DIA },
        ]
      );
      await wepledge.connect(contrib1).contribuir(1n, { value: 1n });
      await wepledge.connect(criador).finalizarCampanha(1n);

      await expect(wepledge.connect(criador).sacarTranche(1n)).to.not.be.reverted; // 0 wei
      await advanceTime(UM_DIA);
      await expect(wepledge.connect(criador).sacarTranche(1n))
        .to.changeEtherBalance(criador, 1n);                    // remainder = 1 wei

      expect(await hre.ethers.provider.getBalance(await wepledge.getAddress())).to.equal(0n);
    });

    it("overfunding: criador saca sobre o total arrecadado, não sobre a meta", async function () {
      // meta = 1 ETH; contrib = 1.5 ETH. Tranche 100% → saca 1.5 ETH, não 1 ETH.
      const { wepledge, criador, contrib1 } = await loadFixture(deploy);
      const agora = await time.latest();
      const meta  = hre.ethers.parseEther("1");
      const total = hre.ethers.parseEther("1.5");
      await wepledge.connect(criador).criarCampanha("T", "", meta, agora + 3600,
        [{ percentual: 100, tempoAposVesting: 0 }]
      );
      await wepledge.connect(contrib1).contribuir(1n, { value: total });
      await wepledge.connect(criador).finalizarCampanha(1n);

      await expect(wepledge.connect(criador).sacarTranche(1n))
        .to.changeEtherBalance(criador, total);
    });
  });
});
