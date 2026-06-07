/**
 * Fase 2 — contribuir
 *
 * Estes testes cobrem a fase de captação: aportes de ETH por contribuintes,
 * acumulação de saldo, overfunding, e a emissão do evento MetaAtingida.
 *
 * Máquina de estados exercitada: permanece em Captacao durante toda esta fase.
 * Invariantes centrais:
 *   - saldoContribuido[id][addr] acumula todas as contribuições daquele endereço.
 *   - campanhas[id].valorArrecadado reflete a soma de todos os aportes.
 *   - MetaAtingida é emitido exatamente uma vez, no instante do cruzamento.
 *   - Após o prazo ou fora do estado Captacao, contribuir reverte.
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

// Fixture com campanha já criada; retorna o id e o prazoCaptacao.
async function campanhaAbertaFixture() {
  const base = await deployFixture();
  const { wepledge, criador } = base;

  const agora = await time.latest();
  const prazoCaptacao = agora + 7 * 24 * 3600; // 7 dias
  const meta = hre.ethers.parseEther("2");      // 2 ETH

  await wepledge.connect(criador).criarCampanha(
    meta,
    prazoCaptacao,
    [
      { percentual: 50, tempoAposVesting: 0 },
      { percentual: 50, tempoAposVesting: 30 * 24 * 3600 },
    ]
  );

  return { ...base, idCampanha: 1n, meta, prazoCaptacao };
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe("WePledge — Fase 2: contribuir", function () {

  // ── Caminho feliz ────────────────────────────────────────────────────────────
  describe("caminho feliz", function () {

    it("aceita contribuição válida e atualiza valorArrecadado", async function () {
      // Transição observável: valorArrecadado cresce após cada aporte.
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaAbertaFixture);
      const valor = hre.ethers.parseEther("0.5");

      await wepledge.connect(contrib1).contribuir(idCampanha, { value: valor });

      const campanha = await wepledge.campanhas(idCampanha);
      expect(campanha.valorArrecadado).to.equal(valor);
    });

    it("atualiza saldoContribuido do contribuinte", async function () {
      // Invariante: saldo individual rastreia o total aportado por aquele endereço.
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaAbertaFixture);
      const valor = hre.ethers.parseEther("0.3");

      await wepledge.connect(contrib1).contribuir(idCampanha, { value: valor });

      expect(
        await wepledge.saldoContribuido(idCampanha, await contrib1.getAddress())
      ).to.equal(valor);
    });

    it("acumula múltiplas contribuições do mesmo endereço", async function () {
      // += em saldoContribuido: contribuições não se sobrescrevem.
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaAbertaFixture);
      const v1 = hre.ethers.parseEther("0.3");
      const v2 = hre.ethers.parseEther("0.7");

      await wepledge.connect(contrib1).contribuir(idCampanha, { value: v1 });
      await wepledge.connect(contrib1).contribuir(idCampanha, { value: v2 });

      expect(
        await wepledge.saldoContribuido(idCampanha, await contrib1.getAddress())
      ).to.equal(v1 + v2);

      const campanha = await wepledge.campanhas(idCampanha);
      expect(campanha.valorArrecadado).to.equal(v1 + v2);
    });

    it("acumula contribuições de endereços diferentes, isolando saldos", async function () {
      // Storage nested mapping: saldos de contrib1 e contrib2 são independentes.
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

      const campanha = await wepledge.campanhas(idCampanha);
      expect(campanha.valorArrecadado).to.equal(v1 + v2);
    });

    it("emite evento Contribuicao com os argumentos corretos", async function () {
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaAbertaFixture);
      const valor = hre.ethers.parseEther("0.5");

      await expect(
        wepledge.connect(contrib1).contribuir(idCampanha, { value: valor })
      )
        .to.emit(wepledge, "Contribuicao")
        .withArgs(idCampanha, await contrib1.getAddress(), valor);
    });

    it("o contrato recebe o ETH corretamente (balance do contrato cresce)", async function () {
      // Verificação de invariante financeira: ETH não some entre o envio e o storage.
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaAbertaFixture);
      const valor = hre.ethers.parseEther("1");

      const saldoAntes = await hre.ethers.provider.getBalance(await wepledge.getAddress());
      await wepledge.connect(contrib1).contribuir(idCampanha, { value: valor });
      const saldoDepois = await hre.ethers.provider.getBalance(await wepledge.getAddress());

      expect(saldoDepois - saldoAntes).to.equal(valor);
    });
  });

  // ── MetaAtingida ─────────────────────────────────────────────────────────────
  describe("evento MetaAtingida", function () {

    it("emite MetaAtingida quando a meta é atingida exatamente", async function () {
      // Cruzamento exato: contribuição leva valorArrecadado de 0 para meta.
      const { wepledge, contrib1, idCampanha, meta } = await loadFixture(campanhaAbertaFixture);

      await expect(
        wepledge.connect(contrib1).contribuir(idCampanha, { value: meta })
      )
        .to.emit(wepledge, "MetaAtingida")
        .withArgs(idCampanha, meta, await time.latest() + 1);
        // +1: o timestamp do bloco da tx é latest+1 em Hardhat (novo bloco minerado).
    });

    it("emite MetaAtingida quando a meta é superada em uma única contribuição", async function () {
      // Overfunding imediato: contribuição vai além da meta de uma vez.
      const { wepledge, contrib1, idCampanha, meta } = await loadFixture(campanhaAbertaFixture);
      const valorExcedente = meta + hre.ethers.parseEther("0.5");

      await expect(
        wepledge.connect(contrib1).contribuir(idCampanha, { value: valorExcedente })
      ).to.emit(wepledge, "MetaAtingida");
    });

    it("emite MetaAtingida na contribuição que cruza a meta, não antes", async function () {
      // Série: contrib abaixo da meta não emite; contrib que cruza emite.
      const { wepledge, contrib1, contrib2, idCampanha, meta } = await loadFixture(campanhaAbertaFixture);

      // meta = 2 ETH; primeiro aporte: 1.5 ETH (abaixo)
      const parcial = hre.ethers.parseEther("1.5");
      await expect(
        wepledge.connect(contrib1).contribuir(idCampanha, { value: parcial })
      ).to.not.emit(wepledge, "MetaAtingida");

      // segundo aporte: 0.5 ETH (cruza a meta)
      const restante = meta - parcial;
      await expect(
        wepledge.connect(contrib2).contribuir(idCampanha, { value: restante })
      ).to.emit(wepledge, "MetaAtingida");
    });

    it("NÃO emite MetaAtingida em contribuições após o cruzamento (overfunding)", async function () {
      // Invariante: MetaAtingida é emitido exatamente uma vez por campanha.
      const { wepledge, contrib1, contrib2, idCampanha, meta } = await loadFixture(campanhaAbertaFixture);

      // Primeira contribuição cruza a meta.
      await wepledge.connect(contrib1).contribuir(idCampanha, { value: meta });

      // Contribuição subsequente (overfunding) não deve re-emitir.
      await expect(
        wepledge.connect(contrib2).contribuir(idCampanha, { value: hre.ethers.parseEther("0.1") })
      ).to.not.emit(wepledge, "MetaAtingida");
    });

    it("NÃO emite MetaAtingida quando a contribuição fica 1 wei abaixo da meta", async function () {
      // Off-by-one: meta - 1 wei não cruza o threshold.
      const { wepledge, contrib1, idCampanha, meta } = await loadFixture(campanhaAbertaFixture);

      await expect(
        wepledge.connect(contrib1).contribuir(idCampanha, { value: meta - 1n })
      ).to.not.emit(wepledge, "MetaAtingida");
    });
  });

  // ── Overfunding ───────────────────────────────────────────────────────────────
  describe("overfunding", function () {

    it("aceita contribuições após meta atingida enquanto o prazo não expirou", async function () {
      // Overfunding é permitido: criador pode sacar o excedente via tranches.
      const { wepledge, contrib1, contrib2, idCampanha, meta } = await loadFixture(campanhaAbertaFixture);

      await wepledge.connect(contrib1).contribuir(idCampanha, { value: meta });

      const excedente = hre.ethers.parseEther("0.5");
      await expect(
        wepledge.connect(contrib2).contribuir(idCampanha, { value: excedente })
      ).to.not.be.reverted;

      const campanha = await wepledge.campanhas(idCampanha);
      expect(campanha.valorArrecadado).to.equal(meta + excedente);
    });

    it("saldoContribuido reflete o total incluindo overfunding", async function () {
      // Se o contribuinte aportar além da meta, saldo individual inclui o excedente.
      const { wepledge, contrib1, idCampanha, meta } = await loadFixture(campanhaAbertaFixture);
      const totalAportado = meta + hre.ethers.parseEther("1");

      await wepledge.connect(contrib1).contribuir(idCampanha, { value: totalAportado });

      expect(
        await wepledge.saldoContribuido(idCampanha, await contrib1.getAddress())
      ).to.equal(totalAportado);
    });
  });

  // ── Validações de erro ────────────────────────────────────────────────────────
  describe("validações de erro", function () {

    it("rejeita contribuição a campanha inexistente (id 0)", async function () {
      // id 0 é sentinela: criador == address(0), validação de existência falha.
      const { wepledge, contrib1 } = await loadFixture(campanhaAbertaFixture);

      await expect(
        wepledge.connect(contrib1).contribuir(0n, { value: hre.ethers.parseEther("1") })
      ).to.be.revertedWith("WePledge: campanha inexistente");
    });

    it("rejeita contribuição a campanha inexistente (id alto)", async function () {
      const { wepledge, contrib1 } = await loadFixture(campanhaAbertaFixture);

      await expect(
        wepledge.connect(contrib1).contribuir(999n, { value: hre.ethers.parseEther("1") })
      ).to.be.revertedWith("WePledge: campanha inexistente");
    });

    it("rejeita contribuição com msg.value = 0", async function () {
      // Contribuição zero não altera estado mas consumiria gas e emitiria evento enganoso.
      const { wepledge, contrib1, idCampanha } = await loadFixture(campanhaAbertaFixture);

      await expect(
        wepledge.connect(contrib1).contribuir(idCampanha, { value: 0n })
      ).to.be.revertedWith("WePledge: contribuicao deve ser positiva");
    });

    it("rejeita contribuição após o prazo de captação expirar", async function () {
      // Avança o tempo para além do prazoCaptacao e verifica rejeição.
      const { wepledge, contrib1, idCampanha, prazoCaptacao } = await loadFixture(campanhaAbertaFixture);

      await advanceToTimestamp(prazoCaptacao + 1);

      await expect(
        wepledge.connect(contrib1).contribuir(idCampanha, { value: hre.ethers.parseEther("0.1") })
      ).to.be.revertedWith("WePledge: prazo de captacao expirou");
    });

    it("aceita contribuição no segundo exato do prazoCaptacao (boundary inclusivo)", async function () {
      // prazoCaptacao é inclusivo: block.timestamp == prazoCaptacao ainda é válido.
      // Usa setNextBlockTimestamp (sem minerar) para que a própria tx mine exatamente
      // em prazoCaptacao — advanceToTimestamp minera um bloco extra, deslocando +1.
      const { wepledge, contrib1, idCampanha, prazoCaptacao } = await loadFixture(campanhaAbertaFixture);

      await time.setNextBlockTimestamp(prazoCaptacao);

      await expect(
        wepledge.connect(contrib1).contribuir(idCampanha, { value: hre.ethers.parseEther("0.1") })
      ).to.not.be.reverted;
    });
  });

  // ── Isolamento entre campanhas ────────────────────────────────────────────────
  describe("isolamento entre campanhas", function () {

    it("contribuição em campanha 1 não afeta o saldo da campanha 2", async function () {
      // Invariante: nested mapping isola storage por (idCampanha, endereço).
      const { wepledge, criador, contrib1, contrib2 } = await loadFixture(deployFixture);
      const agora = await time.latest();
      const prazo = agora + 3600;

      await wepledge.connect(criador).criarCampanha(
        hre.ethers.parseEther("1"), prazo, [{ percentual: 100, tempoAposVesting: 0 }]
      );
      await wepledge.connect(criador).criarCampanha(
        hre.ethers.parseEther("1"), prazo, [{ percentual: 100, tempoAposVesting: 0 }]
      );

      await wepledge.connect(contrib1).contribuir(1n, { value: hre.ethers.parseEther("0.5") });

      // Saldo de contrib1 na campanha 2 deve ser zero.
      expect(
        await wepledge.saldoContribuido(2n, await contrib1.getAddress())
      ).to.equal(0n);

      // valorArrecadado da campanha 2 deve ser zero.
      const c2 = await wepledge.campanhas(2n);
      expect(c2.valorArrecadado).to.equal(0n);
    });
  });
});
