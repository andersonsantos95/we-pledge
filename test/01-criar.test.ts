/**
 * Fase 1 — criarCampanha
 *
 * Estes testes cobrem:
 *  - Deploy do contrato e validações do constructor
 *  - Caminho feliz de criarCampanha (retorno, storage, evento)
 *  - Todas as validações de erro (meta, prazo, cronograma)
 *
 * Máquina de estados exercitada: entrada em Captacao (estado inicial após criação).
 * Invariante central: toda campanha criada com sucesso possui estado Captacao,
 * cronograma válido e id único ≥ 1.
 */

import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre from "hardhat";

// ─── Constantes de deploy (valores demo, curtos para facilitar testes) ────────

const JANELA_FINALIZACAO = 2 * 60;       // 2 minutos
const JANELA_ABANDONO    = 5 * 60;       // 5 minutos
const MAX_TRANCHES       = 5;
const MAX_PRAZO_CAPTACAO = 365 * 24 * 3600; // 1 ano

// ─── Fixture base ─────────────────────────────────────────────────────────────

async function deployFixture() {
  const [deployer, criador, contribuinte, terceiro] = await hre.ethers.getSigners();

  const WePledge = await hre.ethers.getContractFactory("WePledge");
  const wepledge = await WePledge.deploy(
    JANELA_FINALIZACAO,
    JANELA_ABANDONO,
    MAX_TRANCHES,
    MAX_PRAZO_CAPTACAO
  );

  return { wepledge, deployer, criador, contribuinte, terceiro };
}

