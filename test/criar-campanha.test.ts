import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import {
  deploy,
  JANELA_FINALIZACAO,
  JANELA_ABANDONO,
  MAX_TRANCHES,
  MAX_PRAZO_CAPTACAO,
} from "./helpers/deploy";

async function params() {
  const agora = await time.latest();
  return {
    nome:          "Campanha Teste",
    descricao:     "Descrição do projeto.",
    meta:          hre.ethers.parseEther("1"),
    prazoCaptacao: agora + 7 * 24 * 3600,
    cronograma: [
      { percentual: 50, tempoAposVesting: 0 },
      { percentual: 50, tempoAposVesting: 30 * 24 * 3600 },
    ],
  };
}

describe("criarCampanha", function () {

  describe("constructor", function () {
    it("armazena os parâmetros imutáveis", async function () {
      const { wepledge } = await loadFixture(deploy);
      expect(await wepledge.JANELA_FINALIZACAO()).to.equal(JANELA_FINALIZACAO);
      expect(await wepledge.JANELA_ABANDONO()).to.equal(JANELA_ABANDONO);
      expect(await wepledge.MAX_TRANCHES()).to.equal(MAX_TRANCHES);
      expect(await wepledge.MAX_PRAZO_CAPTACAO()).to.equal(MAX_PRAZO_CAPTACAO);
    });

    it("inicializa proximoId em 1", async function () {
      const { wepledge } = await loadFixture(deploy);
      expect(await wepledge.proximoId()).to.equal(1n);
    });

    it("rejeita janelaFinalizacao = 0", async function () {
      const WePledge = await hre.ethers.getContractFactory("WePledge");
      await expect(
        WePledge.deploy(0, JANELA_ABANDONO, MAX_TRANCHES, MAX_PRAZO_CAPTACAO)
      ).to.be.revertedWith("WePledge: janelaFinalizacao deve ser positiva");
    });

    it("rejeita janelaAbandono = 0", async function () {
      const WePledge = await hre.ethers.getContractFactory("WePledge");
      await expect(
        WePledge.deploy(JANELA_FINALIZACAO, 0, MAX_TRANCHES, MAX_PRAZO_CAPTACAO)
      ).to.be.revertedWith("WePledge: janelaAbandono deve ser positiva");
    });

    it("rejeita maxTranches = 0", async function () {
      const WePledge = await hre.ethers.getContractFactory("WePledge");
      await expect(
        WePledge.deploy(JANELA_FINALIZACAO, JANELA_ABANDONO, 0, MAX_PRAZO_CAPTACAO)
      ).to.be.revertedWith("WePledge: maxTranches deve ser positivo");
    });

    it("rejeita maxPrazoCaptacao = 0", async function () {
      const WePledge = await hre.ethers.getContractFactory("WePledge");
      await expect(
        WePledge.deploy(JANELA_FINALIZACAO, JANELA_ABANDONO, MAX_TRANCHES, 0)
      ).to.be.revertedWith("WePledge: maxPrazoCaptacao deve ser positivo");
    });
  });

  describe("caminho feliz", function () {
    it("retorna id = 1 para a primeira campanha", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const p = await params();
      const id = await wepledge.connect(criador).criarCampanha.staticCall(
        p.nome, p.descricao, p.meta, p.prazoCaptacao, p.cronograma
      );
      expect(id).to.equal(1n);
    });

    it("ids são incrementais independente do criador", async function () {
      const { wepledge, criador, contrib1 } = await loadFixture(deploy);
      const p = await params();
      await wepledge.connect(criador).criarCampanha(p.nome, p.descricao, p.meta, p.prazoCaptacao, p.cronograma);
      await wepledge.connect(contrib1).criarCampanha(p.nome, p.descricao, p.meta, p.prazoCaptacao, p.cronograma);
      expect(await wepledge.proximoId()).to.equal(3n);
      const c1 = await wepledge.campanhas(1n);
      const c2 = await wepledge.campanhas(2n);
      expect(c1.criador).to.equal(await criador.getAddress());
      expect(c2.criador).to.equal(await contrib1.getAddress());
    });

    it("armazena todos os campos escalares corretamente", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const p = await params();
      await wepledge.connect(criador).criarCampanha(p.nome, p.descricao, p.meta, p.prazoCaptacao, p.cronograma);
      const c = await wepledge.campanhas(1n);
      expect(c.criador).to.equal(await criador.getAddress());
      expect(c.nome).to.equal(p.nome);
      expect(c.descricao).to.equal(p.descricao);
      expect(c.meta).to.equal(p.meta);
      expect(c.prazoCaptacao).to.equal(BigInt(p.prazoCaptacao));
      expect(c.estado).to.equal(0n);
      expect(c.valorArrecadado).to.equal(0n);
      expect(c.valorJaSacado).to.equal(0n);
      expect(c.dataInicioVesting).to.equal(0n);
    });

    it("armazena cronograma via getCronograma", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const p = await params();
      await wepledge.connect(criador).criarCampanha(p.nome, p.descricao, p.meta, p.prazoCaptacao, p.cronograma);
      const cron = await wepledge.getCronograma(1n);
      expect(cron.length).to.equal(2);
      expect(cron[0].percentual).to.equal(50);
      expect(cron[0].tempoAposVesting).to.equal(0n);
      expect(cron[0].sacada).to.be.false;
      expect(cron[1].percentual).to.equal(50);
      expect(cron[1].tempoAposVesting).to.equal(BigInt(30 * 24 * 3600));
      expect(cron[1].sacada).to.be.false;
    });

    it("getTotalTranches retorna o número correto", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const p = await params();
      await wepledge.connect(criador).criarCampanha(p.nome, p.descricao, p.meta, p.prazoCaptacao, p.cronograma);
      expect(await wepledge.getTotalTranches(1n)).to.equal(2n);
    });

    it("emite CampanhaCriada com todos os campos", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const p = await params();
      await expect(
        wepledge.connect(criador).criarCampanha(p.nome, p.descricao, p.meta, p.prazoCaptacao, p.cronograma)
      ).to.emit(wepledge, "CampanhaCriada").withArgs(
        1n,
        await criador.getAddress(),
        p.nome,
        p.descricao,
        p.meta,
        BigInt(p.prazoCaptacao),
        [[50n, 0n, false], [50n, BigInt(30 * 24 * 3600), false]]
      );
    });

    it("aceita tranche única de 100%", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      await expect(
        wepledge.connect(criador).criarCampanha("T", "", hre.ethers.parseEther("1"), agora + 3600,
          [{ percentual: 100, tempoAposVesting: 0 }])
      ).to.not.be.reverted;
      expect(await wepledge.getTotalTranches(1n)).to.equal(1n);
    });

    it("aceita MAX_TRANCHES tranches", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      const cronograma = Array.from({ length: MAX_TRANCHES }, (_, i) => ({
        percentual: 20,
        tempoAposVesting: i * 86400,
      }));
      await expect(
        wepledge.connect(criador).criarCampanha("T", "", hre.ethers.parseEther("1"), agora + 3600, cronograma)
      ).to.not.be.reverted;
    });

    it("aceita meta de 1 wei", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      await expect(
        wepledge.connect(criador).criarCampanha("T", "", 1n, agora + 3600,
          [{ percentual: 100, tempoAposVesting: 0 }])
      ).to.not.be.reverted;
    });

    it("aceita prazo de 1 segundo no futuro", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      await expect(
        wepledge.connect(criador).criarCampanha("T", "", hre.ethers.parseEther("1"), agora + 1,
          [{ percentual: 100, tempoAposVesting: 0 }])
      ).to.not.be.reverted;
    });
  });

  describe("validação de meta", function () {
    it("rejeita meta = 0", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      await expect(
        wepledge.connect(criador).criarCampanha("T", "", 0n, agora + 3600,
          [{ percentual: 100, tempoAposVesting: 0 }])
      ).to.be.revertedWith("WePledge: meta deve ser positiva");
    });
  });

  describe("validação de prazo", function () {
    it("rejeita prazoCaptacao igual a block.timestamp", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      await expect(
        wepledge.connect(criador).criarCampanha("T", "", hre.ethers.parseEther("1"), agora,
          [{ percentual: 100, tempoAposVesting: 0 }])
      ).to.be.revertedWith("WePledge: prazo deve ser no futuro");
    });

    it("rejeita prazoCaptacao no passado", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      await expect(
        wepledge.connect(criador).criarCampanha("T", "", hre.ethers.parseEther("1"), agora - 1,
          [{ percentual: 100, tempoAposVesting: 0 }])
      ).to.be.revertedWith("WePledge: prazo deve ser no futuro");
    });

    it("rejeita prazo acima de MAX_PRAZO_CAPTACAO", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      await expect(
        wepledge.connect(criador).criarCampanha("T", "", hre.ethers.parseEther("1"),
          agora + MAX_PRAZO_CAPTACAO + 60,
          [{ percentual: 100, tempoAposVesting: 0 }])
      ).to.be.revertedWith("WePledge: prazo excede MAX_PRAZO_CAPTACAO");
    });

    it("aceita prazo exatamente em MAX_PRAZO_CAPTACAO", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      await expect(
        wepledge.connect(criador).criarCampanha("T", "", hre.ethers.parseEther("1"),
          agora + MAX_PRAZO_CAPTACAO,
          [{ percentual: 100, tempoAposVesting: 0 }])
      ).to.not.be.reverted;
    });
  });

  describe("validação de cronograma", function () {
    it("rejeita cronograma vazio", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      await expect(
        wepledge.connect(criador).criarCampanha("T", "", hre.ethers.parseEther("1"), agora + 3600, [])
      ).to.be.revertedWith("WePledge: cronograma vazio");
    });

    it("rejeita MAX_TRANCHES + 1 tranches", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      const muitasTranches = [
        { percentual: 17, tempoAposVesting: 0 },
        { percentual: 17, tempoAposVesting: 1 },
        { percentual: 17, tempoAposVesting: 2 },
        { percentual: 17, tempoAposVesting: 3 },
        { percentual: 16, tempoAposVesting: 4 },
        { percentual: 16, tempoAposVesting: 5 },
      ];
      await expect(
        wepledge.connect(criador).criarCampanha("T", "", hre.ethers.parseEther("1"), agora + 3600, muitasTranches)
      ).to.be.revertedWith("WePledge: muitas tranches");
    });

    it("rejeita percentuais com soma = 99", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      await expect(
        wepledge.connect(criador).criarCampanha("T", "", hre.ethers.parseEther("1"), agora + 3600,
          [{ percentual: 49, tempoAposVesting: 0 }, { percentual: 50, tempoAposVesting: 1 }])
      ).to.be.revertedWith("WePledge: percentuais devem somar 100");
    });

    it("rejeita percentuais com soma = 101", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      await expect(
        wepledge.connect(criador).criarCampanha("T", "", hre.ethers.parseEther("1"), agora + 3600,
          [{ percentual: 51, tempoAposVesting: 0 }, { percentual: 50, tempoAposVesting: 1 }])
      ).to.be.revertedWith("WePledge: percentuais devem somar 100");
    });

    it("rejeita tranche com percentual = 0", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      await expect(
        wepledge.connect(criador).criarCampanha("T", "", hre.ethers.parseEther("1"), agora + 3600,
          [{ percentual: 100, tempoAposVesting: 0 }, { percentual: 0, tempoAposVesting: 1 }])
      ).to.be.revertedWith("WePledge: percentual deve ser positivo");
    });

    it("rejeita tranches com tempoAposVesting iguais", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      await expect(
        wepledge.connect(criador).criarCampanha("T", "", hre.ethers.parseEther("1"), agora + 3600,
          [{ percentual: 50, tempoAposVesting: 100 }, { percentual: 50, tempoAposVesting: 100 }])
      ).to.be.revertedWith("WePledge: tempos devem ser estritamente crescentes");
    });

    it("rejeita tempoAposVesting decrescente", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      await expect(
        wepledge.connect(criador).criarCampanha("T", "", hre.ethers.parseEther("1"), agora + 3600,
          [{ percentual: 50, tempoAposVesting: 200 }, { percentual: 50, tempoAposVesting: 100 }])
      ).to.be.revertedWith("WePledge: tempos devem ser estritamente crescentes");
    });

    it("aceita tempoAposVesting = 0 apenas na primeira tranche", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      await expect(
        wepledge.connect(criador).criarCampanha("T", "", hre.ethers.parseEther("1"), agora + 3600,
          [
            { percentual: 30, tempoAposVesting: 0 },
            { percentual: 30, tempoAposVesting: 86400 },
            { percentual: 40, tempoAposVesting: 172800 },
          ])
      ).to.not.be.reverted;
    });

    it("aceita percentuais mínimos (1,1,1,1,96)", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      await expect(
        wepledge.connect(criador).criarCampanha("T", "", hre.ethers.parseEther("1"), agora + 3600,
          [
            { percentual: 1,  tempoAposVesting: 0 },
            { percentual: 1,  tempoAposVesting: 1 },
            { percentual: 1,  tempoAposVesting: 2 },
            { percentual: 1,  tempoAposVesting: 3 },
            { percentual: 96, tempoAposVesting: 4 },
          ])
      ).to.not.be.reverted;
    });
  });

  describe("validação de nome e descrição", function () {
    it("rejeita nome vazio", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      await expect(
        wepledge.connect(criador).criarCampanha("", "desc", hre.ethers.parseEther("1"), agora + 3600,
          [{ percentual: 100, tempoAposVesting: 0 }])
      ).to.be.revertedWith("WePledge: nome nao pode ser vazio");
    });

    it("rejeita nome com 201 bytes ASCII", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      await expect(
        wepledge.connect(criador).criarCampanha("A".repeat(201), "", hre.ethers.parseEther("1"), agora + 3600,
          [{ percentual: 100, tempoAposVesting: 0 }])
      ).to.be.revertedWith("WePledge: nome excede 200 bytes");
    });

    it("aceita nome com exatamente 200 bytes ASCII", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      await expect(
        wepledge.connect(criador).criarCampanha("A".repeat(200), "", hre.ethers.parseEther("1"), agora + 3600,
          [{ percentual: 100, tempoAposVesting: 0 }])
      ).to.not.be.reverted;
    });

    it("rejeita nome com 67 chars de 3 bytes UTF-8 (201 bytes)", async function () {
      // € = 3 bytes em UTF-8; 67 × 3 = 201 > 200.
      // Validadores que contam caracteres (não bytes) deixariam passar 67 < 100.
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      await expect(
        wepledge.connect(criador).criarCampanha("€".repeat(67), "", hre.ethers.parseEther("1"), agora + 3600,
          [{ percentual: 100, tempoAposVesting: 0 }])
      ).to.be.revertedWith("WePledge: nome excede 200 bytes");
    });

    it("aceita nome com 66 chars de 3 bytes UTF-8 (198 bytes)", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      await expect(
        wepledge.connect(criador).criarCampanha("€".repeat(66), "", hre.ethers.parseEther("1"), agora + 3600,
          [{ percentual: 100, tempoAposVesting: 0 }])
      ).to.not.be.reverted;
    });

    it("aceita descrição vazia", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      await expect(
        wepledge.connect(criador).criarCampanha("N", "", hre.ethers.parseEther("1"), agora + 3600,
          [{ percentual: 100, tempoAposVesting: 0 }])
      ).to.not.be.reverted;
    });

    it("rejeita descrição com 3001 bytes ASCII", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      await expect(
        wepledge.connect(criador).criarCampanha("N", "A".repeat(3001), hre.ethers.parseEther("1"), agora + 3600,
          [{ percentual: 100, tempoAposVesting: 0 }])
      ).to.be.revertedWith("WePledge: descricao excede 3000 bytes");
    });

    it("aceita descrição com exatamente 3000 bytes ASCII", async function () {
      const { wepledge, criador } = await loadFixture(deploy);
      const agora = await time.latest();
      await expect(
        wepledge.connect(criador).criarCampanha("N", "A".repeat(3000), hre.ethers.parseEther("1"), agora + 3600,
          [{ percentual: 100, tempoAposVesting: 0 }])
      ).to.not.be.reverted;
    });
  });

  describe("isolamento de storage", function () {
    it("id 0 retorna criador == address(0)", async function () {
      const { wepledge } = await loadFixture(deploy);
      const c = await wepledge.campanhas(0n);
      expect(c.criador).to.equal(hre.ethers.ZeroAddress);
    });

    it("campanhas distintas não compartilham storage", async function () {
      const { wepledge, criador, contrib1 } = await loadFixture(deploy);
      const agora = await time.latest();
      const meta1 = hre.ethers.parseEther("1");
      const meta2 = hre.ethers.parseEther("5");
      await wepledge.connect(criador).criarCampanha("A", "", meta1, agora + 3600, [{ percentual: 100, tempoAposVesting: 0 }]);
      await wepledge.connect(contrib1).criarCampanha("B", "", meta2, agora + 7200, [{ percentual: 100, tempoAposVesting: 0 }]);
      const c1 = await wepledge.campanhas(1n);
      const c2 = await wepledge.campanhas(2n);
      expect(c1.meta).to.equal(meta1);
      expect(c2.meta).to.equal(meta2);
      expect(c1.criador).to.not.equal(c2.criador);
    });
  });

  describe("receive() — ETH direto", function () {
    it("rejeita ETH enviado diretamente ao contrato", async function () {
      const { wepledge, terceiro } = await loadFixture(deploy);
      await expect(
        terceiro.sendTransaction({ to: await wepledge.getAddress(), value: hre.ethers.parseEther("1") })
      ).to.be.revertedWith("WePledge: use contribuir()");
    });
  });
});
