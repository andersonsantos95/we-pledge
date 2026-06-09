import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ContractService } from '../../core/services/contract.service';
import { WalletService } from '../../core/services/wallet.service';
import { GlobalContribution } from '../../core/models/campaign.model';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-history',
  imports: [RouterLink],
  templateUrl: './history.html',
  styleUrl: './history.css',
})
export class HistoryComponent implements OnInit {
  private contract = inject(ContractService);
  readonly wallet  = inject(WalletService);

  contributions = signal<GlobalContribution[]>([]);
  loading       = signal(true);
  error         = signal<string | null>(null);

  readonly explorerBase = environment.chainId === 11155111
    ? 'https://sepolia.etherscan.io' : null;

  async ngOnInit(): Promise<void> {
    try {
      this.contributions.set(await this.contract.getAllContributions());
    } catch (e: any) {
      this.error.set(e.message ?? 'Erro ao carregar histórico.');
    } finally {
      this.loading.set(false);
    }
  }

  formatEth(wei: bigint): string { return this.contract.formatEth(wei); }

  shortAddr(addr: string): string {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  }

  txUrl(txHash: string): string | null {
    return this.explorerBase ? `${this.explorerBase}/tx/${txHash}` : null;
  }

  totalContribuido(): bigint {
    return this.contributions().reduce((s, c) => s + c.valor, 0n);
  }
}
