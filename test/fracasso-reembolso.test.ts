import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { deploy } from "./helpers/deploy";

async function campanhaSubMetaFixture() {
  const base = await deploy();
  const { wepledge, criador, contrib1 } = base;
  const agora        = await time.latest();
  const prazoCaptacao = agora + 3600;
  const meta          = hre.ethers.parseEther("2");
  await wepledge.connect(criador).criarCampanha(
    "Campanha Teste", "Descrição.",
    meta, prazoCaptacao,
    [{ percentual: 100, tempoAposVesting: 0 }]
  );
  await wepledge.connect(contrib1).contribuir(1n, { value: hre.ethers.parseEther("0.5") });
  return { ...base, idCampanha: 1n, meta, prazoCaptacao };
}

async function campanhaExpiradaFixture() {
  const base = await campanhaSubMetaFixture();
  await time.setNextBlockTimestamp(base.prazoCaptacao + 1);
  await hre.ethers.provider.send("evm_mine", []);
  return base;
}

async function campanhaFracassadaFixture() {
  const base = await campanhaExpiradaFixture();
  await base.wepledge.connect(base.terceiro).marcarFracasso(base.idCampanha);
  return base;
}

describe("marcarFracasso e reembolsar", function () {

  describe("marcarFracasso", function () {
    it("transiciona para Fracassada", async function () {
      const { wepledge, terceiro, idCampanha } = await loadFixture(campanhaExpiradaFixture);
      await wepledge.connect(terceiro).marcarFracasso(idCampanha);
      const c = await wepledge.campanhas(idCampanha);
      expect(c.estado).to.equal(3n);
    });

    it("emite CampanhaFracassada com valorArrecadado", async function () {
      const { wepledge, terceiro, idCampanha } = await loadFixture(campanhaExpiradaFixture);
      await expect(wepledge.connect(terceiro).marcarFracasso(idCampanha))
        .to.emit(wepledge, "CampanhaFracassada")
        .withArgs(idCampanha, hre.ethers.parseEther("0.5"));
    });

    it("pode ser chamada por qualquer endereço", async function () {
      const { wepledge, terceiro, idCampanha } = await loadFixture(campanhaExpiradaFixture);
      await expect(wepledge.connect(terceiro).marcarFracasso(idCampanha)).to.not.be.reverted;
    });

    it("pode ser chamada pelo criador", async function () {
      const { wepledge, criador, idCampanha } = await loadFixture(campanhaExpiradaFixture);
      await expect(wepledge.connect(criador).marcarFracasso(idCampanha)).to.not.be.reverted;
    });

    it("pode ser chamada por um contribuinte", async function () {
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaExpiradaFixture);
      await expect(wepledge.connect(contrib1).marcarFracasso(idCampanha)).to.not.be.reverted;
    });

    it("rejeita se o prazo ainda não expirou", async function () {
      const { wepledge, terceiro, idCampanha, prazoCaptacao } = await loadFixture(campanhaSubMetaFixture);
      await time.setNextBlockTimestamp(prazoCaptacao - 1);
      await hre.ethers.provider.send("evm_mine", []);
      await expect(wepledge.connect(terceiro).marcarFracasso(idCampanha))
        .to.be.revertedWith("WePledge: prazo nao expirou");
    });

    it("rejeita exatamente no segundo do prazoCaptacao (boundary estrito)", async function () {
      // contribuir usa <= (inclusivo); marcarFracasso usa > (estrito).
      // No segundo exato do prazo: contribuir ainda aceita, marcarFracasso rejeita.
      const { wepledge, terceiro, idCampanha, prazoCaptacao } = await loadFixture(campanhaSubMetaFixture);
      await time.setNextBlockTimestamp(prazoCaptacao);
      await expect(wepledge.connect(terceiro).marcarFracasso(idCampanha))
        .to.be.revertedWith("WePledge: prazo nao expirou");
    });

    it("rejeita se a meta foi atingida (usar marcarAbandono)", async function () {
      const { wepledge, criador, contrib1, terceiro } = await loadFixture(deploy);
      const agora = await time.latest();
      const meta  = hre.ethers.parseEther("1");
      const prazo = agora + 3600;
      await wepledge.connect(criador).criarCampanha("T", "", meta, prazo, [{ percentual: 100, tempoAposVesting: 0 }]);
      await wepledge.connect(contrib1).contribuir(1n, { value: meta });
      await time.setNextBlockTimestamp(prazo + 1);
      await hre.ethers.provider.send("evm_mine", []);
      await expect(wepledge.connect(terceiro).marcarFracasso(1n))
        .to.be.revertedWith("WePledge: meta foi atingida");
    });

    it("rejeita campanha já Fracassada", async function () {
      const { wepledge, terceiro, idCampanha } = await loadFixture(campanhaFracassadaFixture);
      await expect(wepledge.connect(terceiro).marcarFracasso(idCampanha))
        .to.be.revertedWith("WePledge: campanha nao esta em captacao");
    });

    it("rejeita campanha em EmVesting", async function () {
      const { wepledge, criador, contrib1, terceiro } = await loadFixture(deploy);
      const agora = await time.latest();
      const meta  = hre.ethers.parseEther("1");
      await wepledge.connect(criador).criarCampanha("T", "", meta, agora + 3600, [{ percentual: 100, tempoAposVesting: 0 }]);
      await wepledge.connect(contrib1).contribuir(1n, { value: meta });
      await wepledge.connect(criador).finalizarCampanha(1n);
      await expect(wepledge.connect(terceiro).marcarFracasso(1n))
        .to.be.revertedWith("WePledge: campanha nao esta em captacao");
    });

    it("rejeita campanha inexistente", async function () {
      const { wepledge, terceiro } = await loadFixture(deploy);
      await expect(wepledge.connect(terceiro).marcarFracasso(999n))
        .to.be.revertedWith("WePledge: campanha inexistente");
    });
  });

  describe("reembolsar", function () {
    it("reembolsa o valor correto ao contribuinte", async function () {
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaFracassadaFixture);
      await expect(wepledge.connect(contrib1).reembolsar(idCampanha))
        .to.changeEtherBalance(contrib1, hre.ethers.parseEther("0.5"));
    });

    it("reembolsa 1 wei corretamente", async function () {
      const { wepledge, criador, contrib1, terceiro } = await loadFixture(deploy);
      const agora = await time.latest();
      const prazo = agora + 3600;
      await wepledge.connect(criador).criarCampanha("T", "", hre.ethers.parseEther("1"), prazo, [{ percentual: 100, tempoAposVesting: 0 }]);
      await wepledge.connect(contrib1).contribuir(1n, { value: 1n });
      await time.setNextBlockTimestamp(prazo + 1);
      await hre.ethers.provider.send("evm_mine", []);
      await wepledge.connect(terceiro).marcarFracasso(1n);
      await expect(wepledge.connect(contrib1).reembolsar(1n))
        .to.changeEtherBalance(contrib1, 1n);
    });

    it("reduz o saldo do contrato", async function () {
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaFracassadaFixture);
      await expect(wepledge.connect(contrib1).reembolsar(idCampanha))
        .to.changeEtherBalance(wepledge, -hre.ethers.parseEther("0.5"));
    });

    it("zera saldoContribuido após reembolso", async function () {
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaFracassadaFixture);
      await wepledge.connect(contrib1).reembolsar(idCampanha);
      expect(
        await wepledge.saldoContribuido(idCampanha, await contrib1.getAddress())
      ).to.equal(0n);
    });

    it("emite Reembolso com contribuinte e valor", async function () {
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaFracassadaFixture);
      await expect(wepledge.connect(contrib1).reembolsar(idCampanha))
        .to.emit(wepledge, "Reembolso")
        .withArgs(idCampanha, await contrib1.getAddress(), hre.ethers.parseEther("0.5"));
    });

    it("múltiplos contribuintes reembolsam individualmente; contrato termina zerado", async function () {
      const { wepledge, criador, contrib1, contrib2, terceiro } = await loadFixture(deploy);
      const agora = await time.latest();
      const prazo = agora + 3600;
      await wepledge.connect(criador).criarCampanha("T", "", hre.ethers.parseEther("10"), prazo, [{ percentual: 100, tempoAposVesting: 0 }]);
      const v1 = hre.ethers.parseEther("1.3");
      const v2 = hre.ethers.parseEther("0.7");
      await wepledge.connect(contrib1).contribuir(1n, { value: v1 });
      await wepledge.connect(contrib2).contribuir(1n, { value: v2 });
      await time.setNextBlockTimestamp(prazo + 1);
      await hre.ethers.provider.send("evm_mine", []);
      await wepledge.connect(terceiro).marcarFracasso(1n);
      await wepledge.connect(contrib1).reembolsar(1n);
      await wepledge.connect(contrib2).reembolsar(1n);
      expect(await hre.ethers.provider.getBalance(await wepledge.getAddress())).to.equal(0n);
    });

    it("contribuinte com múltiplas contribuições recebe o total acumulado", async function () {
      const { wepledge, criador, contrib1, terceiro } = await loadFixture(deploy);
      const agora = await time.latest();
      const prazo = agora + 3600;
      await wepledge.connect(criador).criarCampanha("T", "", hre.ethers.parseEther("5"), prazo, [{ percentual: 100, tempoAposVesting: 0 }]);
      const v1 = hre.ethers.parseEther("0.3");
      const v2 = hre.ethers.parseEther("0.7");
      await wepledge.connect(contrib1).contribuir(1n, { value: v1 });
      await wepledge.connect(contrib1).contribuir(1n, { value: v2 });
      await time.setNextBlockTimestamp(prazo + 1);
      await hre.ethers.provider.send("evm_mine", []);
      await wepledge.connect(terceiro).marcarFracasso(1n);
      await expect(wepledge.connect(contrib1).reembolsar(1n))
        .to.changeEtherBalance(contrib1, v1 + v2);
    });

    it("rejeita duplo reembolso", async function () {
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaFracassadaFixture);
      await wepledge.connect(contrib1).reembolsar(idCampanha);
      await expect(wepledge.connect(contrib1).reembolsar(idCampanha))
        .to.be.revertedWith("WePledge: sem saldo para reembolso");
    });

    it("rejeita endereço que nunca contribuiu", async function () {
      const { wepledge, terceiro, idCampanha } = await loadFixture(campanhaFracassadaFixture);
      await expect(wepledge.connect(terceiro).reembolsar(idCampanha))
        .to.be.revertedWith("WePledge: sem saldo para reembolso");
    });

    it("rejeita reembolso em campanha Captacao", async function () {
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaSubMetaFixture);
      await expect(wepledge.connect(contrib1).reembolsar(idCampanha))
        .to.be.revertedWith("WePledge: campanha nao esta fracassada");
    });

    it("rejeita reembolso em campanha EmVesting", async function () {
      const { wepledge, criador, contrib1 } = await loadFixture(deploy);
      const agora = await time.latest();
      const meta  = hre.ethers.parseEther("1");
      await wepledge.connect(criador).criarCampanha("T", "", meta, agora + 3600, [{ percentual: 100, tempoAposVesting: 0 }]);
      await wepledge.connect(contrib1).contribuir(1n, { value: meta });
      await wepledge.connect(criador).finalizarCampanha(1n);
      await expect(wepledge.connect(contrib1).reembolsar(1n))
        .to.be.revertedWith("WePledge: campanha nao esta fracassada");
    });

    it("rejeita campanha inexistente", async function () {
      const { wepledge, contrib1 } = await loadFixture(deploy);
      await expect(wepledge.connect(contrib1).reembolsar(999n))
        .to.be.revertedWith("WePledge: campanha inexistente");
    });
  });
});
