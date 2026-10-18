"use client";

/**
 * Polygon Mainnet ($UDAO) Session Arcade Vault Connector
 * - Chain ID: 137 (0x89 Polygon Mainnet)
 * - $UDAO Token Contract: 0x6430f1249a3c4f3d5898b07f471103f14a605096
 * - Supports EVM browser wallets (MetaMask / Rabby / Coinbase) + instant Guest Operative wallet for zero-friction play.
 */

export const POLYGON_CHAIN_ID_HEX = "0x89";
export const UDAO_CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_UDAO_TOKEN_ADDRESS ||
  "0x6430f1249a3c4f3d5898b07f471103f14a605096";
export const TREASURY_VAULT_ADDRESS =
  process.env.NEXT_PUBLIC_TREASURY_VAULT_ADDRESS ||
  "0x71C95911E9a5D330f4D621842EC243EE1343292e";

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export function getOrGenerateGuestWallet(): string {
  if (typeof window === "undefined") return "0x0000000000000000000000000000000000000001";
  const key = "chrono_heist_operative_wallet";
  let saved = localStorage.getItem(key);
  if (!saved) {
    const hexChars = "0123456789abcdef";
    let addr = "0x";
    for (let i = 0; i < 40; i++) {
      addr += hexChars[Math.floor(Math.random() * 16)];
    }
    saved = addr;
    localStorage.setItem(key, saved);
  }
  return saved;
}

export async function connectPolygonWallet(): Promise<{
  walletAddress: string;
  isLiveEvm: boolean;
}> {
  if (typeof window !== "undefined" && window.ethereum) {
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];

      if (accounts && accounts.length > 0) {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: POLYGON_CHAIN_ID_HEX }],
          });
        } catch {
          // Allow user to remain on current chain if switch is declined
        }
        localStorage.setItem("chrono_heist_operative_wallet", accounts[0].toLowerCase());
        return { walletAddress: accounts[0].toLowerCase(), isLiveEvm: true };
      }
    } catch {
      // Fallback to local operative wallet if user cancels wallet popup
    }
  }
  return { walletAddress: getOrGenerateGuestWallet(), isLiveEvm: false };
}

export function formatShortWallet(wallet: string): string {
  if (!wallet || wallet.length < 10) return wallet;
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`.toUpperCase();
}
