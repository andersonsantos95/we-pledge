/**
 * Fase 5 — marcarAbandono
 *
 * Estes testes cobrem o mecanismo de abandono: campanha com meta atingida mas
 * criador que não chama finalizarCampanha dentro da janela composta
 * (prazoCaptacao + JANELA_FINALIZACAO + JANELA_ABANDONO).
 *
 * Máquina de estados exercitada: Captacao → Fracassada (via abandono).
 * Invariantes centrais:
 *   - marcarAbandono só é válido se valorArrecadado >= meta.
 *   - Disponível apenas quando block.timestamp > prazoCaptacao + JANELA_FINALIZACAO + JANELA_ABANDONO.
 *   - Qualquer endereço pode chamar.
 *   - Após Fracassada, reembolso fica disponível via reembolsar().
 *   - marcarFracasso rejeita campanha com meta atingida; os dois caminhos de fracasso são exclusivos.
 */

import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { advanceToTimestamp } from "./helpers/time";

// ─── Constantes de deploy ─────────────────────────────────────────────────────

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

// Campanha com meta atingida; criador ainda NÃO finalizou.
async function campanhaMetaAtingidaFixture() {
  const base = await deployFixture();
  const { wepledge, criador, contrib1 } = base;

  const agora = await time.latest();
  const prazoCaptacao = agora + 3600; // 1 hora
  const meta = hre.ethers.parseEther("1");

  await wepledge.connect(criador).criarCampanha(
    meta,
    prazoCaptacao,
    [{ percentual: 100, tempoAposVesting: 0 }]
  );
  const idCampanha = 1n;

  await wepledge.connect(contrib1).contribuir(idCampanha, { value: meta });

  return { ...base, idCampanha, meta, prazoCaptacao };
}