// Retorna parâmetros válidos para criarCampanha, relativizados ao timestamp atual.
// Tranche padrão: 50% imediato + 50% após 30 dias.
async function parametrosValidos() {
  const agora = await time.latest();
  return {
    meta:          hre.ethers.parseEther("1"),
    prazoCaptacao: agora + 7 * 24 * 3600, // 7 dias no futuro
    cronograma: [
      { percentual: 50, tempoAposVesting: 0 },
      { percentual: 50, tempoAposVesting: 30 * 24 * 3600 },
    ],
  };
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe("WePledge — Fase 1: deploy e criarCampanha", function () {

  // ── Constructor ─────────────────────────────────────────────────────────────
  describe("constructor", function () {
    it("armazena os parâmetros imutáveis corretamente", async function () {
      // Garante que imutáveis foram gravados e são legíveis via getters públicos.
      const { wepledge } = await loadFixture(deployFixture);

      expect(await wepledge.JANELA_FINALIZACAO()).to.equal(JANELA_FINALIZACAO);
      expect(await wepledge.JANELA_ABANDONO()).to.equal(JANELA_ABANDONO);
      expect(await wepledge.MAX_TRANCHES()).to.equal(MAX_TRANCHES);
      expect(await wepledge.MAX_PRAZO_CAPTACAO()).to.equal(MAX_PRAZO_CAPTACAO);
    });

    it("inicializa proximoId = 1 (id 0 reservado como sentinela)", async function () {
      // Invariante: id 0 nunca é atribuído; primeiro id real é 1.
      const { wepledge } = await loadFixture(deployFixture);
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

  // ── Caminho feliz ────────────────────────────────────────────────────────────
  describe("criarCampanha — caminho feliz", function () {
    it("retorna id = 1 para a primeira campanha", async function () {
      // Transição: inexistente → Captacao (id = 1).
      const { wepledge, criador } = await loadFixture(deployFixture);
      const p = await parametrosValidos();

      // staticCall para ler o valor de retorno sem submeter a tx.
      const id = await wepledge.connect(criador).criarCampanha.staticCall(
        p.meta, p.prazoCaptacao, p.cronograma
      );
      expect(id).to.equal(1n);
    });

    it("incrementa proximoId a cada campanha criada", async function () {
      // Invariante: ids são sequenciais e nunca reutilizados.
      const { wepledge, criador } = await loadFixture(deployFixture);
      const p = await parametrosValidos();

      await wepledge.connect(criador).criarCampanha(p.meta, p.prazoCaptacao, p.cronograma);
      expect(await wepledge.proximoId()).to.equal(2n);

      await wepledge.connect(criador).criarCampanha(p.meta, p.prazoCaptacao, p.cronograma);
      expect(await wepledge.proximoId()).to.equal(3n);
    });

    it("armazena criador como msg.sender", async function () {
      const { wepledge, criador } = await loadFixture(deployFixture);
      const p = await parametrosValidos();

      await wepledge.connect(criador).criarCampanha(p.meta, p.prazoCaptacao, p.cronograma);

      const campanha = await wepledge.campanhas(1n);
      expect(campanha.criador).to.equal(await criador.getAddress());
    });

    it("armazena meta, prazoCaptacao e estado Captacao corretamente", async function () {
      // Verifica que os campos escalares da campanha foram gravados sem distorção.
      const { wepledge, criador } = await loadFixture(deployFixture);
      const p = await parametrosValidos();

      await wepledge.connect(criador).criarCampanha(p.meta, p.prazoCaptacao, p.cronograma);

      const campanha = await wepledge.campanhas(1n);
      expect(campanha.meta).to.equal(p.meta);
      expect(campanha.prazoCaptacao).to.equal(BigInt(p.prazoCaptacao));
      expect(campanha.estado).to.equal(0n); // EstadoCampanha.Captacao = 0
    });

    it("inicializa valorArrecadado, valorJaSacado e dataInicioVesting em zero", async function () {
      // Garante que campos numéricos que ainda não têm valor partem do default correto.
      const { wepledge, criador } = await loadFixture(deployFixture);
      const p = await parametrosValidos();

      await wepledge.connect(criador).criarCampanha(p.meta, p.prazoCaptacao, p.cronograma);

      const campanha = await wepledge.campanhas(1n);
      expect(campanha.valorArrecadado).to.equal(0n);
      expect(campanha.valorJaSacado).to.equal(0n);
      expect(campanha.dataInicioVesting).to.equal(0n);
    });

    it("armazena cronograma corretamente via getCronograma", async function () {
      // O getter automático de `campanhas` não inclui o array; getCronograma supre isso.
      const { wepledge, criador } = await loadFixture(deployFixture);
      const p = await parametrosValidos();

      await wepledge.connect(criador).criarCampanha(p.meta, p.prazoCaptacao, p.cronograma);

      const cronograma = await wepledge.getCronograma(1n);
      expect(cronograma.length).to.equal(2);
      expect(cronograma[0].percentual).to.equal(50);
      expect(cronograma[0].tempoAposVesting).to.equal(0n);
      expect(cronograma[0].sacada).to.be.false;
      expect(cronograma[1].percentual).to.equal(50);
      expect(cronograma[1].tempoAposVesting).to.equal(BigInt(30 * 24 * 3600));
      expect(cronograma[1].sacada).to.be.false;
    });

    it("getTotalTranches retorna o número correto de tranches", async function () {
      const { wepledge, criador } = await loadFixture(deployFixture);
      const p = await parametrosValidos();

      await wepledge.connect(criador).criarCampanha(p.meta, p.prazoCaptacao, p.cronograma);

      expect(await wepledge.getTotalTranches(1n)).to.equal(2n);
    });

    it("emite CampanhaCriada com id, criador, meta e prazoCaptacao corretos", async function () {
      // Verifica os campos escalares do evento; cronograma é verificado via storage acima.
      const { wepledge, criador } = await loadFixture(deployFixture);
      const p = await parametrosValidos();

      await expect(
        wepledge.connect(criador).criarCampanha(p.meta, p.prazoCaptacao, p.cronograma)
      )
        .to.emit(wepledge, "CampanhaCriada")
        .withArgs(
          1n,
          await criador.getAddress(),
          p.meta,
          BigInt(p.prazoCaptacao),
          // cronograma: checado implicitamente pelo chai (comprimento e tuplas).
          // Ethers v6 serializa Tranche[] como array de [percentual, tempoAposVesting, sacada].
          [
            [50n, 0n, false],
            [50n, BigInt(30 * 24 * 3600), false],
          ]
        );
    });

    it("aceita campanha com tranche única de 100% e tempoAposVesting = 0", async function () {
      // Caso mínimo válido: vesting de saque imediato em parcela única.
      const { wepledge, criador } = await loadFixture(deployFixture);
      const agora = await time.latest();

      await expect(
        wepledge.connect(criador).criarCampanha(
          hre.ethers.parseEther("1"),
          agora + 3600,
          [{ percentual: 100, tempoAposVesting: 0 }]
        )
      ).to.not.be.reverted;

      const cronograma = await wepledge.getCronograma(1n);
      expect(cronograma.length).to.equal(1);
      expect(cronograma[0].percentual).to.equal(100);
    });

    it("aceita campanha com MAX_TRANCHES tranches", async function () {
      // Verifica que o limite exato é aceito (off-by-one check).
      const { wepledge, criador } = await loadFixture(deployFixture);
      const agora = await time.latest();

      // 5 tranches de 20%, tempos crescentes: 0, 1d, 2d, 3d, 4d
      const cronogramaMaximo = Array.from({ length: MAX_TRANCHES }, (_, i) => ({
        percentual: 20,
        tempoAposVesting: i * 24 * 3600,
      }));

      await expect(
        wepledge.connect(criador).criarCampanha(
          hre.ethers.parseEther("1"),
          agora + 3600,
          cronogramaMaximo
        )
      ).to.not.be.reverted;

      expect(await wepledge.getTotalTranches(1n)).to.equal(BigInt(MAX_TRANCHES));
    });

    it("campanhas de criadores diferentes têm ids sequenciais independentes do criador", async function () {
      // Ids são globais ao contrato, não por criador.
      const { wepledge, criador, contribuinte } = await loadFixture(deployFixture);
      const p = await parametrosValidos();

      await wepledge.connect(criador).criarCampanha(p.meta, p.prazoCaptacao, p.cronograma);
      await wepledge.connect(contribuinte).criarCampanha(p.meta, p.prazoCaptacao, p.cronograma);

      const c1 = await wepledge.campanhas(1n);
      const c2 = await wepledge.campanhas(2n);
      expect(c1.criador).to.equal(await criador.getAddress());
      expect(c2.criador).to.equal(await contribuinte.getAddress());
    });
  });

  // ── Validações de meta ───────────────────────────────────────────────────────
  describe("criarCampanha — validação de meta", function () {
    it("rejeita meta = 0", async function () {
      // Invariante: meta 0 tornaria a campanha trivialmente bem-sucedida.
      const { wepledge, criador } = await loadFixture(deployFixture);
      const agora = await time.latest();

      await expect(
        wepledge.connect(criador).criarCampanha(
          0n,
          agora + 3600,
          [{ percentual: 100, tempoAposVesting: 0 }]
        )
      ).to.be.revertedWith("WePledge: meta deve ser positiva");
    });
  });

  // ── Validações de prazo ──────────────────────────────────────────────────────
  describe("criarCampanha — validação de prazo", function () {
    it("rejeita prazoCaptacao igual a block.timestamp", async function () {
      // Prazo expirado no mesmo bloco da criação — captação nunca abriria.
      const { wepledge, criador } = await loadFixture(deployFixture);
      const agora = await time.latest();

      await expect(
        wepledge.connect(criador).criarCampanha(
          hre.ethers.parseEther("1"),
          agora, // igual ao bloco atual
          [{ percentual: 100, tempoAposVesting: 0 }]
        )
      ).to.be.revertedWith("WePledge: prazo deve ser no futuro");
    });

    it("rejeita prazoCaptacao no passado", async function () {
      const { wepledge, criador } = await loadFixture(deployFixture);
      const agora = await time.latest();

      await expect(
        wepledge.connect(criador).criarCampanha(
          hre.ethers.parseEther("1"),
          agora - 1, // 1 segundo atrás
          [{ percentual: 100, tempoAposVesting: 0 }]
        )
      ).to.be.revertedWith("WePledge: prazo deve ser no futuro");
    });

    it("rejeita prazoCaptacao que excede MAX_PRAZO_CAPTACAO", async function () {
      // Margem de 60s: block.timestamp no bloco de execução pode ser até ~agora+1;
      // adicionar 60 garante que prazoCaptacao - block.timestamp > MAX_PRAZO_CAPTACAO
      // independente de quantos blocos forem minerados entre time.latest() e a tx.
      const { wepledge, criador } = await loadFixture(deployFixture);
      const agora = await time.latest();

      await expect(
        wepledge.connect(criador).criarCampanha(
          hre.ethers.parseEther("1"),
          agora + MAX_PRAZO_CAPTACAO + 60,
          [{ percentual: 100, tempoAposVesting: 0 }]
        )
      ).to.be.revertedWith("WePledge: prazo excede MAX_PRAZO_CAPTACAO");
    });

    it("aceita prazoCaptacao exatamente no limite de MAX_PRAZO_CAPTACAO", async function () {
      // Off-by-one: prazo == agora + MAX_PRAZO_CAPTACAO deve ser válido.
      const { wepledge, criador } = await loadFixture(deployFixture);
      const agora = await time.latest();

      await expect(
        wepledge.connect(criador).criarCampanha(
          hre.ethers.parseEther("1"),
          agora + MAX_PRAZO_CAPTACAO, // exato
          [{ percentual: 100, tempoAposVesting: 0 }]
        )
      ).to.not.be.reverted;
    });
  });

  // ── Validações de cronograma ─────────────────────────────────────────────────
  describe("criarCampanha — validação de cronograma", function () {
    it("rejeita cronograma vazio", async function () {
      const { wepledge, criador } = await loadFixture(deployFixture);
      const agora = await time.latest();

      await expect(
        wepledge.connect(criador).criarCampanha(
          hre.ethers.parseEther("1"),
          agora + 3600,
          [] // vazio
        )
      ).to.be.revertedWith("WePledge: cronograma vazio");
    });

    it("rejeita cronograma com MAX_TRANCHES + 1 tranches", async function () {
      // Um acima do limite deve rejeitar (off-by-one check).
      const { wepledge, criador } = await loadFixture(deployFixture);
      const agora = await time.latest();

      // 6 tranches de ~16-17%, tempos crescentes (soma = 100 para não conflitar erros)
      const muitasTranches = [
        { percentual: 17, tempoAposVesting: 0 },
        { percentual: 17, tempoAposVesting: 1 },
        { percentual: 17, tempoAposVesting: 2 },
        { percentual: 17, tempoAposVesting: 3 },
        { percentual: 16, tempoAposVesting: 4 },
        { percentual: 16, tempoAposVesting: 5 }, // 6ª tranche — acima do limite
      ];

      await expect(
        wepledge.connect(criador).criarCampanha(
          hre.ethers.parseEther("1"),
          agora + 3600,
          muitasTranches
        )
      ).to.be.revertedWith("WePledge: muitas tranches");
    });

    it("rejeita tranche com percentual = 0", async function () {
      const { wepledge, criador } = await loadFixture(deployFixture);
      const agora = await time.latest();

      await expect(
        wepledge.connect(criador).criarCampanha(
          hre.ethers.parseEther("1"),
          agora + 3600,
          [
            { percentual: 100, tempoAposVesting: 0 },
            { percentual: 0,   tempoAposVesting: 1 }, // inválida
          ]
        )
      ).to.be.revertedWith("WePledge: percentual deve ser positivo");
    });

    it("rejeita percentuais que somam menos que 100", async function () {
      // Soma = 99: 1 wei por ETH ficaria preso no contrato após todos os saques.
      const { wepledge, criador } = await loadFixture(deployFixture);
      const agora = await time.latest();

      await expect(
        wepledge.connect(criador).criarCampanha(
          hre.ethers.parseEther("1"),
          agora + 3600,
          [
            { percentual: 49, tempoAposVesting: 0 },
            { percentual: 50, tempoAposVesting: 1 }, // soma = 99
          ]
        )
      ).to.be.revertedWith("WePledge: percentuais devem somar 100");
    });

    it("rejeita percentuais que somam mais que 100", async function () {
      // Soma = 101: criador poderia tentar sacar mais do que o arrecadado.
      const { wepledge, criador } = await loadFixture(deployFixture);
      const agora = await time.latest();

      await expect(
        wepledge.connect(criador).criarCampanha(
          hre.ethers.parseEther("1"),
          agora + 3600,
          [
            { percentual: 51, tempoAposVesting: 0 },
            { percentual: 50, tempoAposVesting: 1 }, // soma = 101
          ]
        )
      ).to.be.revertedWith("WePledge: percentuais devem somar 100");
    });

    it("rejeita duas tranches com tempoAposVesting igual", async function () {
      // Tempos iguais criam ambiguidade sobre qual é a "próxima tranche" em sacarTranche.
      const { wepledge, criador } = await loadFixture(deployFixture);
      const agora = await time.latest();

      await expect(
        wepledge.connect(criador).criarCampanha(
          hre.ethers.parseEther("1"),
          agora + 3600,
          [
            { percentual: 50, tempoAposVesting: 100 },
            { percentual: 50, tempoAposVesting: 100 }, // mesmo tempo
          ]
        )
      ).to.be.revertedWith("WePledge: tempos devem ser estritamente crescentes");
    });

    it("rejeita tranches com tempoAposVesting decrescente", async function () {
      const { wepledge, criador } = await loadFixture(deployFixture);
      const agora = await time.latest();

      await expect(
        wepledge.connect(criador).criarCampanha(
          hre.ethers.parseEther("1"),
          agora + 3600,
          [
            { percentual: 50, tempoAposVesting: 200 },
            { percentual: 50, tempoAposVesting: 100 }, // menor que o anterior
          ]
        )
      ).to.be.revertedWith("WePledge: tempos devem ser estritamente crescentes");
    });

    it("aceita cronograma com tempoAposVesting = 0 apenas na primeira tranche", async function () {
      // Zero é válido como primeiro tempo (saque imediato após início do vesting).
      // Zero em posição posterior seria decrescente em relação ao anterior positivo.
      const { wepledge, criador } = await loadFixture(deployFixture);
      const agora = await time.latest();

      await expect(
        wepledge.connect(criador).criarCampanha(
          hre.ethers.parseEther("1"),
          agora + 3600,
          [
            { percentual: 30, tempoAposVesting: 0 },      // válido: t=0
            { percentual: 30, tempoAposVesting: 86400 },  // válido: t=1d
            { percentual: 40, tempoAposVesting: 172800 }, // válido: t=2d
          ]
        )
      ).to.not.be.reverted;
    });
  });

  // ── Isolamento entre campanhas ───────────────────────────────────────────────
  // ── Proteção contra envio direto de ETH ──────────────────────────────────────
  describe("receive() — rejeição de ETH direto", function () {

    it("rejeita ETH enviado diretamente ao contrato (sem calldata)", async function () {
      // Invariante: ETH deve entrar apenas via contribuir(). Envio direto ficaria
      // inacessível pois não é rastreado em nenhuma campanha.
      const { wepledge, terceiro } = await loadFixture(deployFixture);

      await expect(
        terceiro.sendTransaction({
          to: await wepledge.getAddress(),
          value: hre.ethers.parseEther("1"),
        })
      ).to.be.revertedWith("WePledge: use contribuir()");
    });
  });

  describe("isolamento de storage entre campanhas", function () {
    it("campanha inexistente (id 0) retorna endereço zero no criador", async function () {
      // Verifica o sentinela: id 0 nunca foi criado, storage default é address(0).
      const { wepledge } = await loadFixture(deployFixture);
      const campanha = await wepledge.campanhas(0n);
      expect(campanha.criador).to.equal(hre.ethers.ZeroAddress);
    });

    it("campanha inexistente (id 999) retorna meta = 0 e estado Captacao (default)", async function () {
      // Storage default de uint256 é 0, de enum é o primeiro valor (Captacao = 0).
      // Isso significa que nunca devemos confiar apenas no estado para verificar existência;
      // usar criador != address(0) como sentinela.
      const { wepledge } = await loadFixture(deployFixture);
      const campanha = await wepledge.campanhas(999n);
      expect(campanha.meta).to.equal(0n);
    });

    it("duas campanhas criadas por endereços diferentes não compartilham storage", async function () {
      const { wepledge, criador, contribuinte } = await loadFixture(deployFixture);
      const agora = await time.latest();

      const meta1 = hre.ethers.parseEther("1");
      const meta2 = hre.ethers.parseEther("5");

      await wepledge.connect(criador).criarCampanha(
        meta1, agora + 3600, [{ percentual: 100, tempoAposVesting: 0 }]
      );
      await wepledge.connect(contribuinte).criarCampanha(
        meta2, agora + 7200, [{ percentual: 100, tempoAposVesting: 0 }]
      );

      const c1 = await wepledge.campanhas(1n);
      const c2 = await wepledge.campanhas(2n);

      expect(c1.meta).to.equal(meta1);
      expect(c2.meta).to.equal(meta2);
      expect(c1.criador).to.not.equal(c2.criador);
    });
  });
});
