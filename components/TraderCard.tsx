"use client";

import { useState } from "react";
import type { Trader } from "@/lib/types";
import { compact, shortAddr, usd } from "@/lib/format";

function Copyable({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      title={value}
      className="group flex items-center gap-2 rounded-lg border border-edge bg-black/30 px-3 py-1.5 text-left transition hover:border-glow/50"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-mute">{label}</span>
      <span className="font-mono text-xs">{shortAddr(value)}</span>
      <span className="text-[10px] text-mute group-hover:text-glow">{copied ? "copied" : "copy"}</span>
    </button>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-xl border border-edge bg-black/20 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-mute">{label}</div>
      <div
        className={`mt-1 text-lg font-semibold tabular-nums ${
          tone === "up" ? "text-up" : tone === "down" ? "text-down" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

export default function TraderCard({ trader, wallet }: { trader: Trader | null; wallet: string }) {
  if (!trader) {
    return (
      <div className="rounded-2xl border border-edge bg-panel p-5">
        <div className="text-xs uppercase tracking-wider text-mute">Raw wallet</div>
        <div className="mt-1 font-mono text-sm break-all">{wallet}</div>
      </div>
    );
  }

  const holdings = (trader.holdings ?? []).slice(0, 3);

  return (
    <div className="overflow-hidden rounded-2xl border border-edge bg-panel">
      <div className="flex flex-wrap items-start gap-4 p-5">
        <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-full border border-edge bg-black/40 text-xl font-bold text-glow">
          {trader.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={trader.avatar} alt="" className="size-full object-cover" />
          ) : (
            trader.name.slice(0, 1).toUpperCase()
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-semibold">{trader.name}</h2>
            {trader.verified && <span className="text-glow">✦</span>}
            {trader.rank > 0 && (
              <span className="rounded-full border border-glow/40 bg-glow/10 px-2 py-0.5 text-[11px] font-semibold text-glow">
                rank #{trader.rank}
              </span>
            )}
          </div>
          <div className="font-mono text-sm text-mute">@{trader.handle}</div>
          {trader.bio && (
            <p className="mt-2 max-w-2xl whitespace-pre-line text-sm text-mute">{trader.bio}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Copyable label="EVM" value={trader.evm || wallet} />
            <Copyable label="SOL" value={trader.sol} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-edge p-5 sm:grid-cols-4">
        <Stat label="PnL (30d)" value={usd(trader.pnl)} tone={trader.pnl >= 0 ? "up" : "down"} />
        <Stat label="Volume" value={usd(trader.volume)} />
        <Stat label="Trades" value={compact(trader.trades)} />
        <Stat label="Followers" value={compact(trader.followers)} />
      </div>

      {holdings.length > 0 && (
        <div className="border-t border-edge p-5">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-mute">
            Top holdings
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {holdings.map((h, i) => (
              <div
                key={`${h.tokenAddress}-${i}`}
                className="flex items-center gap-3 rounded-xl border border-edge bg-black/20 p-3"
              >
                <div className="size-8 shrink-0 overflow-hidden rounded-full bg-black/50">
                  {h.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={h.imageUrl} alt="" className="size-full object-cover" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs text-mute">
                    {shortAddr(h.tokenAddress ?? "")}
                  </div>
                  <div className="text-sm font-semibold tabular-nums">{usd(h.value ?? 0)}</div>
                </div>
                <div
                  className={`ml-auto shrink-0 text-xs tabular-nums ${
                    (h.pnl ?? 0) >= 0 ? "text-up" : "text-down"
                  }`}
                >
                  {usd(h.pnl ?? 0)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