// Fixture já com o tempo posicionado 1 segundo após a janela de abandono expirar.
async function aposJanelaAbandonoFixture() {
  const base = await campanhaMetaAtingidaFixture();
  const { prazoCaptacao } = base;

  await advanceToTimestamp(prazoCaptacao + JANELA_FINALIZACAO + JANELA_ABANDONO + 1);

  return base;
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe("WePledge — Fase 5: marcarAbandono", function () {

  // ── Caminho feliz ────────────────────────────────────────────────────────────
  describe("caminho feliz", function () {

    it("transiciona para Fracassada após janela de abandono expirar", async function () {
      // Transição principal: Captacao → Fracassada via abandono.
      const { wepledge, terceiro, idCampanha } = await loadFixture(aposJanelaAbandonoFixture);

      await wepledge.connect(terceiro).marcarAbandono(idCampanha);

      const campanha = await wepledge.campanhas(idCampanha);
      expect(campanha.estado).to.equal(3); // EstadoCampanha.Fracassada
    });

    it("emite CampanhaAbandonada com id correto", async function () {
      const { wepledge, terceiro, idCampanha } = await loadFixture(aposJanelaAbandonoFixture);

      await expect(
        wepledge.connect(terceiro).marcarAbandono(idCampanha)
      ).to.emit(wepledge, "CampanhaAbandonada").withArgs(idCampanha);
    });

    it("pode ser chamada por terceiro (nunca contribuiu)", async function () {
      const { wepledge, terceiro, idCampanha } = await loadFixture(aposJanelaAbandonoFixture);

      await expect(
        wepledge.connect(terceiro).marcarAbandono(idCampanha)
      ).to.not.be.reverted;
    });

    it("pode ser chamada pelo contribuinte", async function () {
      const { wepledge, contrib1, idCampanha } = await loadFixture(aposJanelaAbandonoFixture);

      await expect(
        wepledge.connect(contrib1).marcarAbandono(idCampanha)
      ).to.not.be.reverted;
    });

    it("pode ser chamada pelo próprio criador", async function () {
      const { wepledge, criador, idCampanha } = await loadFixture(aposJanelaAbandonoFixture);

      await expect(
        wepledge.connect(criador).marcarAbandono(idCampanha)
      ).to.not.be.reverted;
    });

    it("marcarAbandono com overfunding: estado correto", async function () {
      // Overfunding não deve impedir o abandono — a condição é apenas >= meta.
      const { wepledge, contrib2, idCampanha, meta, prazoCaptacao } =
        await loadFixture(campanhaMetaAtingidaFixture);

      await wepledge.connect(contrib2).contribuir(idCampanha, {
        value: hre.ethers.parseEther("0.5"),
      });

      await advanceToTimestamp(prazoCaptacao + JANELA_FINALIZACAO + JANELA_ABANDONO + 1);

      await wepledge.connect(contrib2).marcarAbandono(idCampanha);

      const campanha = await wepledge.campanhas(idCampanha);
      expect(campanha.estado).to.equal(3); // Fracassada
    });
  });

  // ── Boundary ─────────────────────────────────────────────────────────────────
  describe("boundary da janela de abandono", function () {

    it("rejeita marcarAbandono exatamente no limite da janela (boundary estrito)", async function () {
      // block.timestamp == prazoCaptacao + JANELA_FINALIZACAO + JANELA_ABANDONO
      // Condição usa > (estrito): no segundo exato, ainda rejeita.
      // setNextBlockTimestamp sem evm_mine: a própria tx minera no timestamp alvo.
      const { wepledge, terceiro, idCampanha, prazoCaptacao } =
        await loadFixture(campanhaMetaAtingidaFixture);

      const limiteExato = prazoCaptacao + JANELA_FINALIZACAO + JANELA_ABANDONO;
      await time.setNextBlockTimestamp(limiteExato);

      await expect(
        wepledge.connect(terceiro).marcarAbandono(idCampanha)
      ).to.be.revertedWith("WePledge: janela de abandono nao expirou");
    });

    it("aceita marcarAbandono 1 segundo após o limite da janela", async function () {
      // block.timestamp == prazoCaptacao + JANELA_FINALIZACAO + JANELA_ABANDONO + 1
      // Primeiro segundo em que > é verdadeiro.
      const { wepledge, terceiro, idCampanha, prazoCaptacao } =
        await loadFixture(campanhaMetaAtingidaFixture);

      await advanceToTimestamp(prazoCaptacao + JANELA_FINALIZACAO + JANELA_ABANDONO + 1);

      await expect(
        wepledge.connect(terceiro).marcarAbandono(idCampanha)
      ).to.not.be.reverted;
    });
  });

  // ── Validações de erro ────────────────────────────────────────────────────────
  describe("validações de erro", function () {

    it("rejeita campanha inexistente (id 0)", async function () {
      const { wepledge, terceiro } = await loadFixture(aposJanelaAbandonoFixture);

      await expect(
        wepledge.connect(terceiro).marcarAbandono(0n)
      ).to.be.revertedWith("WePledge: campanha inexistente");
    });

    it("rejeita campanha inexistente (id alto)", async function () {
      const { wepledge, terceiro } = await loadFixture(aposJanelaAbandonoFixture);

      await expect(
        wepledge.connect(terceiro).marcarAbandono(999n)
      ).to.be.revertedWith("WePledge: campanha inexistente");
    });

    it("rejeita se a janela de abandono ainda não expirou", async function () {
      // Tempo dentro da janela: prazoCaptacao + JANELA_FINALIZACAO (sem JANELA_ABANDONO).
      const { wepledge, terceiro, idCampanha, prazoCaptacao } =
        await loadFixture(campanhaMetaAtingidaFixture);

      await advanceToTimestamp(prazoCaptacao + JANELA_FINALIZACAO);

      await expect(
        wepledge.connect(terceiro).marcarAbandono(idCampanha)
      ).to.be.revertedWith("WePledge: janela de abandono nao expirou");
    });

    it("rejeita se a meta não foi atingida (use marcarFracasso)", async function () {
      // Campanha abaixo da meta: o caminho correto é marcarFracasso, não marcarAbandono.
      const { wepledge, criador, terceiro } = await loadFixture(deployFixture);

      const agora = await time.latest();
      const prazoCaptacao = agora + 3600;
      const meta = hre.ethers.parseEther("2");

      await wepledge.connect(criador).criarCampanha(
        meta,
        prazoCaptacao,
        [{ percentual: 100, tempoAposVesting: 0 }]
      );

      // Contribui apenas 1 ETH (< meta de 2 ETH)
      await wepledge.connect(terceiro).contribuir(1n, {
        value: hre.ethers.parseEther("1"),
      });

      await advanceToTimestamp(prazoCaptacao + JANELA_FINALIZACAO + JANELA_ABANDONO + 1);

      await expect(
        wepledge.connect(terceiro).marcarAbandono(1n)
      ).to.be.revertedWith("WePledge: meta nao foi atingida");
    });

    it("rejeita campanha em EmVesting (criador finalizou antes do abandono)", async function () {
      // Se o criador chamou finalizarCampanha, a campanha passou para EmVesting.
      // marcarAbandono deve rejeitar pois o estado não é Captacao.
      const { wepledge, criador, terceiro, idCampanha, prazoCaptacao } =
        await loadFixture(campanhaMetaAtingidaFixture);

      // Criador finaliza antes da janela de abandono expirar.
      await wepledge.connect(criador).finalizarCampanha(idCampanha);

      await advanceToTimestamp(prazoCaptacao + JANELA_FINALIZACAO + JANELA_ABANDONO + 1);

      await expect(
        wepledge.connect(terceiro).marcarAbandono(idCampanha)
      ).to.be.revertedWith("WePledge: campanha nao esta em captacao");
    });

    it("rejeita campanha já Fracassada (estado terminal)", async function () {
      // Dupla chamada: segundo marcarAbandono deve falhar.
      const { wepledge, terceiro, idCampanha } = await loadFixture(aposJanelaAbandonoFixture);

      await wepledge.connect(terceiro).marcarAbandono(idCampanha);

      await expect(
        wepledge.connect(terceiro).marcarAbandono(idCampanha)
      ).to.be.revertedWith("WePledge: campanha nao esta em captacao");
    });
  });

  // ── Exclusividade com marcarFracasso ─────────────────────────────────────────
  describe("exclusividade com marcarFracasso", function () {

    it("marcarFracasso rejeita campanha com meta atingida (caminho exclusivo)", async function () {
      // Confirma que os dois caminhos de fracasso são mutuamente exclusivos:
      // marcarFracasso exige valorArrecadado < meta; aqui a meta foi atingida.
      const { wepledge, terceiro, idCampanha, prazoCaptacao } =
        await loadFixture(campanhaMetaAtingidaFixture);

      await advanceToTimestamp(prazoCaptacao + 1);

      await expect(
        wepledge.connect(terceiro).marcarFracasso(idCampanha)
      ).to.be.revertedWith("WePledge: meta foi atingida");
    });
  });

  // ── Integração com reembolso ──────────────────────────────────────────────────
  describe("integração com reembolso após abandono", function () {

    it("contribuinte pode reembolsar após marcarAbandono", async function () {
      // Estado Fracassada (via abandono) ativa reembolsar — mesmo caminho que marcarFracasso.
      const { wepledge, contrib1, terceiro, idCampanha, meta } =
        await loadFixture(aposJanelaAbandonoFixture);

      await wepledge.connect(terceiro).marcarAbandono(idCampanha);

      const saldoAntes = await hre.ethers.provider.getBalance(await contrib1.getAddress());
      const tx = await wepledge.connect(contrib1).reembolsar(idCampanha);
      const receipt = await tx.wait();
      const gasGasto = receipt!.gasUsed * receipt!.gasPrice;
      const saldoDepois = await hre.ethers.provider.getBalance(await contrib1.getAddress());

      // Contrib1 aportou a meta completa; deve receber tudo de volta menos gas.
      expect(saldoDepois - saldoAntes + gasGasto).to.equal(meta);
    });

    it("saldo do contrato vai a zero após todos os reembolsos", async function () {
      // Invariante financeira: após reembolso integral, contrato não retém ETH.
      const { wepledge, contrib1, contrib2, terceiro, idCampanha, meta, prazoCaptacao } =
        await loadFixture(campanhaMetaAtingidaFixture);

      // Contrib2 também contribui (overfunding)
      const extra = hre.ethers.parseEther("0.3");
      await wepledge.connect(contrib2).contribuir(idCampanha, { value: extra });

      await advanceToTimestamp(prazoCaptacao + JANELA_FINALIZACAO + JANELA_ABANDONO + 1);

      await wepledge.connect(terceiro).marcarAbandono(idCampanha);

      await wepledge.connect(contrib1).reembolsar(idCampanha);
      await wepledge.connect(contrib2).reembolsar(idCampanha);

      const saldoFinal = await hre.ethers.provider.getBalance(await wepledge.getAddress());
      expect(saldoFinal).to.equal(0n);
    });

    it("emite Reembolso após campanha marcada como abandonada", async function () {
      const { wepledge, contrib1, terceiro, idCampanha, meta } =
        await loadFixture(aposJanelaAbandonoFixture);

      await wepledge.connect(terceiro).marcarAbandono(idCampanha);

      await expect(
        wepledge.connect(contrib1).reembolsar(idCampanha)
      )
        .to.emit(wepledge, "Reembolso")
        .withArgs(idCampanha, await contrib1.getAddress(), meta);
    });
  });
});
