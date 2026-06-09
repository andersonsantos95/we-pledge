export enum CampaignState {
  Captacao   = 0,
  EmVesting  = 1,
  Concluida  = 2,
  Fracassada = 3,
}

export const STATE_LABELS: Record<CampaignState, string> = {
  [CampaignState.Captacao]:   'Captação',
  [CampaignState.EmVesting]:  'Em Vesting',
  [CampaignState.Concluida]:  'Concluída',
  [CampaignState.Fracassada]: 'Fracassada',
};

export const STATE_CSS: Record<CampaignState, string> = {
  [CampaignState.Captacao]:   'badge-captacao',
  [CampaignState.EmVesting]:  'badge-vesting',
  [CampaignState.Concluida]:  'badge-concluida',
  [CampaignState.Fracassada]: 'badge-fracassada',
};

export interface Tranche {
  percentual: number;
  tempoAposVesting: bigint;
  sacada: boolean;
}

export interface Contribution {
  contribuinte: string;
  valor: bigint;
  txHash: string;
  blockNumber: number;
}

export interface GlobalContribution extends Contribution {
  campanhaId: bigint;
}

export interface ActivityEvent {
  tipo: string;
  label: string;
  descricao: string;
  txHash: string;
  blockNumber: number;
}

export interface Campaign {
  id: bigint;
  criador: string;
  meta: bigint;
  prazoCaptacao: bigint;
  valorArrecadado: bigint;
  valorJaSacado: bigint;
  dataInicioVesting: bigint;
  estado: CampaignState;
  cronograma: Tranche[];
}
