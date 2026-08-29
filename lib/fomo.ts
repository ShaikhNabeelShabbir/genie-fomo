import type { Trader } from "./types";

/**
 * Optional live fallback for handles that aren't in data/wallets.json yet. Mirrors
 * ether_scan1.py: Bearer first (the cookie form triggers a 431), cookie as backup.
 * Silently no-ops without FOMO_TOKEN — the cached directory is the primary path.
 */
export async function fetchProfile(handle: string): Promise<Trader | null> {
  const token = (process.env.FOMO_TOKEN ?? "").replace(/\s/g, "");
  if (!token) return null;

  const url = `https://prod-api.fomo.family/v2/users/userHandle/${encodeURIComponent(handle)}`;
  const base = { "User-Agent": "Mozilla/5.0", Accept: "application/json" };
  const attempts = [
    { ...base, Authorization: `Bearer ${token}` },
    { ...base, Cookie: `privy-token=${token}` },
  ];

  for (const headers of attempts) {
    try {
      const r = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (!r.ok) continue;
      const json = await r.json();
      const u = json?.responseObject?.user ?? json?.responseObject ?? json?.data ?? json;
      if (!u?.userHandle && !u?.evmAddress) continue;
      return {
        rank: 0,
        handle: String(u.userHandle ?? handle),
        name: String(u.displayName ?? u.userHandle ?? handle),
        evm: String(u.evmAddress ?? "").toLowerCase(),
        sol: String(u.address ?? "").startsWith("0x") ? "" : String(u.address ?? ""),
        pnl: Number(u.pnl30d ?? 0),
        volume: Number(u.totalVolume ?? 0),
        trades: Number(u.numTrades ?? 0),
        followers: Number(u.followers ?? 0),
        avatar: String(u.profilePictureLink ?? ""),
        bio: String(u.description ?? "").trim(),
        twitter: String(u.twitter ?? ""),
        verified: Boolean(u.verified),
        holdings: u.topHoldings ?? [],
      };
    } catch {
      // try the next auth mode
    }
  }
  return null;
}
