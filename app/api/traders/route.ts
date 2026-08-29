import { NextResponse } from "next/server";
import { searchTraders, traders } from "@/lib/directory";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const limit = Math.min(Number(searchParams.get("limit") ?? 8) || 8, 50);
  const results = q ? searchTraders(q, limit) : traders().slice(0, limit);
  return NextResponse.json({
    total: traders().length,
    results: results.map((t) => ({
      rank: t.rank,
      handle: t.handle,
      name: t.name,
      evm: t.evm,
      pnl: t.pnl,
      avatar: t.avatar,
      verified: t.verified,
    })),
  });
}
