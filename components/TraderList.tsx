"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Trader } from "@/lib/types";
import { isUsable } from "@/lib/types";
import { compact, shortAddr, usd } from "@/lib/format";

type SortKey = "rank" | "pnl" | "name" | "volume";

function CopyAddr({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-mute">—</span>;
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      title={value}
      className="group font-mono text-xs text-mute transition hover:text-white"
    >
      {shortAddr(value)}
      <span className="ml-2 text-[10px] opacity-0 transition group-hover:opacity-100">
        {copied ? "copied" : "copy"}
      </span>
    </button>
  );
}

export default function TraderList({ traders }: { traders: Trader[] }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("rank");
  const [shown, setShown] = useState(50);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/^@/, "");
    const filtered = needle
      ? traders.filter(
          (t) =>
            t.handle.toLowerCase().includes(needle) ||
            t.name.toLowerCase().includes(needle) ||
            t.evm.toLowerCase().includes(needle),
        )
      : traders;
    const sorted = [...filtered];
    if (sort === "pnl") sorted.sort((a, b) => b.pnl - a.pnl);
    else if (sort === "volume") sorted.sort((a, b) => b.volume - a.volume);
    else if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else sorted.sort((a, b) => a.rank - b.rank);
    return sorted;
  }, [traders, q, sort]);

  const chip = (on: boolean) =>
    `rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
      on ? "border-glow bg-glow/15 text-white" : "border-edge text-mute hover:border-glow/40 hover:text-white"
    }`;

  return (
    <div className="rounded-2xl border border-edge bg-panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-edge p-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          spellCheck={false}
          placeholder="Filter by name, handle or address…"
          className="w-64 rounded-lg border border-edge bg-black/30 px-3 py-1.5 text-sm outline-none placeholder:text-mute/70 focus:border-glow/60"
        />
        <span className="text-xs text-mute">
          {rows.length} of {traders.length}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-mute">Sort</span>
          {(["rank", "pnl", "volume", "name"] as const).map((s) => (
            <button key={s} onClick={() => setSort(s)} className={chip(sort === s)}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="p-10 text-center text-sm text-mute">Nobody matches that filter.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-edge text-left text-[10px] uppercase tracking-wider text-mute">
                <th className="px-4 py-2.5 font-semibold">#</th>
                <th className="px-4 py-2.5 font-semibold">Trader</th>
                <th className="px-4 py-2.5 font-semibold">Trading wallet</th>
                <th className="px-4 py-2.5 text-right font-semibold">PnL (30d)</th>
                <th className="px-4 py-2.5 text-right font-semibold">Volume</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((t) => (
                <tr key={t.handle} className="border-b border-edge/60 transition hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5 text-xs tabular-nums text-mute">{t.rank}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <div className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full border border-edge bg-black/40 text-xs font-bold text-glow">
                        {t.avatar ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={t.avatar} alt="" className="size-full object-cover" />
                        ) : (
                          t.name.slice(0, 1).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {t.name}
                          {t.verified && <span className="ml-1 text-glow">✦</span>}
                        </div>
                        <div className="truncate font-mono text-xs text-mute">@{t.handle}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {/* The resolved address is the one worth showing — fomo's own
                        evm/sol fields are provisioned wallets that hold nothing. */}
                    {isUsable(t.resolution) && t.resolved_evm ? (
                      <div className="flex items-center gap-2">
                        <CopyAddr value={t.resolved_evm} />
                        <span
                          title={`EVM ${t.resolution!.confidence}`}
                          className={`size-1.5 shrink-0 rounded-full ${
                            t.resolution!.confidence === "confirmed" ? "bg-up" : "bg-glow"
                          }`}
                        />
                      </div>
                    ) : isUsable(t.sol_resolution) && t.resolved_sol ? (
                      <div className="flex items-center gap-2">
                        <CopyAddr value={t.resolved_sol} />
                        <span
                          title={`Solana ${t.sol_resolution!.confidence}`}
                          className={`size-1.5 shrink-0 rounded-full ${
                            t.sol_resolution!.confidence === "confirmed" ? "bg-up" : "bg-glow"
                          }`}
                        />
                      </div>
                    ) : (
                      <span className="text-xs text-mute/60">unresolved</span>
                    )}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right font-medium tabular-nums ${
                      t.pnl >= 0 ? "text-up" : "text-down"
                    }`}
                  >
                    {usd(t.pnl)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-mute">
                    {usd(t.volume)}
                    <span className="ml-2 text-xs">{compact(t.trades)} tx</span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link
                      href={`/?q=${encodeURIComponent(t.handle)}`}
                      className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-mute transition hover:border-glow/50 hover:text-white"
                    >
                      Scan →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {rows.length > shown && (
            <button
              onClick={() => setShown((n) => n + 100)}
              className="w-full border-t border-edge py-3 text-xs font-medium text-mute transition hover:bg-white/[0.03] hover:text-white"
            >
              Show more — {rows.length - shown} remaining
            </button>
          )}
        </div>
      )}
    </div>
  );
}
