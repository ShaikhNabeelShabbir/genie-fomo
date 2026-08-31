import type { ChainKey, ChainResult, Transfer } from "./types";

/**
 * EVM transfers via Bitquery — the only free source that covers BSC and Base.
 *
 * Etherscan's free tier refuses chainid 56 and 8453 ("Free API access is not supported
 * for this chain"); Blockscout has no BSC instance and its Base one returns 500s and
 * timeouts; public BSC RPCs reject historical eth_getLogs without an archive token.
 * Bitquery serves all four EVM chains off one key, which is also what resolved these
 * wallets in the first place (see bitquery.py).
 *
 * The account key is limited to the `realtime` dataset — asking for `archive` or
 * `combined` returns 403 — and points are metered, so a spent quota surfaces as a
 * per-chain error rather than an empty table pretending there is nothing to show.
 */
const URL = "https://streaming.bitquery.io/graphql";
const DATASET = "realtime";

/** fomo networkId -> Bitquery network name, mirroring bitquery.py's NETWORKS. */
const NETWORK: Partial<Record<ChainKey, string>> = {
  robinhood: "robinhood",
  ethereum: "eth",
  bsc: "bsc",
  base: "base",
};

function key(): string {
  return (process.env.BITQUERY_KEY ?? "").trim();
}

export function hasBitqueryKey(): boolean {
  return !!key();
}

type Row = {
  Block?: { Time?: string };
  Transaction?: { Hash?: string };
  Transfer?: {
    Sender?: string;
    Receiver?: string;
    Amount?: string | number;
    Currency?: { Symbol?: string; SmartContract?: string; Decimals?: number };
  };
};

export async function pullBitqueryTransfers(
  chain: ChainKey,
  handle: string,
  address: string,
  limit = 100,
): Promise<{ transfers: Transfer[]; result: ChainResult }> {
  const network = NETWORK[chain];
  const apiKey = key();

  if (!network) {
    return { transfers: [], result: { chain, count: 0, error: `${chain} not on Bitquery` } };
  }
  if (!apiKey) {
    return { transfers: [], result: { chain, count: 0, error: "BITQUERY_KEY is not set" } };
  }

  // Amount comes back already scaled by Currency.Decimals, unlike the raw integers
  // Etherscan and Blockscout return.
  const query = `{
    EVM(network: ${network}, dataset: ${DATASET}) {
      Transfers(
        where: {any: [
          {Transfer: {Sender: {is: "${address}"}}}
          {Transfer: {Receiver: {is: "${address}"}}}
        ]}
        orderBy: {descending: Block_Time}
        limit: {count: ${Math.min(limit, 100)}}
      ) {
        Block { Time }
        Transaction { Hash }
        Transfer {
          Sender
          Receiver
          Amount
          Currency { Symbol SmartContract Decimals }
        }
      }
    }
  }`;

  try {
    const r = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(45_000),
      cache: "no-store",
    });

    const json = await r.json();
    if (json?.errors) {
      const msg = String(json.errors[0]?.message ?? "Bitquery error");
      // Quota is the expected failure here — name it plainly so it is not mistaken
      // for the wallet genuinely having no activity.
      throw new Error(
        /points limit|quota/i.test(msg) ? "Bitquery quota reached" : msg.slice(0, 160),
      );
    }

    const rows: Row[] = json?.data?.EVM?.Transfers ?? [];
    const lower = address.toLowerCase();
    const transfers: Transfer[] = rows.map((row) => {
      const t = row.Transfer ?? {};
      const to = String(t.Receiver ?? "");
      const amount = Number(t.Amount);
      return {
        handle,
        wallet: address,
        chain,
        tx_hash: String(row.Transaction?.Hash ?? ""),
        time: Math.floor(new Date(String(row.Block?.Time ?? "")).getTime() / 1000) || 0,
        token: String(t.Currency?.Symbol ?? ""),
        contract: String(t.Currency?.SmartContract ?? ""),
        amount: Number.isFinite(amount) ? amount : null,
        side: to.toLowerCase() === lower ? "in" : "out",
        from: String(t.Sender ?? ""),
        to,
      };
    });

    return { transfers, result: { chain, count: transfers.length, error: null } };
  } catch (e) {
    return {
      transfers: [],
      result: { chain, count: 0, error: e instanceof Error ? e.message : String(e) },
    };
  }
}
