import { Injectable, signal } from '@angular/core';
import { BrowserProvider, JsonRpcProvider, JsonRpcSigner } from 'ethers';
import { environment } from '../../../environments/environment';

declare global {
  interface Window { ethereum?: any; }
}

@Injectable({ providedIn: 'root' })
export class WalletService {
  readonly address  = signal<string | null>(null);
  readonly isConnected = signal(false);
  readonly chainId  = signal<bigint | null>(null);

  private provider: BrowserProvider | null = null;
  private signer:   JsonRpcSigner | null   = null;

  // Provedor de leitura disponível mesmo sem carteira conectada
  private readonly readOnlyProvider = new JsonRpcProvider(environment.publicRpcUrl);

  async connect(): Promise<void> {
    if (!window.ethereum) {
      throw new Error('MetaMask não encontrado. Instale a extensão em metamask.io.');
    }

    this.provider = new BrowserProvider(window.ethereum);
    await this.provider.send('eth_requestAccounts', []);
    this.signer = await this.provider.getSigner();

    const addr    = await this.signer.getAddress();
    const network = await this.provider.getNetwork();

    this.address.set(addr);
    this.chainId.set(network.chainId);
    this.isConnected.set(true);

    window.ethereum.on('accountsChanged', (accounts: string[]) => {
      if (accounts.length === 0) {
        this.disconnect();
      } else {
        this.address.set(accounts[0]);
        // Renova o signer após troca de conta
        this.provider!.getSigner().then((s) => (this.signer = s));
      }
    });

    window.ethereum.on('chainChanged', () => window.location.reload());
  }

  disconnect(): void {
    this.provider = null;
    this.signer   = null;
    this.address.set(null);
    this.chainId.set(null);
    this.isConnected.set(false);
  }

  /** Para leituras: usa MetaMask se conectado, RPC público caso contrário. */
  getReadProvider(): BrowserProvider | JsonRpcProvider {
    return this.provider ?? this.readOnlyProvider;
  }

  /** Para escritas: requer carteira conectada. */
  getSigner(): JsonRpcSigner {
    if (!this.signer) throw new Error('Conecte a carteira antes de continuar.');
    return this.signer;
  }

  shortAddress(addr: string): string {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  }
}
