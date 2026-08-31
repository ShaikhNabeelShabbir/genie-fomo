import { NextResponse } from "next/server";
import { findTrader, isAddress } from "@/lib/directory";
import { fetchProfile } from "@/lib/fomo";
import { pullWallet } from "@/lib/evm";
import { pullSolana } from "@/lib/solana";
import { isUsable } from "@/lib/types";
import type { LookupResult, ScannedWallet, Trader } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Which address do we actually scan?
 *
 * fomo's `evm`/`sol` are its provisioned wallets — verified to hold nothing and to be
 * absent from the holder list of every position the trader reports. The resolvers derive
 * the real trading wallet by matching reported position sizes against on-chain holders.
 * Prefer that whenever the evidence is strong enough, and say which one we used either way.
 */
function pickEvm(trader: Trader | null, addressInput: string): ScannedWallet | null {
  if (addressInput) {
    return { address: addressInput, source: "address-input", confidence: "n/a" };
  }
  if (!trader) return null;
  if (trader.resolved_evm && isUsable(trader.resolution)) {
    return {
      address: trader.resolved_evm.toLowerCase(),
      source: "resolved",
      confidence: trader.resolution!.confidence,
    };
  }
  if (!trader.evm) return null;
  return {
    address: trader.evm.toLowerCase(),
    source: "leaderboard",
    confidence: trader.resolution?.confidence ?? "unresolved",
  };
}

function pickSol(trader: Trader | null): ScannedWallet | null {
  if (!trader) return null;
  if (trader.resolved_sol && isUsable(trader.sol_resolution)) {
    return {
      address: trader.resolved_sol,
      source: "resolved",
      confidence: trader.sol_resolution!.confidence,
    };
  }
  if (!trader.sol) return null;
  return {
    address: trader.sol,
    source: "leaderboard",
    confidence: trader.sol_resolution?.confidence ?? "unresolved",
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle: rawHandle } = await params;
  const query = decodeURIComponent(rawHandle).trim();
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 300) || 300, 1000);

  if (!query) {
    return NextResponse.json({ error: "Enter a trader name or wallet address." }, { status: 400 });
  }

  let trader = findTrader(query);
  let resolvedVia: LookupResult["resolvedVia"] = trader ? "directory" : "address";

  if (!trader && !isAddress(query)) {
    trader = await fetchProfile(query.replace(/^@/, ""));
    if (trader) resolvedVia = "fomo-api";
  }

  const addressInput = isAddress(query) && !trader ? query.toLowerCase() : "";
  const evmWallet = pickEvm(trader, addressInput);
  const solWallet = addressInput ? null : pickSol(trader);

  if (!evmWallet && !solWallet) {
    return NextResponse.json(
      {
        error: `No wallet found for "${query}". Try a different name, or paste the 0x… address directly.`,
      },
      { status: 404 },
    );
  }

  const label = trader?.handle ?? `${(evmWallet?.address ?? "").slice(0, 8)}…`;

  // Every chain in parallel; a failure on one is reported on its own chip.
  const [evm, sol] = await Promise.all([
    evmWallet
      ? pullWallet(label, evmWallet.address, limit)
      : Promise.resolve({ transfers: [], chains: [] }),
    solWallet
      ? pullSolana(label, solWallet.address, Math.min(limit, 100))
      : Promise.resolve({ transfers: [], result: null }),
  ]);

  const transfers = [...evm.transfers, ...sol.transfers].sort((a, b) => b.time - a.time);
  const chains = [...evm.chains, ...(sol.result ? [sol.result] : [])];

  const payload: LookupResult = {
    trader,
    query,
    resolvedVia,
    evmWallet,
    solWallet,
    transfers,
    chains,
    pulledAt: new Date().toISOString(),
  };
  return NextResponse.json(payload);
}
