import type { ChainResult, Transfer } from "./types";

/**
 * Solana trade history via Helius' Enhanced Transactions API — the same source
 * resolve_solana.py uses for resolution, here for the decoded swaps themselves.
 *
 * The endpoint is a legacy product in maintenance mode; its successors
 * (getTransactionsForAddress, Parsed Events) are paid-plan only, so this is the way
 * to get decoded swaps on the free tier. 100 credits per call, 100 tx per page.
 */
const ENHANCED = "https://api.helius.xyz/v0";

function key(): string {
  return (process.env.HELIUS_SOLANA_KEY ?? process.env.HELIUS_KEY ?? "").trim();
}

export function hasSolanaKey(): boolean {
  return !!key();
}

export function solanaTxUrl(sig: string): string {
  return `https://solscan.io/tx/${sig}`;
}

type HeliusTokenTransfer = {
  fromUserAccount?: string;
  toUserAccount?: string;
  mint?: string;
  tokenAmount?: number | string;
};

type HeliusTx = {
  signature?: string;
  timestamp?: number;
  type?: string;
  source?: string;
  description?: string;
  tokenTransfers?: HeliusTokenTransfer[];
};

/**
 * Flattens Helius transactions into the same Transfer shape the EVM chains produce, so
 * one table can render every chain. Each token movement touching the wallet becomes a row.
 */
export async function pullSolana(
  handle: string,
  address: string,
  limit = 100,
): Promise<{ transfers: Transfer[]; result: ChainResult }> {
  if (!address) {
    return { transfers: [], result: { chain: "solana", count: 0, error: null } };
  }
  const apiKey = key();
  if (!apiKey) {
    return {
      transfers: [],
      result: { chain: "solana", count: 0, error: "HELIUS_SOLANA_KEY is not set" },
    };
  }

  const url =
    `${ENHANCED}/addresses/${address}/transactions` +
    `?api-key=${apiKey}&limit=${Math.min(limit, 100)}`;

  try {
    const r = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(
        r.status === 401 || r.status === 403
          ? "Helius rejected the key"
          : `HTTP ${r.status}${body ? ` — ${body.slice(0, 120)}` : ""}`,
      );
    }
    const data = await r.json();
    const txs: HeliusTx[] = Array.isArray(data) ? data : (data?.transactions ?? []);

    const transfers: Transfer[] = [];
    for (const tx of txs) {
      const moves = tx.tokenTransfers ?? [];
      for (const m of moves) {
        const to = m.toUserAccount ?? "";
        const from = m.fromUserAccount ?? "";
        // only the legs that actually touch this wallet
        if (to !== address && from !== address) continue;
        const amt = Number(m.tokenAmount);
        transfers.push({
          handle,
          wallet: address,
          chain: "solana",
          tx_hash: tx.signature ?? "",
          time: Number(tx.timestamp) || 0,
          // Enhanced doesn't return symbols; the mint is the stable identifier and the
          // UI shortens it. DAS getAsset could enrich this later at 10 credits a call.
          token: m.mint ? `${m.mint.slice(0, 4)}…${m.mint.slice(-4)}` : "",
          contract: m.mint ?? "",
          amount: Number.isFinite(amt) ? amt : null,
          side: to === address ? "in" : "out",
          from,
          to,
        });
      }
    }

    return {
      transfers,
      result: { chain: "solana", count: transfers.length, error: null },
    };
  } catch (e) {
    return {
      transfers: [],
      result: {
        chain: "solana",
        count: 0,
        error: e instanceof Error ? e.message : String(e),
      },
    };
  }
}
