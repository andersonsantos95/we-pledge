import { Injectable, inject } from '@angular/core';
import { Contract, ZeroAddress, formatEther } from 'ethers';
import { WalletService } from './wallet.service';
import { WEPLEDGE_ABI } from '../../abi/wepledge.abi';
import { environment } from '../../../environments/environment';
import { Campaign, CampaignState, Tranche } from '../models/campaign.model';

@Injectable({ providedIn: 'root' })
export class ContractService {
  private wallet = inject(WalletService);

  private readContract(): Contract {
    return new Contract(environment.contractAddress, WEPLEDGE_ABI, this.wallet.getReadProvider());
  }

  private writeContract(): Contract {
    return new Contract(environment.contractAddress, WEPLEDGE_ABI, this.wallet.getSigner());
  }

  // ── Leituras ──────────────────────────────────────────────────────────────

  async getCampaign(id: bigint): Promise<Campaign> {
    const c = this.readContract();
    const [data, crono] = await Promise.all([
      c['campanhas'](id),
      c['getCronograma'](id),
    ]);

    if (data.criador === ZeroAddress) {
      throw new Error(`Campanha #${id} não encontrada.`);
    }

    const cronograma: Tranche[] = crono.map((t: any) => ({
      percentual:       Number(t.percentual),
      tempoAposVesting: BigInt(t.tempoAposVesting),
      sacada:           Boolean(t.sacada),
    }));

    return {
      id,
      criador:          data.criador as string,
      meta:             BigInt(data.meta),
      prazoCaptacao:    BigInt(data.prazoCaptacao),
      valorArrecadado:  BigInt(data.valorArrecadado),
      valorJaSacado:    BigInt(data.valorJaSacado),
      dataInicioVesting:BigInt(data.dataInicioVesting),
      estado:           Number(data.estado) as CampaignState,
      cronograma,
    };
  }

  async getCampaigns(): Promise<Campaign[]> {
    const c   = this.readContract();
    const next = BigInt(await c['proximoId']());
    if (next <= 1n) return [];

    const ids = Array.from({ length: Number(next) - 1 }, (_, i) => BigInt(i + 1));
    const all = await Promise.all(ids.map((id) => this.getCampaign(id).catch(() => null)));
    return (all.filter(Boolean) as Campaign[]).reverse(); // mais recente primeiro
  }

  async getMyBalance(id: bigint): Promise<bigint> {
    const addr = this.wallet.address();
    if (!addr) return 0n;
    return BigInt(await this.readContract()['saldoContribuido'](id, addr));
  }

  async getJanelas(): Promise<{ finalizacao: bigint; abandono: bigint }> {
    const c = this.readContract();
    const [f, a] = await Promise.all([c['JANELA_FINALIZACAO'](), c['JANELA_ABANDONO']()]);
    return { finalizacao: BigInt(f), abandono: BigInt(a) };
  }

  async getMaxPrazoCaptacao(): Promise<bigint> {
    return BigInt(await this.readContract()['MAX_PRAZO_CAPTACAO']());
  }

  // ── Escritas ──────────────────────────────────────────────────────────────

  async criarCampanha(
    meta: bigint,
    prazoCaptacao: bigint,
    cronograma: { percentual: number; tempoAposVesting: bigint }[]
  ): Promise<bigint> {
    const tx = await this.writeContract()['criarCampanha'](meta, prazoCaptacao, cronograma);
    const receipt = await tx.wait();
    // Extrai id do evento CampanhaCriada
    const iface = this.readContract().interface;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === 'CampanhaCriada') return BigInt(parsed.args[0]);
      } catch { /* skip */ }
    }
    return 0n;
  }

  async contribuir(id: bigint, value: bigint): Promise<void> {
    const tx = await this.writeContract()['contribuir'](id, { value });
    await tx.wait();
  }

  async finalizarCampanha(id: bigint): Promise<void> {
    const tx = await this.writeContract()['finalizarCampanha'](id);
    await tx.wait();
  }

  async sacarTranche(id: bigint): Promise<void> {
    const tx = await this.writeContract()['sacarTranche'](id);
    await tx.wait();
  }

  async marcarFracasso(id: bigint): Promise<void> {
    const tx = await this.writeContract()['marcarFracasso'](id);
    await tx.wait();
  }

  async marcarAbandono(id: bigint): Promise<void> {
    const tx = await this.writeContract()['marcarAbandono'](id);
    await tx.wait();
  }

  async reembolsar(id: bigint): Promise<void> {
    const tx = await this.writeContract()['reembolsar'](id);
    await tx.wait();
  }

  // ── Helpers de UI ─────────────────────────────────────────────────────────

  formatEth(wei: bigint): string {
    return parseFloat(formatEther(wei)).toFixed(4);
  }

  progress(valorArrecadado: bigint, meta: bigint): number {
    if (meta === 0n) return 0;
    const pct = Number((valorArrecadado * 10000n) / meta) / 100;
    return Math.min(pct, 100);
  }

  now(): bigint {
    return BigInt(Math.floor(Date.now() / 1000));
  }
}
