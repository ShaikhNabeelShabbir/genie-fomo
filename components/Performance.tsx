"use client";

import { useEffect, useState } from "react";
import { usd } from "@/lib/format";

/**
 * Plain-English profit & loss, from the genie-fomo API's /performance and /trades routes.
 *
 * Deliberately not a data dump. The API returns ~30 fields; a reader who does not trade
 * needs about six of them, plus the two warnings that stop a headline number from being
 * misleading:
 *
 *   - most of a "profit" is usually an UNSOLD mark that can still evaporate
 *   - a positive average with a negative median means one lucky trade carried everything
 *
 * A trade the API could not settle comes back as `pnl_status: "unavailable"`. Those are
 * shown as "unknown", never as zero — booking them at zero is how a losing wallet starts
 * looking profitable.
 */

const API = process.env.NEXT_PUBLIC_GENIE_API ?? "http://localhost:8787";

type Summary = {
  realized_pnl_usd: number | null;
  unrealized_pnl_usd: number | null;
  total_pnl_usd: number | null;
  realized_share: number | null;
  closed_trades: number;
  win_rate: number | null;
  mean_trade_usd: number | null;
  median_trade_usd: number | null;
  best_trade_usd: number | null;
  worst_trade_usd: number | null;
  top_position_share: number | null;
  open_positions: number;
  coverage?: { history_from?: string | null; history_to?: string | null };
  scanned_wallets?: Record<string, { address: string | null; skipped?: boolean }>;
};

type Trade = {
  tx_hash: string;
  time_iso: string | null;
  kind: string;
  base: { symbol: string } | null;
  value_usd: number | null;
  realized_pnl_usd: number | null;
  roi_pct: number | null;
  pnl_status: string;
  explorer_url: string | null;
};

