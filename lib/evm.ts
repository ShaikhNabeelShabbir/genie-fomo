import type { ChainKey, ChainResult, Transfer } from "./types";
import { CHAINS } from "./evm.client";

/**
 * Port of ether_scan1.py's pull_wallet: Etherscan V2 covers Ethereum / BSC / Base off a
 * single free key, Robinhood Chain comes from Blockscout and needs no key at all.
 * Chain metadata (labels, explorer URLs) lives in evm.client.ts so the browser can
 * import it without pulling this module's fetching code into the bundle.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

async function getJson(url: string, tries = 3): Promise<unknown> {
  let lastErr: unknown = null;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(25_000),
        cache: "no-store",
      });
      if (r.status === 429) {
        await new Promise((res) => setTimeout(res, 2 ** i * 500));
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      lastErr = e;
      if (i === tries - 1) break;
      await new Promise((res) => setTimeout(res, 2 ** i * 400));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function scaled(value: unknown, decimals: unknown): number | null {
  try {
    const d = Number(decimals ?? 0);
    const v = BigInt(String(value ?? "0"));
    // BigInt keeps huge meme-coin balances exact until the final divide.
    const base = 10 ** (Number.isFinite(d) ? d : 0);
    return Number(v) / base;
  } catch {
    return null;
  }
}

async function pullEtherscan(
  chain: ChainKey,
  chainId: number,
  handle: string,
  address: string,
  limit: number,
  key: string,
): Promise<Transfer[]> {
  const url =
    `https://api.etherscan.io/v2/api?chainid=${chainId}&module=account&action=tokentx` +
    `&address=${address}&startblock=0&endblock=99999999&page=1&offset=${limit}&sort=desc&apikey=${key}`;
  const data = (await getJson(url)) as { status?: string; message?: string; result?: unknown };

  if (typeof data?.result === "string") {
    // Etherscan reports key/rate problems in `result`; "No transactions found" is not an error.
    if (/no transactions found/i.test(data.result)) return [];
    throw new Error(data.result);
  }
  const rows = Array.isArray(data?.result) ? (data.result as Record<string, string>[]) : [];
  return rows.map((t) => ({
    handle,
    wallet: address,
    chain,
    tx_hash: t.hash,
    time: Number(t.timeStamp) || 0,
    token: t.tokenSymbol || "",
    contract: t.contractAddress || "",
    amount: scaled(t.value, t.tokenDecimal),
    side: (t.to || "").toLowerCase() === address.toLowerCase() ? "in" : "out",
    from: t.from || "",
    to: t.to || "",
  }));
}

async function pullBlockscout(
  chain: ChainKey,
  host: string,
  handle: string,
  address: string,
  limit: number,
): Promise<Transfer[]> {
  const out: Transfer[] = [];
  let params = "";

  // Blockscout pages ~50 at a time and hands back the cursor for the next page.
  for (let page = 0; page < 10 && out.length < limit; page++) {
    const data = (await getJson(
      `${host}/api/v2/addresses/${address}/token-transfers${params}`,
    )) as { items?: Record<string, unknown>[]; next_page_params?: Record<string, unknown> | null };

    const items = Array.isArray(data?.items) ? data.items : [];
    for (const t of items) {
      const token = (t.token ?? {}) as Record<string, unknown>;
      const total = (t.total ?? {}) as Record<string, unknown>;
      const from = String(((t.from ?? {}) as Record<string, unknown>).hash ?? "");
      const to = String(((t.to ?? {}) as Record<string, unknown>).hash ?? "");
      out.push({
        handle,
        wallet: address,
        chain,
        tx_hash: String(t.tx_hash ?? t.transaction_hash ?? ""),
        time: Math.floor(new Date(String(t.timestamp ?? "")).getTime() / 1000) || 0,
        token: String(token.symbol ?? ""),
        // newer Blockscout names the contract `address_hash`; older builds used `address`
        contract: String(token.address_hash ?? token.address ?? ""),
        amount: scaled(total.value, total.decimals ?? token.decimals),
        side: to.toLowerCase() === address.toLowerCase() ? "in" : "out",
        from,
        to,
      });
    }

    const next = data?.next_page_params;
    if (!next || !items.length) break;
    params = `?${new URLSearchParams(
      Object.entries(next).map(([k, v]) => [k, String(v)]),
    ).toString()}`;
  }

  return out.slice(0, limit);
}

export async function pullWallet(
  handle: string,
  address: string,
  limit = 300,
): Promise<{ transfers: Transfer[]; chains: ChainResult[] }> {
  const key = process.env.ETHERSCAN_KEY ?? "";
  // Solana lives in CHAINS for its label/explorer only; it is fetched by lib/solana.ts.
  const entries = (Object.entries(CHAINS) as [ChainKey, (typeof CHAINS)[ChainKey]][])
    .filter(([, cfg]) => cfg.backend !== "helius");

  const settled = await Promise.all(
    entries.map(async ([chain, cfg]): Promise<{ rows: Transfer[]; result: ChainResult }> => {
      try {
        if (cfg.backend === "etherscan_v2") {
          if (!key) throw new Error("ETHERSCAN_KEY is not set");
          const rows = await pullEtherscan(chain, cfg.chainId, handle, address, limit, key);
          return { rows, result: { chain, count: rows.length, error: null } };
        }
        if (cfg.backend !== "blockscout") {
          throw new Error(`${chain} is not fetched here`);
        }
        const rows = await pullBlockscout(chain, cfg.host, handle, address, limit);
        return { rows, result: { chain, count: rows.length, error: null } };
      } catch (e) {
        return {
          rows: [],
          result: { chain, count: 0, error: e instanceof Error ? e.message : String(e) },
        };
      }
    }),
  );

  const transfers = settled.flatMap((s) => s.rows).sort((a, b) => b.time - a.time);
  return { transfers, chains: settled.map((s) => s.result) };
}
