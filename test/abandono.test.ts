import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { deploy, JANELA_FINALIZACAO, JANELA_ABANDONO } from "./helpers/deploy";
import { advanceToTimestamp } from "./helpers/time";

async function campanhaMetaAtingidaFixture() {
  const base = await deploy();
  const { wepledge, criador, contrib1 } = base;
  const agora         = await time.latest();
  const prazoCaptacao = agora + 3600;
  const meta          = hre.ethers.parseEther("1");
  await wepledge.connect(criador).criarCampanha(
    "Campanha Teste", "Descrição.",
    meta, prazoCaptacao,
    [{ percentual: 100, tempoAposVesting: 0 }]
  );
  await wepledge.connect(contrib1).contribuir(1n, { value: meta });
  return { ...base, idCampanha: 1n, meta, prazoCaptacao };
}

async function aposJanelaAbandonoFixture() {
  const base = await campanhaMetaAtingidaFixture();
  await advanceToTimestamp(base.prazoCaptacao + JANELA_FINALIZACAO + JANELA_ABANDONO + 1);
  return base;
}

describe("marcarAbandono", function () {

  describe("caminho feliz", function () {
    it("transiciona para Fracassada após janela de abandono expirar", async function () {
      const { wepledge, terceiro, idCampanha } = await loadFixture(aposJanelaAbandonoFixture);
      await wepledge.connect(terceiro).marcarAbandono(idCampanha);
      const c = await wepledge.campanhas(idCampanha);
      expect(c.estado).to.equal(3n);
    });

    it("emite CampanhaAbandonada", async function () {
      const { wepledge, terceiro, idCampanha } = await loadFixture(aposJanelaAbandonoFixture);
      await expect(wepledge.connect(terceiro).marcarAbandono(idCampanha))
        .to.emit(wepledge, "CampanhaAbandonada").withArgs(idCampanha);
    });

    it("pode ser chamada por terceiro", async function () {
      const { wepledge, terceiro, idCampanha } = await loadFixture(aposJanelaAbandonoFixture);
      await expect(wepledge.connect(terceiro).marcarAbandono(idCampanha)).to.not.be.reverted;
    });

    it("pode ser chamada pelo contribuinte", async function () {
      const { wepledge, contrib1, idCampanha } = await loadFixture(aposJanelaAbandonoFixture);
      await expect(wepledge.connect(contrib1).marcarAbandono(idCampanha)).to.not.be.reverted;
    });

    it("pode ser chamada pelo criador", async function () {
      const { wepledge, criador, idCampanha } = await loadFixture(aposJanelaAbandonoFixture);
      await expect(wepledge.connect(criador).marcarAbandono(idCampanha)).to.not.be.reverted;
    });

    it("funciona com overfunding", async function () {
      const { wepledge, contrib2, idCampanha, prazoCaptacao } = await loadFixture(campanhaMetaAtingidaFixture);
      await wepledge.connect(contrib2).contribuir(idCampanha, { value: hre.ethers.parseEther("0.5") });
      await advanceToTimestamp(prazoCaptacao + JANELA_FINALIZACAO + JANELA_ABANDONO + 1);
      await wepledge.connect(contrib2).marcarAbandono(idCampanha);
      const c = await wepledge.campanhas(idCampanha);
      expect(c.estado).to.equal(3n);
    });
  });

  describe("boundary da janela", function () {
    it("rejeita no segundo exato do limite (condição estrita >)", async function () {
      // O contrato usa >, não >=: no segundo exato ainda rejeita.
      const { wepledge, terceiro, idCampanha, prazoCaptacao } = await loadFixture(campanhaMetaAtingidaFixture);
      const limiteExato = prazoCaptacao + JANELA_FINALIZACAO + JANELA_ABANDONO;
      await time.setNextBlockTimestamp(limiteExato);
      await expect(wepledge.connect(terceiro).marcarAbandono(idCampanha))
        .to.be.revertedWith("WePledge: janela de abandono nao expirou");
    });

    it("aceita 1 segundo após o limite", async function () {
      const { wepledge, terceiro, idCampanha, prazoCaptacao } = await loadFixture(campanhaMetaAtingidaFixture);
      await advanceToTimestamp(prazoCaptacao + JANELA_FINALIZACAO + JANELA_ABANDONO + 1);
      await expect(wepledge.connect(terceiro).marcarAbandono(idCampanha)).to.not.be.reverted;
    });

    it("rejeita dentro da JANELA_FINALIZACAO (antes do JANELA_ABANDONO)", async function () {
      const { wepledge, terceiro, idCampanha, prazoCaptacao } = await loadFixture(campanhaMetaAtingidaFixture);
      await advanceToTimestamp(prazoCaptacao + JANELA_FINALIZACAO);
      await expect(wepledge.connect(terceiro).marcarAbandono(idCampanha))
        .to.be.revertedWith("WePledge: janela de abandono nao expirou");
    });
  });

  describe("validações de erro", function () {
    it("rejeita campanha inexistente (id 0)", async function () {
      const { wepledge, terceiro } = await loadFixture(aposJanelaAbandonoFixture);
      await expect(wepledge.connect(terceiro).marcarAbandono(0n))
        .to.be.revertedWith("WePledge: campanha inexistente");
    });

    it("rejeita campanha inexistente (id alto)", async function () {
      const { wepledge, terceiro } = await loadFixture(aposJanelaAbandonoFixture);
      await expect(wepledge.connect(terceiro).marcarAbandono(999n))
        .to.be.revertedWith("WePledge: campanha inexistente");
    });

    it("rejeita se a meta não foi atingida", async function () {
      const { wepledge, criador, terceiro } = await loadFixture(deploy);
      const agora         = await time.latest();
      const prazoCaptacao = agora + 3600;
      await wepledge.connect(criador).criarCampanha("T", "", hre.ethers.parseEther("2"), prazoCaptacao,
        [{ percentual: 100, tempoAposVesting: 0 }]);
      await wepledge.connect(terceiro).contribuir(1n, { value: hre.ethers.parseEther("1") });
      await advanceToTimestamp(prazoCaptacao + JANELA_FINALIZACAO + JANELA_ABANDONO + 1);
      await expect(wepledge.connect(terceiro).marcarAbandono(1n))
        .to.be.revertedWith("WePledge: meta nao foi atingida");
    });

    it("rejeita campanha em EmVesting (criador finalizou antes)", async function () {
      const { wepledge, criador, terceiro, idCampanha, prazoCaptacao } = await loadFixture(campanhaMetaAtingidaFixture);
      await wepledge.connect(criador).finalizarCampanha(idCampanha);
      await advanceToTimestamp(prazoCaptacao + JANELA_FINALIZACAO + JANELA_ABANDONO + 1);
      await expect(wepledge.connect(terceiro).marcarAbandono(idCampanha))
        .to.be.revertedWith("WePledge: campanha nao esta em captacao");
    });

    it("rejeita campanha já Fracassada (dupla chamada)", async function () {
      const { wepledge, terceiro, idCampanha } = await loadFixture(aposJanelaAbandonoFixture);
      await wepledge.connect(terceiro).marcarAbandono(idCampanha);
      await expect(wepledge.connect(terceiro).marcarAbandono(idCampanha))
        .to.be.revertedWith("WePledge: campanha nao esta em captacao");
    });
  });

  describe("exclusividade com marcarFracasso", function () {
    it("marcarFracasso rejeita quando meta foi atingida", async function () {
      const { wepledge, terceiro, idCampanha, prazoCaptacao } = await loadFixture(campanhaMetaAtingidaFixture);
      await advanceToTimestamp(prazoCaptacao + 1);
      await expect(wepledge.connect(terceiro).marcarFracasso(idCampanha))
        .to.be.revertedWith("WePledge: meta foi atingida");
    });
  });

  describe("reembolso após abandono", function () {
    it("contribuinte pode reembolsar após marcarAbandono", async function () {
      const { wepledge, contrib1, terceiro, idCampanha, meta } = await loadFixture(aposJanelaAbandonoFixture);
      await wepledge.connect(terceiro).marcarAbandono(idCampanha);
      await expect(wepledge.connect(contrib1).reembolsar(idCampanha))
        .to.changeEtherBalance(contrib1, meta);
    });

    it("emite Reembolso após abandono", async function () {
      const { wepledge, contrib1, terceiro, idCampanha, meta } = await loadFixture(aposJanelaAbandonoFixture);
      await wepledge.connect(terceiro).marcarAbandono(idCampanha);
      await expect(wepledge.connect(contrib1).reembolsar(idCampanha))
        .to.emit(wepledge, "Reembolso")
        .withArgs(idCampanha, await contrib1.getAddress(), meta);
    });

    it("contrato fica zerado após todos os reembolsos", async function () {
      const { wepledge, contrib1, contrib2, terceiro, idCampanha, prazoCaptacao } = await loadFixture(campanhaMetaAtingidaFixture);
      await wepledge.connect(contrib2).contribuir(idCampanha, { value: hre.ethers.parseEther("0.3") });
      await advanceToTimestamp(prazoCaptacao + JANELA_FINALIZACAO + JANELA_ABANDONO + 1);
      await wepledge.connect(terceiro).marcarAbandono(idCampanha);
      await wepledge.connect(contrib1).reembolsar(idCampanha);
      await wepledge.connect(contrib2).reembolsar(idCampanha);
      expect(await hre.ethers.provider.getBalance(await wepledge.getAddress())).to.equal(0n);
    });
  });
});
