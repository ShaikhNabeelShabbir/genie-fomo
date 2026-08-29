"use client";

import { useMemo, useState } from "react";
import type { ChainKey, ChainResult, Transfer } from "@/lib/types";
import { CHAINS, txUrl } from "@/lib/evm.client";
import { ago, amount, shortAddr, when } from "@/lib/format";

const CSV_COLS = [
  "handle", "wallet", "chain", "tx_hash", "time", "token",
  "contract", "amount", "side", "from", "to",
] as const;

function toCsv(rows: Transfer[], pulledAt: string): string {
  const head = [...CSV_COLS, "pulled_at"].join(",");
  const body = rows.map((r) =>
    [...CSV_COLS.map((c) => r[c]), pulledAt]
      .map((v) => {
        const s = String(v ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(","),
  );
  return [head, ...body].join("\n");
}

export default function TransfersTable({
  transfers,
  chains,
  handle,
  pulledAt,
}: {
  transfers: Transfer[];
  chains: ChainResult[];
  handle: string;
  pulledAt: string;
}) {
  const [chain, setChain] = useState<ChainKey | "all">("all");
  const [side, setSide] = useState<"all" | "in" | "out">("all");
  const [token, setToken] = useState("");
  const [shown, setShown] = useState(60);

  const rows = useMemo(() => {
    const q = token.trim().toLowerCase();
    return transfers.filter(
      (t) =>
        (chain === "all" || t.chain === chain) &&
        (side === "all" || t.side === side) &&
        (!q || (t.token ?? "").toLowerCase().includes(q)),
    );
  }, [transfers, chain, side, token]);

  function download() {
    const blob = new Blob([toCsv(rows, pulledAt)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${handle || "wallet"}_evm_trades.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const chip = (on: boolean) =>
    `rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
      on ? "border-glow bg-glow/15 text-white" : "border-edge text-mute hover:border-glow/40 hover:text-white"
    }`;

  return (
    <div className="rounded-2xl border border-edge bg-panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-edge p-4">
        <button onClick={() => setChain("all")} className={chip(chain === "all")}>
          All chains <span className="tabular-nums text-mute">{transfers.length}</span>
        </button>
        {chains.map((c) => (
          <button
            key={c.chain}
            onClick={() => setChain(c.chain)}
            disabled={!!c.error}
            title={c.error ?? ""}
            className={`${chip(chain === c.chain)} ${c.error ? "cursor-not-allowed opacity-45" : ""}`}
          >
            {CHAINS[c.chain].label}{" "}
            <span className="tabular-nums text-mute">{c.error ? "!" : c.count}</span>
          </button>
        ))}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {(["all", "in", "out"] as const).map((s) => (
            <button key={s} onClick={() => setSide(s)} className={chip(side === s)}>
              {s}
            </button>
          ))}
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="filter token…"
            className="w-32 rounded-lg border border-edge bg-black/30 px-3 py-1.5 text-xs outline-none placeholder:text-mute/70 focus:border-glow/60"
          />
          <button
            onClick={download}
            disabled={!rows.length}
            className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-mute transition hover:border-glow/50 hover:text-white disabled:opacity-40"
          >
            ↓ CSV
          </button>
        </div>
      </div>

      {chains.some((c) => c.error) && (
        <div className="border-b border-edge bg-down/5 px-4 py-2 text-xs text-down">
          {chains
            .filter((c) => c.error)
            .map((c) => `${CHAINS[c.chain].label}: ${c.error}`)
            .join(" · ")}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="p-10 text-center text-sm text-mute">
          No transfers match these filters.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-edge text-left text-[10px] uppercase tracking-wider text-mute">
                <th className="px-4 py-2.5 font-semibold">Chain</th>
                <th className="px-4 py-2.5 font-semibold">Time</th>
                <th className="px-4 py-2.5 font-semibold">Side</th>
                <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                <th className="px-4 py-2.5 font-semibold">Token</th>
                <th className="px-4 py-2.5 font-semibold">Counterparty</th>
                <th className="px-4 py-2.5 font-semibold">Tx</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((t, i) => (
                <tr
                  key={`${t.tx_hash}-${t.chain}-${i}`}
                  className="border-b border-edge/60 transition hover:bg-white/[0.03]"
                >
                  <td className="px-4 py-2.5 text-xs text-mute">{CHAINS[t.chain].label}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs">
                    {when(t.time)}
                    <span className="ml-2 text-mute">{ago(t.time)}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                        t.side === "in" ? "bg-up/15 text-up" : "bg-down/15 text-down"
                      }`}
                    >
                      {t.side}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                    {amount(t.amount)}
                  </td>
                  <td className="px-4 py-2.5 font-medium">{t.token || "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-mute">
                    {shortAddr(t.side === "in" ? t.from : t.to)}
                  </td>
                  <td className="px-4 py-2.5">
                    <a
                      href={txUrl(t.chain, t.tx_hash)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-glow hover:underline"
                    >
                      {shortAddr(t.tx_hash)}
                    </a>
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
