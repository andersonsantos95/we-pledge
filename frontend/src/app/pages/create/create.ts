import { Component, inject, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormArray, ReactiveFormsModule, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { parseEther } from 'ethers';
import { ContractService } from '../../core/services/contract.service';
import { WalletService } from '../../core/services/wallet.service';

function metaPositiva(ctrl: AbstractControl): ValidationErrors | null {
  const v = parseFloat(ctrl.value);
  return isNaN(v) || v <= 0 ? { positivo: true } : null;
}

@Component({
  selector: 'app-create',
  imports: [ReactiveFormsModule],
  templateUrl: './create.html',
  styleUrl: './create.css',
})
export class CreateComponent implements OnInit {
  private fb       = inject(FormBuilder);
  private contract = inject(ContractService);
  private wallet   = inject(WalletService);
  private router   = inject(Router);

  loading = signal(false);
  error   = signal<string | null>(null);
  success = signal<bigint | null>(null);

  readonly MAX_TRANCHES = 5;
  maxPrazoCaptacao = signal<bigint>(BigInt(365 * 24 * 3600));

  form = this.fb.group({
    nome:      ['', [Validators.required, Validators.maxLength(100)]],
    descricao: ['', Validators.maxLength(1000)],
    meta:      ['', [Validators.required, metaPositiva]],
    prazo:     ['', Validators.required],
    tranches:  this.fb.array([this.newTranche(60, 0), this.newTranche(40, 30)]),
  });

  async ngOnInit(): Promise<void> {
    try {
      this.maxPrazoCaptacao.set(await this.contract.getMaxPrazoCaptacao());
    } catch { /* usa fallback de 365 dias */ }
  }

  get minPrazo(): string {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 5);
    return d.toISOString().slice(0, 16);
  }

  get maxPrazoStr(): string {
    const d = new Date(Date.now() + Number(this.maxPrazoCaptacao()) * 1000);
    return d.toISOString().slice(0, 16);
  }

  prazoExcedeMaximo(): boolean {
    const v = this.form.get('prazo')?.value;
    if (!v) return false;
    const ts  = Math.floor(new Date(v).getTime() / 1000);
    const now = Math.floor(Date.now() / 1000);
    return (ts - now) > Number(this.maxPrazoCaptacao());
  }

  private newTranche(pct = 100, dias = 0) {
    return this.fb.group({
      percentual: [pct, [Validators.required, Validators.min(1), Validators.max(100)]],
      dias:       [dias, [Validators.required, Validators.min(0)]],
    });
  }

  get tranches(): FormArray { return this.form.get('tranches') as FormArray; }

  get totalPercentual(): number {
    return this.tranches.controls.reduce(
      (s, ctrl) => s + (Number(ctrl.get('percentual')?.value) || 0), 0
    );
  }

  get percentualOk(): boolean { return this.totalPercentual === 100; }

  addTranche(): void {
    if (this.tranches.length >= this.MAX_TRANCHES) return;
    const lastDias = this.tranches.length > 0
      ? Number(this.tranches.at(this.tranches.length - 1).get('dias')?.value) + 30
      : 0;
    this.tranches.push(this.newTranche(0, lastDias));
  }

  removeTranche(i: number): void {
    if (this.tranches.length <= 1) return;
    this.tranches.removeAt(i);
  }

  trancheAt(i: number): AbstractControl { return this.tranches.at(i); }

  isStrictlyIncreasing(): boolean {
    const dias = this.tranches.controls.map((c) => Number(c.get('dias')?.value));
    for (let i = 1; i < dias.length; i++) {
      if (dias[i] <= dias[i - 1]) return false;
    }
    return true;
  }

  async onSubmit(): Promise<void> {
    if (this.form.invalid || !this.percentualOk || !this.isStrictlyIncreasing() || this.prazoExcedeMaximo()) return;
    if (!this.wallet.isConnected()) {
      this.error.set('Conecte a carteira antes de criar uma campanha.');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      const v = this.form.value;
      const nome      = (v.nome ?? '').trim();
      const descricao = (v.descricao ?? '').trim();
      const meta      = parseEther(Number(v.meta).toFixed(18).replace(/\.?0+$/, '') || '0');
      const prazo     = BigInt(Math.floor(new Date(v.prazo!).getTime() / 1000));
      const cronograma = this.tranches.controls.map((c) => ({
        percentual:       Number(c.get('percentual')!.value),
        tempoAposVesting: BigInt(Number(c.get('dias')!.value) * 86400),
      }));

      const id = await this.contract.criarCampanha(nome, descricao, meta, prazo, cronograma);
      this.success.set(id);
      setTimeout(() => this.router.navigate(['/campanha', id.toString()]), 1500);
    } catch (e: any) {
      this.error.set(e.reason ?? e.message ?? 'Erro ao criar campanha.');
    } finally {
      this.loading.set(false);
    }
  }
}
