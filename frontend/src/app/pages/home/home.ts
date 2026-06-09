import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { ContractService } from '../../core/services/contract.service';
import { Campaign, CampaignState, STATE_LABELS, STATE_CSS } from '../../core/models/campaign.model';

@Component({
  selector: 'app-home',
  imports: [RouterLink, DecimalPipe],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class HomeComponent implements OnInit {
  private contract = inject(ContractService);

  campaigns = signal<Campaign[]>([]);
  loading   = signal(true);
  error     = signal<string | null>(null);

  readonly STATE_LABELS = STATE_LABELS;
  readonly STATE_CSS    = STATE_CSS;
  readonly CampaignState = CampaignState;

  async ngOnInit(): Promise<void> {
    try {
      this.campaigns.set(await this.contract.getCampaigns());
    } catch (e: any) {
      this.error.set(e.message ?? 'Erro ao carregar campanhas.');
    } finally {
      this.loading.set(false);
    }
  }

  progress(c: Campaign): number {
    return this.contract.progress(c.valorArrecadado, c.meta);
  }

  formatEth(wei: bigint): string {
    return this.contract.formatEth(wei);
  }

  formatDeadline(ts: bigint): string {
    const d = new Date(Number(ts) * 1000);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  isExpired(ts: bigint): boolean {
    return this.contract.now() > ts;
  }

  tranchesSacadas(c: Campaign): number {
    return c.cronograma.filter(t => t.sacada).length;
  }
}
