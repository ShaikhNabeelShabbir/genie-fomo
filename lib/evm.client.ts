import type { ChainKey } from "./types";

/** Chain metadata shared by the server fetcher and the browser (labels, explorer links). */
type ChainCfg =
  | { backend: "etherscan_v2"; chainId: number; label: string; explorer: string }
  | { backend: "blockscout"; host: string; label: string; explorer: string };

export const CHAINS: Record<ChainKey, ChainCfg> = {
  ethereum: { backend: "etherscan_v2", chainId: 1, label: "Ethereum", explorer: "https://etherscan.io" },
  bsc: { backend: "etherscan_v2", chainId: 56, label: "BSC", explorer: "https://bscscan.com" },
  base: { backend: "etherscan_v2", chainId: 8453, label: "Base", explorer: "https://basescan.org" },
  robinhood: {
    backend: "blockscout",
    host: "https://robinhoodchain.blockscout.com",
    label: "Robinhood",
    explorer: "https://robinhoodchain.blockscout.com",
  },
};

export function txUrl(chain: ChainKey, hash: string): string {
  return `${CHAINS[chain].explorer}/tx/${hash}`;
}

export function addressUrl(chain: ChainKey, address: string): string {
  return `${CHAINS[chain].explorer}/address/${address}`;
}
