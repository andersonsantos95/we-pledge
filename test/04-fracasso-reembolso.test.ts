/**
 * Fase 4 — marcarFracasso + reembolsar
 *
 * Estes testes cobrem o caminho de falha da campanha: quando o prazo de captação
 * expira sem atingir a meta, qualquer pessoa pode declarar o fracasso e cada
 * contribuinte pode recuperar individualmente o seu aporte.
 *
 * Máquina de estados exercitada:
 *   Captacao → Fracassada (marcarFracasso)
 *
 * Invariantes centrais:
 *   - Fracasso só é declarável após prazo estritamente expirado e com meta não atingida.
 *   - Qualquer endereço pode chamar marcarFracasso — fato objetivo, sem restrição.
 *   - Reembolso é pull-payment individual; saldo zerado antes da transferência (CEI).
 *   - Duplo-reembolso impossível: saldo zerado na primeira chamada.
 *   - Soma de todos os reembolsos == valorArrecadado; contrato termina com balance zero.
 */

import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre from "hardhat";

// ─── Constantes ───────────────────────────────────────────────────────────────

const JANELA_FINALIZACAO = 2 * 60;
const JANELA_ABANDONO    = 5 * 60;
const MAX_TRANCHES       = 5;
const MAX_PRAZO_CAPTACAO = 365 * 24 * 3600;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

async function deployFixture() {
  const [deployer, criador, contrib1, contrib2, terceiro] = await hre.ethers.getSigners();

  const WePledge = await hre.ethers.getContractFactory("WePledge");
  const wepledge = await WePledge.deploy(
    JANELA_FINALIZACAO,
    JANELA_ABANDONO,
    MAX_TRANCHES,
    MAX_PRAZO_CAPTACAO
  );

  return { wepledge, deployer, criador, contrib1, contrib2, terceiro };
}

// Campanha com prazo curto (1h) e meta de 2 ETH; contrib1 aportou 0.5 ETH (abaixo da meta).
async function campanhaAbertaSubMetaFixture() {
  const base = await deployFixture();
  const { wepledge, criador, contrib1 } = base;

  const agora        = await time.latest();
  const prazoCaptacao = agora + 3600; // 1 hora
  const meta          = hre.ethers.parseEther("2");

  await wepledge.connect(criador).criarCampanha(
    meta,
    prazoCaptacao,
    [{ percentual: 100, tempoAposVesting: 0 }]
  );

  await wepledge.connect(contrib1).contribuir(1n, { value: hre.ethers.parseEther("0.5") });

  return { ...base, idCampanha: 1n, meta, prazoCaptacao };
}

// Campanha já com prazo expirado e meta não atingida (pronta para marcarFracasso).
async function campanhaExpiradaFixture() {
  const base = await campanhaAbertaSubMetaFixture();
  await time.setNextBlockTimestamp(base.prazoCaptacao + 1);
  await hre.ethers.provider.send("evm_mine", []);
  return base;
}

