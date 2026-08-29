export type Holding = {
  imageUrl?: string | null;
  tokenAddress?: string;
  networkId?: number;
  humanAmount?: number;
  price?: number;
  value?: number;
  pnl?: number;
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
};

export type ChainKey = "ethereum" | "bsc" | "base" | "robinhood";

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

export type LookupResult = {
  trader: Trader | null;
  query: string;
  wallet: string;
  resolvedVia: "directory" | "address" | "fomo-api";
  transfers: Transfer[];
  chains: ChainResult[];
  pulledAt: string;
};
