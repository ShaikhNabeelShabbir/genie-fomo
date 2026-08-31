export type Holding = {
  imageUrl?: string | null;
  tokenAddress?: string;
  networkId?: number;
  humanAmount?: number;
  price?: number;
  value?: number;
  pnl?: number;
};

/** Evidence from resolve_wallets.py / resolve_solana.py that an address is really the
 *  trader's. `confirmed` = two independent tokens agreed; `high-candidate` = one tight,
 *  unrivalled match. Anything else is not trustworthy enough to scan. */
export type Resolution = {
  confidence:
    | "confirmed"
    | "high-candidate"
    | "ambiguous"
    | "collision"
    | "unresolved"
    | "no-evm-holdings"
    | "no-sol-holdings"
    | "no-helius-key";
  matches?: {
    chain?: string;
    token: string;
    reported: number;
    onchain: number;
    off_by: number;
    via?: string;
    source?: string;
  }[];
  best_off_by?: number;
  candidates_considered?: number;
  shared_with?: string[];
};

export type Trader = {
  rank: number;
  handle: string;
  name: string;
  evm: string;
  sol: string;
  pnl: number;
  volume: number;
  trades: number;
  followers: number;
  avatar: string;
  bio: string;
  twitter: string;
  verified: boolean;
  holdings: Holding[];

  // Derived by the resolvers. fomo's own `evm`/`sol` are its provisioned wallets and
  // hold almost nothing; these are the addresses the trading actually happens from.
  resolved_evm?: string;
  resolution?: Resolution;
  resolved_sol?: string;
  sol_resolution?: Resolution;
};

export const USABLE_CONFIDENCE = ["confirmed", "high-candidate"] as const;

export function isUsable(r?: Resolution): boolean {
  return !!r && (USABLE_CONFIDENCE as readonly string[]).includes(r.confidence);
}

export type ChainKey = "ethereum" | "bsc" | "base" | "robinhood" | "solana";

export type Transfer = {
  handle: string;
  wallet: string;
  chain: ChainKey;
  tx_hash: string;
  time: number;
  token: string;
  contract: string;
  amount: number | null;
  side: "in" | "out";
  from: string;
  to: string;
};

export type ChainResult = {
  chain: ChainKey;
  count: number;
  error: string | null;
};

/** Which address we actually scanned, and how much we trust it. */
export type ScannedWallet = {
  address: string;
  source: "resolved" | "leaderboard" | "address-input";
  confidence: string;
};

export type LookupResult = {
  trader: Trader | null;
  query: string;
  resolvedVia: "directory" | "address" | "fomo-api";
  evmWallet: ScannedWallet | null;
  solWallet: ScannedWallet | null;
  transfers: Transfer[];
  chains: ChainResult[];
  pulledAt: string;
};
