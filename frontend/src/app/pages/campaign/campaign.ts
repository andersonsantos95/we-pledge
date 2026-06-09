import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { parseEther } from 'ethers';
import { ContractService } from '../../core/services/contract.service';
import { WalletService } from '../../core/services/wallet.service';
import { Campaign, CampaignState, STATE_LABELS, STATE_CSS, Tranche } from '../../core/models/campaign.model';

@Component({
  selector: 'app-campaign',
  imports: [RouterLink, FormsModule, DecimalPipe],
  templateUrl: './campaign.html',
  styleUrl: './campaign.css',
})
export class CampaignComponent implements OnInit {
  private route    = inject(ActivatedRoute);
  private contract = inject(ContractService);
  readonly wallet  = inject(WalletService);

  campaign   = signal<Campaign | null>(null);
  myBalance  = signal<bigint>(0n);
  janelaFinalizacao = signal<bigint>(0n);
  janelaAbandono    = signal<bigint>(0n);

  loading   = signal(true);
  txLoading = signal(false);
  error     = signal<string | null>(null);
  txError   = signal<string | null>(null);
  txSuccess = signal<string | null>(null);

  contributeAmount = '';

  readonly STATE_LABELS = STATE_LABELS;
  readonly STATE_CSS    = STATE_CSS;
  readonly CampaignState = CampaignState;

  async ngOnInit(): Promise<void> {
    const id = BigInt(this.route.snapshot.paramMap.get('id')!);
    try {
      const [camp, janelas] = await Promise.all([
        this.contract.getCampaign(id),
        this.contract.getJanelas(),
      ]);
      this.campaign.set(camp);
      this.janelaFinalizacao.set(janelas.finalizacao);
      this.janelaAbandono.set(janelas.abandono);
      if (this.wallet.isConnected()) {
        this.myBalance.set(await this.contract.getMyBalance(id));
      }
    } catch (e: any) {
      this.error.set(e.message ?? 'Campanha não encontrada.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Predicados de ação ─────────────────────────────────────────────────────

  get c(): Campaign | null { return this.campaign(); }

  get isCreator(): boolean {
    const addr = this.wallet.address();
    return !!addr && !!this.c && addr.toLowerCase() === this.c.criador.toLowerCase();
  }

  get deadlineExpired(): boolean {
    return !!this.c && this.contract.now() > this.c.prazoCaptacao;
  }

  get canContribute(): boolean {
    return !!this.c && this.c.estado === CampaignState.Captacao && !this.deadlineExpired;
  }

  get canFinalize(): boolean {
    return !!this.c && this.isCreator &&
      this.c.estado === CampaignState.Captacao &&
      this.c.valorArrecadado >= this.c.meta;
  }

  get canClaimTranche(): boolean {
    if (!this.c || !this.isCreator || this.c.estado !== CampaignState.EmVesting) return false;
    const now  = this.contract.now();
    const next = this.c.cronograma.find((t) => !t.sacada);
    if (!next) return false;
    return now >= this.c.dataInicioVesting + next.tempoAposVesting;
  }

  get nextTranche(): Tranche | undefined {
    return this.c?.cronograma.find((t) => !t.sacada);
  }

  get canMarkFailure(): boolean {
    return !!this.c && this.c.estado === CampaignState.Captacao &&
      this.deadlineExpired && this.c.valorArrecadado < this.c.meta;
  }

  get canMarkAbandonment(): boolean {
    if (!this.c || this.c.estado !== CampaignState.Captacao) return false;
    if (this.c.valorArrecadado < this.c.meta) return false;
    return this.contract.now() > this.c.prazoCaptacao + this.janelaFinalizacao() + this.janelaAbandono();
  }

  get canRefund(): boolean {
    return !!this.c && this.c.estado === CampaignState.Fracassada && this.myBalance() > 0n;
  }

  // ── Ações ─────────────────────────────────────────────────────────────────

  private async runTx(label: string, fn: () => Promise<void>): Promise<void> {
    if (!this.wallet.isConnected()) {
      this.txError.set('Conecte a carteira primeiro.'); return;
    }
    this.txLoading.set(true);
    this.txError.set(null);
    this.txSuccess.set(null);
    try {
      await fn();
      this.txSuccess.set(`✓ ${label} realizado com sucesso!`);
      // Recarrega dados
      const id = this.c!.id;
      this.campaign.set(await this.contract.getCampaign(id));
      this.myBalance.set(await this.contract.getMyBalance(id));
    } catch (e: any) {
      this.txError.set(e.reason ?? e.message ?? `Erro em ${label}.`);
    } finally {
      this.txLoading.set(false);
    }
  }

  contribute(): void {
    const id  = this.c!.id;
    const val = parseEther(String(this.contributeAmount || '0'));
    if (val <= 0n) { this.txError.set('Informe um valor válido.'); return; }
    this.runTx('Contribuição', () => this.contract.contribuir(id, val));
  }

  finalize(): void {
    this.runTx('Finalização', () => this.contract.finalizarCampanha(this.c!.id));
  }

  claimTranche(): void {
    this.runTx('Saque de tranche', () => this.contract.sacarTranche(this.c!.id));
  }

  markFailure(): void {
    this.runTx('Marcar fracasso', () => this.contract.marcarFracasso(this.c!.id));
  }

  markAbandonment(): void {
    this.runTx('Marcar abandono', () => this.contract.marcarAbandono(this.c!.id));
  }

  refund(): void {
    this.runTx('Reembolso', () => this.contract.reembolsar(this.c!.id));
  }

  // ── Formatação ─────────────────────────────────────────────────────────────

  formatEth(wei: bigint): string { return this.contract.formatEth(wei); }
  trancheEth(base: bigint, pct: number): string { return this.formatEth(base * BigInt(pct) / 100n); }
  progress(): number { return this.c ? this.contract.progress(this.c.valorArrecadado, this.c.meta) : 0; }

  formatTs(ts: bigint): string {
    return new Date(Number(ts) * 1000).toLocaleString('pt-BR');
  }

  trancheAvailableAt(t: Tranche): string {
    if (!this.c || this.c.dataInicioVesting === 0n) return '—';
    return this.formatTs(this.c.dataInicioVesting + t.tempoAposVesting);
  }

  isTrancheLocked(t: Tranche): boolean {
    if (!this.c || t.sacada) return false;
    return this.contract.now() < this.c.dataInicioVesting + t.tempoAposVesting;
  }
}