// Campanha fracassada (Fracassada).
async function campanhaFracassadaFixture() {
  const base = await campanhaExpiradaFixture();
  const { wepledge, terceiro, idCampanha } = base;
  await wepledge.connect(terceiro).marcarFracasso(idCampanha);
  return base;
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe("WePledge — Fase 4: marcarFracasso e reembolsar", function () {

  // ── marcarFracasso ───────────────────────────────────────────────────────────
  describe("marcarFracasso", function () {

    it("transiciona para Fracassada após prazo expirado sem meta", async function () {
      // Captacao → Fracassada: transição terminal de falha.
      const { wepledge, terceiro, idCampanha } = await loadFixture(campanhaExpiradaFixture);

      await wepledge.connect(terceiro).marcarFracasso(idCampanha);

      const campanha = await wepledge.campanhas(idCampanha);
      expect(campanha.estado).to.equal(3n); // EstadoCampanha.Fracassada = 3
    });

    it("emite CampanhaFracassada com valorArrecadado correto", async function () {
      const { wepledge, terceiro, idCampanha } = await loadFixture(campanhaExpiradaFixture);
      const valorEsperado = hre.ethers.parseEther("0.5");

      await expect(wepledge.connect(terceiro).marcarFracasso(idCampanha))
        .to.emit(wepledge, "CampanhaFracassada")
        .withArgs(idCampanha, valorEsperado);
    });

    it("pode ser chamada por qualquer endereço — inclusive quem nunca contribuiu", async function () {
      // Fracasso é fato objetivo; não exige autorização de criador ou contribuinte.
      const { wepledge, terceiro, idCampanha } = await loadFixture(campanhaExpiradaFixture);

      await expect(
        wepledge.connect(terceiro).marcarFracasso(idCampanha)
      ).to.not.be.reverted;
    });

    it("pode ser chamada pelo próprio criador", async function () {
      const { wepledge, criador, idCampanha } = await loadFixture(campanhaExpiradaFixture);

      await expect(
        wepledge.connect(criador).marcarFracasso(idCampanha)
      ).to.not.be.reverted;
    });

    it("pode ser chamada por um contribuinte", async function () {
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaExpiradaFixture);

      await expect(
        wepledge.connect(contrib1).marcarFracasso(idCampanha)
      ).to.not.be.reverted;
    });

    it("rejeita se o prazo ainda não expirou", async function () {
      // Boundary: 1 segundo antes do prazo, marcarFracasso deve falhar.
      const { wepledge, terceiro, idCampanha, prazoCaptacao } = await loadFixture(campanhaAbertaSubMetaFixture);

      await time.setNextBlockTimestamp(prazoCaptacao - 1);
      await hre.ethers.provider.send("evm_mine", []);

      await expect(
        wepledge.connect(terceiro).marcarFracasso(idCampanha)
      ).to.be.revertedWith("WePledge: prazo nao expirou");
    });

    it("rejeita se o prazo expirou mas a meta foi atingida", async function () {
      // Meta atingida + prazo expirado = abandono (Fase 5), não fracasso.
      const { wepledge, criador, contrib1, terceiro } = await loadFixture(deployFixture);
      const agora = await time.latest();
      const meta  = hre.ethers.parseEther("1");
      const prazo = agora + 3600;

      await wepledge.connect(criador).criarCampanha(
        meta, prazo, [{ percentual: 100, tempoAposVesting: 0 }]
      );
      await wepledge.connect(contrib1).contribuir(1n, { value: meta });

      await time.setNextBlockTimestamp(prazo + 1);
      await hre.ethers.provider.send("evm_mine", []);

      await expect(
        wepledge.connect(terceiro).marcarFracasso(1n)
      ).to.be.revertedWith("WePledge: meta foi atingida");
    });

    it("rejeita campanha já Fracassada (estado terminal)", async function () {
      const { wepledge, terceiro, idCampanha } = await loadFixture(campanhaFracassadaFixture);

      await expect(
        wepledge.connect(terceiro).marcarFracasso(idCampanha)
      ).to.be.revertedWith("WePledge: campanha nao esta em captacao");
    });

    it("rejeita campanha em EmVesting", async function () {
      // Campanha que atingiu meta e foi finalizada não pode fracassar.
      const { wepledge, criador, contrib1, terceiro } = await loadFixture(deployFixture);
      const agora = await time.latest();
      const meta  = hre.ethers.parseEther("1");

      await wepledge.connect(criador).criarCampanha(
        meta, agora + 3600, [{ percentual: 100, tempoAposVesting: 0 }]
      );
      await wepledge.connect(contrib1).contribuir(1n, { value: meta });
      await wepledge.connect(criador).finalizarCampanha(1n);

      await expect(
        wepledge.connect(terceiro).marcarFracasso(1n)
      ).to.be.revertedWith("WePledge: campanha nao esta em captacao");
    });

    it("rejeita campanha inexistente", async function () {
      const { wepledge, terceiro } = await loadFixture(deployFixture);

      await expect(
        wepledge.connect(terceiro).marcarFracasso(999n)
      ).to.be.revertedWith("WePledge: campanha inexistente");
    });
  });

  // ── reembolsar ───────────────────────────────────────────────────────────────
  describe("reembolsar", function () {

    it("reembolsa o valor correto ao contribuinte", async function () {
      // contrib1 aportou 0.5 ETH — deve receber exatamente 0.5 ETH de volta.
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaFracassadaFixture);
      const valorEsperado = hre.ethers.parseEther("0.5");

      await expect(
        wepledge.connect(contrib1).reembolsar(idCampanha)
      ).to.changeEtherBalance(contrib1, valorEsperado);
    });

    it("reduz o saldo do contrato pelo valor reembolsado", async function () {
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaFracassadaFixture);
      const valorEsperado = hre.ethers.parseEther("0.5");

      await expect(
        wepledge.connect(contrib1).reembolsar(idCampanha)
      ).to.changeEtherBalance(wepledge, -valorEsperado);
    });

    it("zera saldoContribuido após reembolso", async function () {
      // Invariante CEI: saldo zerado antes da transferência protege contra duplo-reembolso.
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaFracassadaFixture);

      await wepledge.connect(contrib1).reembolsar(idCampanha);

      expect(
        await wepledge.saldoContribuido(idCampanha, await contrib1.getAddress())
      ).to.equal(0n);
    });

    it("emite evento Reembolso com contribuinte e valor corretos", async function () {
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaFracassadaFixture);
      const valor = hre.ethers.parseEther("0.5");

      await expect(wepledge.connect(contrib1).reembolsar(idCampanha))
        .to.emit(wepledge, "Reembolso")
        .withArgs(idCampanha, await contrib1.getAddress(), valor);
    });

    it("múltiplos contribuintes reembolsam individualmente; contrato termina zerado", async function () {
      // Invariante financeira: soma dos reembolsos == valorArrecadado; sem dust preso.
      const { wepledge, criador, contrib1, contrib2, terceiro } = await loadFixture(deployFixture);
      const agora = await time.latest();
      const meta  = hre.ethers.parseEther("10"); // meta alta, nunca atingida
      const prazo = agora + 3600;

      await wepledge.connect(criador).criarCampanha(
        meta, prazo, [{ percentual: 100, tempoAposVesting: 0 }]
      );

      const v1 = hre.ethers.parseEther("1.3");
      const v2 = hre.ethers.parseEther("0.7");
      await wepledge.connect(contrib1).contribuir(1n, { value: v1 });
      await wepledge.connect(contrib2).contribuir(1n, { value: v2 });

      await time.setNextBlockTimestamp(prazo + 1);
      await hre.ethers.provider.send("evm_mine", []);
      await wepledge.connect(terceiro).marcarFracasso(1n);

      await wepledge.connect(contrib1).reembolsar(1n);
      await wepledge.connect(contrib2).reembolsar(1n);

      expect(
        await hre.ethers.provider.getBalance(await wepledge.getAddress())
      ).to.equal(0n);
    });

    it("contribuinte que aportou múltiplas vezes recebe o total acumulado", async function () {
      // saldoContribuido acumula contribuições múltiplas; reembolso devolve o total.
      const { wepledge, criador, contrib1, terceiro } = await loadFixture(deployFixture);
      const agora = await time.latest();
      const meta  = hre.ethers.parseEther("5");
      const prazo = agora + 3600;

      await wepledge.connect(criador).criarCampanha(
        meta, prazo, [{ percentual: 100, tempoAposVesting: 0 }]
      );

      const v1 = hre.ethers.parseEther("0.3");
      const v2 = hre.ethers.parseEther("0.7");
      await wepledge.connect(contrib1).contribuir(1n, { value: v1 });
      await wepledge.connect(contrib1).contribuir(1n, { value: v2 });

      await time.setNextBlockTimestamp(prazo + 1);
      await hre.ethers.provider.send("evm_mine", []);
      await wepledge.connect(terceiro).marcarFracasso(1n);

      await expect(
        wepledge.connect(contrib1).reembolsar(1n)
      ).to.changeEtherBalance(contrib1, v1 + v2);
    });

    it("rejeita duplo reembolso (proteção CEI)", async function () {
      // Saldo zerado na primeira chamada; segunda chamada deve reverter.
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaFracassadaFixture);

      await wepledge.connect(contrib1).reembolsar(idCampanha);

      await expect(
        wepledge.connect(contrib1).reembolsar(idCampanha)
      ).to.be.revertedWith("WePledge: sem saldo para reembolso");
    });

    it("rejeita reembolso de endereço que nunca contribuiu", async function () {
      // terceiro não aportou nada; saldoContribuido == 0.
      const { wepledge, terceiro, idCampanha } = await loadFixture(campanhaFracassadaFixture);

      await expect(
        wepledge.connect(terceiro).reembolsar(idCampanha)
      ).to.be.revertedWith("WePledge: sem saldo para reembolso");
    });

    it("rejeita reembolso de campanha em Captacao", async function () {
      // Reembolso só disponível em Fracassada.
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaAbertaSubMetaFixture);

      await expect(
        wepledge.connect(contrib1).reembolsar(idCampanha)
      ).to.be.revertedWith("WePledge: campanha nao esta fracassada");
    });

    it("rejeita reembolso de campanha em EmVesting", async function () {
      const { wepledge, criador, contrib1 } = await loadFixture(deployFixture);
      const agora = await time.latest();
      const meta  = hre.ethers.parseEther("1");

      await wepledge.connect(criador).criarCampanha(
        meta, agora + 3600, [{ percentual: 100, tempoAposVesting: 0 }]
      );
      await wepledge.connect(contrib1).contribuir(1n, { value: meta });
      await wepledge.connect(criador).finalizarCampanha(1n);

      await expect(
        wepledge.connect(contrib1).reembolsar(1n)
      ).to.be.revertedWith("WePledge: campanha nao esta fracassada");
    });

    it("rejeita campanha inexistente", async function () {
      const { wepledge, contrib1 } = await loadFixture(deployFixture);

      await expect(
        wepledge.connect(contrib1).reembolsar(999n)
      ).to.be.revertedWith("WePledge: campanha inexistente");
    });
  });
});
