"use client";

import { useState } from "react";
import type { ScannedWallet, Trader } from "@/lib/types";
import { compact, shortAddr, usd } from "@/lib/format";

/** How much the resolver trusts this address, and why it matters: `leaderboard` means we
 *  fell back to fomo's provisioned wallet, which holds nothing and will look empty. */
function ConfidenceBadge({ w }: { w: ScannedWallet }) {
  const tone =
    w.source === "resolved"
      ? w.confidence === "confirmed"
        ? "border-up/50 bg-up/10 text-up"
        : "border-glow/50 bg-glow/10 text-glow"
      : "border-down/40 bg-down/10 text-down";
  const label =
    w.source === "resolved"
      ? w.confidence === "confirmed"
        ? "verified on 2+ tokens"
        : "likely match"
      : w.source === "address-input"
        ? "as entered"
        : `unresolved — fomo wallet (${w.confidence})`;
  return (
    <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${tone}`}>
      {label}
    </span>
  );
}

function WalletRow({ label, w }: { label: string; w: ScannedWallet | null }) {
  const [copied, setCopied] = useState(false);
  if (!w?.address) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => {
          navigator.clipboard?.writeText(w.address);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        title={w.address}
        className="group flex items-center gap-2 rounded-lg border border-edge bg-black/30 px-3 py-1.5 transition hover:border-glow/50"
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider text-mute">{label}</span>
        <span className="font-mono text-xs">{shortAddr(w.address)}</span>
        <span className="text-[10px] text-mute group-hover:text-glow">{copied ? "copied" : "copy"}</span>
      </button>
      <ConfidenceBadge w={w} />
    </div>
  );
}

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

export default function TraderCard({
  trader,
  evmWallet,
  solWallet,
}: {
  trader: Trader | null;
  evmWallet: ScannedWallet | null;
  solWallet: ScannedWallet | null;
}) {
  if (!trader) {
    return (
      <div className="rounded-2xl border border-edge bg-panel p-5">
        <div className="text-xs uppercase tracking-wider text-mute">Raw wallet</div>
        <div className="mt-1 font-mono text-sm break-all">{evmWallet?.address}</div>
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
          {/* The addresses we actually scanned — the resolved trading wallets, not the
              provisioned ones fomo reports. */}
          <div className="mt-3 space-y-2">
            <WalletRow label="EVM" w={evmWallet} />
            <WalletRow label="SOL" w={solWallet} />
          </div>

          {(evmWallet?.source === "resolved" || solWallet?.source === "resolved") && (
            <div className="mt-2 text-[11px] text-mute">
              fomo lists{" "}
              <span className="font-mono">{shortAddr(trader.evm)}</span>
              {trader.sol && <> / <span className="font-mono">{shortAddr(trader.sol)}</span></>}
              {" "}— provisioned wallets that hold none of the positions above.
            </div>
          )}
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
