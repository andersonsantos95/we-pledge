// ABI em formato human-readable do ethers.js v6
export const WEPLEDGE_ABI = [
  // ── Getters públicos ────────────────────────────────────────────────────────
  'function campanhas(uint256) view returns (address criador, string nome, string descricao, uint256 meta, uint256 prazoCaptacao, uint256 valorArrecadado, uint256 valorJaSacado, uint256 dataInicioVesting, uint8 estado)',
  'function saldoContribuido(uint256, address) view returns (uint256)',
  'function proximoId() view returns (uint256)',
  'function JANELA_FINALIZACAO() view returns (uint256)',
  'function JANELA_ABANDONO() view returns (uint256)',

  // ── Views auxiliares ────────────────────────────────────────────────────────
  'function getCronograma(uint256) view returns (tuple(uint8 percentual, uint256 tempoAposVesting, bool sacada)[])',
  'function getTotalTranches(uint256) view returns (uint256)',

  // ── Escrita ─────────────────────────────────────────────────────────────────
  'function criarCampanha(string nome_, string descricao_, uint256 meta_, uint256 prazoCaptacao_, tuple(uint8 percentual, uint256 tempoAposVesting)[] cronograma_) returns (uint256)',
  'function contribuir(uint256 idCampanha) payable',
  'function finalizarCampanha(uint256 idCampanha)',
  'function sacarTranche(uint256 idCampanha)',
  'function marcarFracasso(uint256 idCampanha)',
  'function marcarAbandono(uint256 idCampanha)',
  'function reembolsar(uint256 idCampanha)',

  // ── Eventos ─────────────────────────────────────────────────────────────────
  'event CampanhaCriada(uint256 indexed id, address indexed criador, string nome, string descricao, uint256 meta, uint256 prazoCaptacao, tuple(uint8 percentual, uint256 tempoAposVesting, bool sacada)[] cronograma)',
  'event Contribuicao(uint256 indexed id, address indexed contribuinte, uint256 valor)',
  'event MetaAtingida(uint256 indexed id, uint256 valorTotal, uint256 timestamp)',
  'event CampanhaFinalizada(uint256 indexed id, uint256 valorArrecadado, uint256 dataInicioVesting)',
  'event TrancheLiberada(uint256 indexed id, uint8 numeroDaTranche, uint256 valor)',
  'event CampanhaConcluida(uint256 indexed id)',
  'event CampanhaFracassada(uint256 indexed id, uint256 valorArrecadado)',
  'event CampanhaAbandonada(uint256 indexed id)',
  'event Reembolso(uint256 indexed id, address indexed contribuinte, uint256 valor)',
] as const;
