import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { WalletService } from '../../core/services/wallet.service';

@Component({
  selector: 'app-header',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './header.html',
  styleUrl: './header.css',
})
export class HeaderComponent {
  wallet  = inject(WalletService);
  loading = signal(false);
  error   = signal<string | null>(null);

  async onConnect(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.wallet.connect();
    } catch (e: any) {
      this.error.set(e.message ?? 'Erro ao conectar carteira');
    } finally {
      this.loading.set(false);
    }
  }

  onDisconnect(): void {
    this.wallet.disconnect();
  }
}
