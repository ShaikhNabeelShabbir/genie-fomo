"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import SearchBar from "@/components/SearchBar";
import TraderCard from "@/components/TraderCard";
import TransfersTable from "@/components/TransfersTable";
import type { LookupResult } from "@/lib/types";
import { usd } from "@/lib/format";

type Suggestion = { handle: string; name: string; pnl: number; rank: number };

export default function Home() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LookupResult | null>(null);
  const [top, setTop] = useState<Suggestion[]>([]);
  const [total, setTotal] = useState(0);
  const [seed, setSeed] = useState("");

  useEffect(() => {
    fetch("/api/traders?limit=6")
      .then((r) => r.json())
      .then((d) => {
        setTop(d.results ?? []);
        setTotal(d.total ?? 0);
      })
      .catch(() => {});
  }, []);

  const lookup = useCallback(async (query: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/trader/${encodeURIComponent(query)}`);
      const json = await r.json();
      if (!r.ok) {
        setData(null);
        setError(json.error ?? `Lookup failed (HTTP ${r.status}).`);
        return;
      }
      setData(json as LookupResult);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    // /?q=handle — how the directory page hands a trader over
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) {
      setSeed(q);
      lookup(q);
    }
  }, [lookup]);

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10">
      <header className="mb-8 flex flex-wrap items-end gap-4">
        <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          genie<span className="text-glow">·</span>fomo
        </h1>
        <p className="mt-1 text-sm text-mute">
          Type a trader name — get their wallet and every EVM transfer across Ethereum, BSC, Base
          and Robinhood Chain.{" "}
          {total > 0 && <span className="text-mute/70">{total} traders indexed.</span>}
        </p>
        </div>
        <Link
          href="/traders"
          className="ml-auto rounded-xl border border-edge px-4 py-2 text-sm font-medium text-mute transition hover:border-glow/50 hover:text-white"
        >
          Browse directory →
        </Link>
      </header>

      <SearchBar onSubmit={lookup} busy={busy} seed={seed} />

      {!data && !error && !busy && top.length > 0 && (
        <section className="mt-8">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-mute">
            Top of the leaderboard
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {top.map((t) => (
              <button
                key={t.handle}
                onClick={() => lookup(t.handle)}
                className="flex items-center gap-3 rounded-xl border border-edge bg-panel px-4 py-3 text-left transition hover:border-glow/50"
              >
                <span className="w-7 shrink-0 text-xs tabular-nums text-mute">#{t.rank}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{t.name}</span>
                  <span className="block truncate font-mono text-xs text-mute">@{t.handle}</span>
                </span>
                <span className={`shrink-0 text-xs tabular-nums ${t.pnl >= 0 ? "text-up" : "text-down"}`}>
                  {usd(t.pnl)}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {busy && (
        <div className="mt-8 animate-pulse space-y-3">
          <div className="h-36 rounded-2xl border border-edge bg-panel" />
          <div className="h-72 rounded-2xl border border-edge bg-panel" />
        </div>
      )}

      {error && !busy && (
        <div className="mt-8 rounded-2xl border border-down/40 bg-down/5 p-5 text-sm text-down">
          {error}
        </div>
      )}

      {data && !busy && (
        <section className="mt-8 space-y-4">
          <TraderCard trader={data.trader} wallet={data.wallet} />

          <div className="flex flex-wrap items-center gap-3 text-xs text-mute">
            <span>
              {data.transfers.length} transfers · resolved via {data.resolvedVia}
            </span>
            <span className="font-mono">{data.wallet}</span>
            <button
              onClick={() => lookup(data.query)}
              className="ml-auto rounded-lg border border-edge px-3 py-1.5 font-medium transition hover:border-glow/50 hover:text-white"
            >
              ↻ Refresh
            </button>
          </div>

          {/* Nothing to filter or export when the wallet is empty — the summary line above
              already says "0 transfers", so the table would only render chrome. */}
          {data.transfers.length > 0 && (
            <TransfersTable
              transfers={data.transfers}
              chains={data.chains}
              handle={data.trader?.handle ?? data.wallet}
              pulledAt={data.pulledAt}
            />
          )}
        </section>
      )}
    </main>
  );
}
