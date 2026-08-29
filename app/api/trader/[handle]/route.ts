import { NextResponse } from "next/server";
import { findTrader, isAddress } from "@/lib/directory";
import { fetchProfile } from "@/lib/fomo";
import { pullWallet } from "@/lib/evm";
import type { LookupResult } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  const wallet = (trader?.evm || (isAddress(query) ? query.toLowerCase() : "")).toLowerCase();
  if (!wallet) {
    return NextResponse.json(
      {
        error: `No EVM wallet found for "${query}". Try a different name, or paste the 0x… address directly.`,
      },
      { status: 404 },
    );
  }

  const label = trader?.handle ?? `${wallet.slice(0, 8)}…`;
  const { transfers, chains } = await pullWallet(label, wallet, limit);

  const payload: LookupResult = {
    trader,
    query,
    wallet,
    resolvedVia,
    transfers,
    chains,
    pulledAt: new Date().toISOString(),
  };
  return NextResponse.json(payload);
}
