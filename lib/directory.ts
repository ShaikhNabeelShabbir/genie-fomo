import fs from "node:fs";
import path from "node:path";
import type { Trader } from "./types";

/**
 * The directory is a build artifact: `python3 build_directory.py` (or `--offline`)
 * turns the fomo leaderboard into data/wallets.json. Fall back to the raw dump so
 * the app still runs on a fresh clone that only has raw/leaderboard.json.
 */
function load(): Trader[] {
  const root = process.cwd();
  const cached = path.join(root, "data", "wallets.json");
  if (fs.existsSync(cached)) {
    const parsed = JSON.parse(fs.readFileSync(cached, "utf8"));
    if (Array.isArray(parsed?.traders)) return parsed.traders as Trader[];
  }

  const raw = path.join(root, "raw", "leaderboard.json");
  if (!fs.existsSync(raw)) return [];
  const parsed = JSON.parse(fs.readFileSync(raw, "utf8"));
  const rows = parsed?.responseObject?.leaderboard ?? parsed?.leaderboard ?? [];
  if (!Array.isArray(rows)) return [];
  return rows.map((u: Record<string, unknown>, i: number) => ({
    rank: i + 1,
    handle: String(u.userHandle ?? ""),
    name: String(u.displayName ?? u.userHandle ?? ""),
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
    holdings: (u.topHoldings as Trader["holdings"]) ?? [],
  })).filter((t: Trader) => t.handle);
}

let cache: Trader[] | null = null;

export function traders(): Trader[] {
  if (!cache) cache = load();
  return cache;
}

export function isAddress(q: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(q.trim());
}

/** Exact handle/name match first, then a unique prefix, then a unique substring. */
export function findTrader(query: string): Trader | null {
  const q = query.trim().toLowerCase().replace(/^@/, "");
  if (!q) return null;
  const all = traders();

  if (isAddress(q)) return all.find((t) => t.evm.toLowerCase() === q) ?? null;

  const exact = all.find(
    (t) => t.handle.toLowerCase() === q || t.name.toLowerCase() === q,
  );
  if (exact) return exact;

  const starts = all.filter(
    (t) => t.handle.toLowerCase().startsWith(q) || t.name.toLowerCase().startsWith(q),
  );
  if (starts.length) return starts[0];

  const contains = all.filter(
    (t) => t.handle.toLowerCase().includes(q) || t.name.toLowerCase().includes(q),
  );
  return contains[0] ?? null;
}

export function searchTraders(query: string, limit = 8): Trader[] {
  const q = query.trim().toLowerCase().replace(/^@/, "");
  const all = traders();
  if (!q) return all.slice(0, limit);
  const scored = all
    .map((t) => {
      const h = t.handle.toLowerCase();
      const n = t.name.toLowerCase();
      let score = -1;
      if (h === q || n === q) score = 0;
      else if (h.startsWith(q) || n.startsWith(q)) score = 1;
      else if (h.includes(q) || n.includes(q)) score = 2;
      return { t, score };
    })
    .filter((s) => s.score >= 0)
    .sort((a, b) => a.score - b.score || a.t.rank - b.t.rank);
  return scored.slice(0, limit).map((s) => s.t);
}
