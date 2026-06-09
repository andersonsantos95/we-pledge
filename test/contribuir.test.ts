import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import hre from "hardhat";
import { deploy } from "./helpers/deploy";
import { advanceToTimestamp } from "./helpers/time";

async function campanhaAbertaFixture() {
  const base = await deploy();
  const { wepledge, criador } = base;
  const agora = await time.latest();
  const prazoCaptacao = agora + 7 * 24 * 3600;
  const meta = hre.ethers.parseEther("2");
  await wepledge.connect(criador).criarCampanha(
    "Campanha Teste", "Descrição.", meta, prazoCaptacao,
    [
      { percentual: 50, tempoAposVesting: 0 },
      { percentual: 50, tempoAposVesting: 30 * 24 * 3600 },
    ]
  );
  return { ...base, idCampanha: 1n, meta, prazoCaptacao };
}

describe("contribuir", function () {

  describe("caminho feliz", function () {
    it("aceita contribuição e atualiza valorArrecadado", async function () {
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaAbertaFixture);
      const valor = hre.ethers.parseEther("0.5");
      await wepledge.connect(contrib1).contribuir(idCampanha, { value: valor });
      const c = await wepledge.campanhas(idCampanha);
      expect(c.valorArrecadado).to.equal(valor);
    });

    it("aceita contribuição de 1 wei", async function () {
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaAbertaFixture);
      await wepledge.connect(contrib1).contribuir(idCampanha, { value: 1n });
      const c = await wepledge.campanhas(idCampanha);
      expect(c.valorArrecadado).to.equal(1n);
    });

    it("atualiza saldoContribuido do contribuinte", async function () {
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaAbertaFixture);
      const valor = hre.ethers.parseEther("0.3");
      await wepledge.connect(contrib1).contribuir(idCampanha, { value: valor });
      expect(
        await wepledge.saldoContribuido(idCampanha, await contrib1.getAddress())
      ).to.equal(valor);
    });

    it("acumula múltiplas contribuições do mesmo endereço", async function () {
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaAbertaFixture);
      const v1 = hre.ethers.parseEther("0.3");
      const v2 = hre.ethers.parseEther("0.7");
      await wepledge.connect(contrib1).contribuir(idCampanha, { value: v1 });
      await wepledge.connect(contrib1).contribuir(idCampanha, { value: v2 });
      expect(
        await wepledge.saldoContribuido(idCampanha, await contrib1.getAddress())
      ).to.equal(v1 + v2);
      const c = await wepledge.campanhas(idCampanha);
      expect(c.valorArrecadado).to.equal(v1 + v2);
    });

    it("isola saldos de contribuintes diferentes", async function () {
      const { wepledge, contrib1, contrib2, idCampanha } = await loadFixture(campanhaAbertaFixture);
      const v1 = hre.ethers.parseEther("0.4");
      const v2 = hre.ethers.parseEther("0.6");
      await wepledge.connect(contrib1).contribuir(idCampanha, { value: v1 });
      await wepledge.connect(contrib2).contribuir(idCampanha, { value: v2 });
      expect(
        await wepledge.saldoContribuido(idCampanha, await contrib1.getAddress())
      ).to.equal(v1);
      expect(
        await wepledge.saldoContribuido(idCampanha, await contrib2.getAddress())
      ).to.equal(v2);
      const c = await wepledge.campanhas(idCampanha);
      expect(c.valorArrecadado).to.equal(v1 + v2);
    });

    it("emite Contribuicao com os argumentos corretos", async function () {
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaAbertaFixture);
      const valor = hre.ethers.parseEther("0.5");
      await expect(
        wepledge.connect(contrib1).contribuir(idCampanha, { value: valor })
      ).to.emit(wepledge, "Contribuicao").withArgs(idCampanha, await contrib1.getAddress(), valor);
    });

    it("contrato recebe o ETH (balance cresce)", async function () {
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaAbertaFixture);
      const valor = hre.ethers.parseEther("1");
      await expect(
        wepledge.connect(contrib1).contribuir(idCampanha, { value: valor })
      ).to.changeEtherBalance(wepledge, valor);
    });
  });

  describe("MetaAtingida", function () {
    it("emite quando a meta é atingida exatamente", async function () {
      const { wepledge, contrib1, idCampanha, meta } = await loadFixture(campanhaAbertaFixture);
      await expect(
        wepledge.connect(contrib1).contribuir(idCampanha, { value: meta })
      ).to.emit(wepledge, "MetaAtingida").withArgs(idCampanha, meta, anyValue);
    });

    it("emite quando a meta é superada em uma única contribuição", async function () {
      const { wepledge, contrib1, idCampanha, meta } = await loadFixture(campanhaAbertaFixture);
      await expect(
        wepledge.connect(contrib1).contribuir(idCampanha, { value: meta + hre.ethers.parseEther("0.5") })
      ).to.emit(wepledge, "MetaAtingida");
    });

    it("emite apenas na contribuição que cruza a meta, não antes", async function () {
      const { wepledge, contrib1, contrib2, idCampanha, meta } = await loadFixture(campanhaAbertaFixture);
      const parcial = hre.ethers.parseEther("1.5");
      await expect(
        wepledge.connect(contrib1).contribuir(idCampanha, { value: parcial })
      ).to.not.emit(wepledge, "MetaAtingida");
      await expect(
        wepledge.connect(contrib2).contribuir(idCampanha, { value: meta - parcial })
      ).to.emit(wepledge, "MetaAtingida");
    });

    it("não emite em overfunding (segunda contribuição após meta)", async function () {
      const { wepledge, contrib1, contrib2, idCampanha, meta } = await loadFixture(campanhaAbertaFixture);
      await wepledge.connect(contrib1).contribuir(idCampanha, { value: meta });
      await expect(
        wepledge.connect(contrib2).contribuir(idCampanha, { value: hre.ethers.parseEther("0.1") })
      ).to.not.emit(wepledge, "MetaAtingida");
    });

    it("não emite quando a contribuição fica 1 wei abaixo da meta", async function () {
      const { wepledge, contrib1, idCampanha, meta } = await loadFixture(campanhaAbertaFixture);
      await expect(
        wepledge.connect(contrib1).contribuir(idCampanha, { value: meta - 1n })
      ).to.not.emit(wepledge, "MetaAtingida");
    });
  });

  describe("overfunding", function () {
    it("aceita contribuições após a meta enquanto o prazo não expirou", async function () {
      const { wepledge, contrib1, contrib2, idCampanha, meta } = await loadFixture(campanhaAbertaFixture);
      await wepledge.connect(contrib1).contribuir(idCampanha, { value: meta });
      const excedente = hre.ethers.parseEther("0.5");
      await expect(
        wepledge.connect(contrib2).contribuir(idCampanha, { value: excedente })
      ).to.not.be.reverted;
      const c = await wepledge.campanhas(idCampanha);
      expect(c.valorArrecadado).to.equal(meta + excedente);
    });

    it("saldoContribuido inclui o excedente", async function () {
      const { wepledge, contrib1, idCampanha, meta } = await loadFixture(campanhaAbertaFixture);
      const total = meta + hre.ethers.parseEther("1");
      await wepledge.connect(contrib1).contribuir(idCampanha, { value: total });
      expect(
        await wepledge.saldoContribuido(idCampanha, await contrib1.getAddress())
      ).to.equal(total);
    });
  });

  describe("validações de erro", function () {
    it("rejeita campanha inexistente (id 0)", async function () {
      const { wepledge, contrib1 } = await loadFixture(campanhaAbertaFixture);
      await expect(
        wepledge.connect(contrib1).contribuir(0n, { value: hre.ethers.parseEther("1") })
      ).to.be.revertedWith("WePledge: campanha inexistente");
    });

    it("rejeita campanha inexistente (id alto)", async function () {
      const { wepledge, contrib1 } = await loadFixture(campanhaAbertaFixture);
      await expect(
        wepledge.connect(contrib1).contribuir(999n, { value: hre.ethers.parseEther("1") })
      ).to.be.revertedWith("WePledge: campanha inexistente");
    });

    it("rejeita msg.value = 0", async function () {
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaAbertaFixture);
      await expect(
        wepledge.connect(contrib1).contribuir(idCampanha, { value: 0n })
      ).to.be.revertedWith("WePledge: contribuicao deve ser positiva");
    });

    it("rejeita contribuição após o prazo expirar", async function () {
      const { wepledge, contrib1, idCampanha, prazoCaptacao } = await loadFixture(campanhaAbertaFixture);
      await advanceToTimestamp(prazoCaptacao + 1);
      await expect(
        wepledge.connect(contrib1).contribuir(idCampanha, { value: hre.ethers.parseEther("0.1") })
      ).to.be.revertedWith("WePledge: prazo de captacao expirou");
    });

    it("aceita contribuição no segundo exato do prazoCaptacao (boundary inclusivo)", async function () {
      // setNextBlockTimestamp sem mine: a tx minera exatamente em prazoCaptacao.
      const { wepledge, contrib1, idCampanha, prazoCaptacao } = await loadFixture(campanhaAbertaFixture);
      await time.setNextBlockTimestamp(prazoCaptacao);
      await expect(
        wepledge.connect(contrib1).contribuir(idCampanha, { value: hre.ethers.parseEther("0.1") })
      ).to.not.be.reverted;
    });
  });

  describe("isolamento entre campanhas", function () {
    it("contribuição na campanha 1 não afeta o saldo da campanha 2", async function () {
      const { wepledge, criador, contrib1 } = await loadFixture(deploy);
      const agora = await time.latest();
      const prazo = agora + 3600;
      await wepledge.connect(criador).criarCampanha("A", "", hre.ethers.parseEther("1"), prazo, [{ percentual: 100, tempoAposVesting: 0 }]);
      await wepledge.connect(criador).criarCampanha("B", "", hre.ethers.parseEther("1"), prazo, [{ percentual: 100, tempoAposVesting: 0 }]);
      await wepledge.connect(contrib1).contribuir(1n, { value: hre.ethers.parseEther("0.5") });
      expect(await wepledge.saldoContribuido(2n, await contrib1.getAddress())).to.equal(0n);
      const c2 = await wepledge.campanhas(2n);
      expect(c2.valorArrecadado).to.equal(0n);
    });
  });
});