function Stat({ label, value, tone, hint }: {
  label: string; value: string; tone?: "up" | "down"; hint?: string;
}) {
  return (
    <div className="rounded-xl border border-edge bg-black/20 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-mute">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${
        tone === "up" ? "text-up" : tone === "down" ? "text-down" : ""
      }`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] leading-snug text-mute">{hint}</div>}
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-xl border border-down/40 bg-down/5 px-4 py-3 text-xs text-down">
      <span aria-hidden>⚠</span>
      <span className="leading-relaxed">{children}</span>
    </div>
  );
}

export default function Performance({ handle }: { handle: string }) {
  const [sum, setSum] = useState<Summary | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    setSum(null);
    setTrades([]);

    const q = "limit=1000&pages=6";
    Promise.all([
      fetch(`${API}/v1/traders/${encodeURIComponent(handle)}/performance?${q}`).then((r) => r.json()),
      fetch(`${API}/v1/traders/${encodeURIComponent(handle)}/trades?${q}&kind=buy,sell`).then((r) => r.json()),
    ])
      .then(([p, t]) => {
        if (cancelled) return;
        if (p?.detail) throw new Error(p.detail);
        setSum(p);
        setTrades(t?.trades ?? []);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setBusy(false));

    return () => { cancelled = true; };
  }, [handle]);

  if (busy) {
    return (
      <div className="rounded-2xl border border-edge bg-panel p-5">
        <div className="text-sm text-mute">Working out profit and loss…</div>
        <div className="mt-1 text-xs text-mute/70">
          Reads every trade this wallet ever made, so this takes a few seconds.
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-edge bg-panel p-5 text-sm text-mute">
        Profit and loss unavailable — {error}
        <div className="mt-1 text-xs text-mute/70">API expected at {API}</div>
      </div>
    );
  }

  if (!sum) return null;

  // `unrealized` is null when no held position could be priced — that is UNKNOWN, not
  // zero, and `total` is null with it. Showing "$0.00 still held" would quietly claim we
  // checked and found nothing. Fall back to the cashed-in figure and say so.
  const banked = sum.realized_pnl_usd ?? 0;
  const onPaperKnown = sum.unrealized_pnl_usd !== null;
  const onPaper = sum.unrealized_pnl_usd ?? 0;
  const headline = sum.total_pnl_usd ?? banked;
  const partial = sum.total_pnl_usd === null;
  const up = headline >= 0;

  // The two things that make a headline number misleading.
  const mostlyUnsold =
    onPaperKnown && sum.realized_share !== null && sum.realized_share < 0.5;
  const carriedByFewWins =
    sum.median_trade_usd !== null && sum.mean_trade_usd !== null &&
    sum.median_trade_usd < 0 && sum.mean_trade_usd > 0;
  const concentrated = sum.top_position_share !== null && sum.top_position_share > 0.8;

  const settled = trades.filter((t) => t.pnl_status === "computed");
  const unknown = trades.filter((t) => t.pnl_status !== "computed" && t.kind === "sell").length;

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-edge bg-panel">
        <div className="border-b border-edge p-5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-mute">
            Profit &amp; loss
          </div>
          <div className={`mt-1 text-3xl font-semibold tabular-nums ${up ? "text-up" : "text-down"}`}>
            {up ? "+" : "−"}{usd(Math.abs(headline))}
          </div>
          <div className="mt-1 text-sm text-mute">
            {partial ? (
              <>Money actually taken out. Coins still held couldn&apos;t be valued, so
              they are not counted here.</>
            ) : (
              <>{usd(banked)} cashed in · {usd(onPaper)} still held</>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
          <Stat
            label="Trades won"
            value={sum.win_rate === null ? "—" : `${Math.round(sum.win_rate * 100)}%`}
            hint={`${Math.round((sum.win_rate ?? 0) * sum.closed_trades)} of ${sum.closed_trades} closed`}
          />
          <Stat
            label="Typical trade"
            value={sum.median_trade_usd === null ? "—" : usd(sum.median_trade_usd)}
            tone={(sum.median_trade_usd ?? 0) >= 0 ? "up" : "down"}
            hint="the middle result"
          />
          <Stat
            label="Best trade"
            value={sum.best_trade_usd === null ? "—" : usd(sum.best_trade_usd)}
            tone="up"
          />
          <Stat
            label="Worst trade"
            value={sum.worst_trade_usd === null ? "—" : usd(sum.worst_trade_usd)}
            tone="down"
          />
        </div>

        {(mostlyUnsold || carriedByFewWins || concentrated) && (
          <div className="space-y-2 border-t border-edge p-5">
            {mostlyUnsold && (
              <Warning>
                Only <strong>{Math.round((sum.realized_share ?? 0) * 100)}%</strong> of this
                profit has actually been sold. The rest is the current value of coins still
                held — it can still go down.
              </Warning>
            )}
            {carriedByFewWins && (
              <Warning>
                Most trades <strong>lost</strong> money. The total is positive because one or
                two big wins made up for them.
              </Warning>
            )}
            {concentrated && (
              <Warning>
                Nearly all the unsold profit sits in a <strong>single coin</strong>. If it
                falls, most of this disappears.
              </Warning>
            )}
          </div>
        )}
      </div>

      {settled.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-edge bg-panel">
          <div className="flex flex-wrap items-center gap-2 border-b border-edge p-4">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-mute">
              Biggest wins &amp; losses
            </span>
            {unknown > 0 && (
              <span className="text-[11px] text-mute">
                · {unknown} sale{unknown > 1 ? "s" : ""} couldn&apos;t be worked out (bought
                before our records start)
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-[10px] uppercase tracking-wider text-mute">
                  <th className="px-4 py-2.5 font-semibold">When</th>
                  <th className="px-4 py-2.5 font-semibold">Coin</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Sold for</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Profit / loss</th>
                </tr>
              </thead>
              <tbody>
                {[...settled]
                  .sort((a, b) =>
                    Math.abs(b.realized_pnl_usd ?? 0) - Math.abs(a.realized_pnl_usd ?? 0))
                  .slice(0, 8)
                  .map((t) => {
                    const p = t.realized_pnl_usd ?? 0;
                    return (
                      <tr key={t.tx_hash} className="border-b border-edge/60 transition hover:bg-white/[0.03]">
                        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-mute">
                          {(t.time_iso ?? "").slice(0, 10)}
                        </td>
                        <td className="px-4 py-2.5 font-medium">
                          {t.explorer_url ? (
                            <a href={t.explorer_url} target="_blank" rel="noreferrer"
                               className="hover:text-glow hover:underline">
                              {t.base?.symbol ?? "—"}
                            </a>
                          ) : (t.base?.symbol ?? "—")}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-mute">
                          {t.value_usd === null ? "—" : usd(t.value_usd)}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${
                          p >= 0 ? "text-up" : "text-down"
                        }`}>
                          {p >= 0 ? "+" : "−"}{usd(Math.abs(p))}
                          {t.roi_pct !== null && (
                            <span className="ml-2 text-[11px] font-normal text-mute">
                              {t.roi_pct >= 0 ? "+" : ""}{Math.round(t.roi_pct)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="px-1 text-[11px] leading-relaxed text-mute/70">
        Worked out from this wallet&apos;s on-chain trades
        {sum.coverage?.history_from
          ? ` since ${sum.coverage.history_from.slice(0, 10)}`
          : ""}. A trader may use other wallets we haven&apos;t found, so treat this as a
        floor rather than their complete record.
      </p>
    </div>
  );
}
