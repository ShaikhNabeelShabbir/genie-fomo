"use client";

import { useEffect, useRef, useState } from "react";
import { usd } from "@/lib/format";

type Suggestion = {
  rank: number;
  handle: string;
  name: string;
  evm: string;
  pnl: number;
  avatar: string;
  verified: boolean;
};

export default function SearchBar({
  onSubmit,
  busy,
  seed = "",
}: {
  onSubmit: (query: string) => void;
  busy: boolean;
  /** Prefills the box when a lookup is kicked off from elsewhere (e.g. /?q=handle). */
  seed?: string;
}) {
  const [value, setValue] = useState("");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (seed) setValue(seed);
  }, [seed]);

  useEffect(() => {
    const q = value.trim();
    if (!q) {
      setItems([]);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/traders?q=${encodeURIComponent(q)}&limit=8`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((d) => {
          setItems(d.results ?? []);
          setActive(-1);
        })
        .catch(() => {});
    }, 120);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [value]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function go(q: string) {
    if (!q.trim()) return;
    setValue(q);
    setOpen(false);
    onSubmit(q.trim());
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || !items.length) {
      if (e.key === "Enter") go(value);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(active >= 0 ? items[active].handle : value);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={box} className="relative w-full">
      <div className="flex items-center gap-2 rounded-2xl border border-edge bg-panel/80 px-4 py-3 shadow-2xl shadow-black/40 backdrop-blur focus-within:border-glow/60">
        <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-mute" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          value={value}
          autoFocus
          spellCheck={false}
          placeholder="Trader name, @handle, or 0x wallet address…"
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="w-full bg-transparent text-base outline-none placeholder:text-mute/70"
        />
        <button
          onClick={() => go(value)}
          disabled={busy || !value.trim()}
          className="shrink-0 rounded-xl bg-glow px-4 py-1.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Scanning…" : "Look up"}
        </button>
      </div>

      {open && items.length > 0 && (
        <ul className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border border-edge bg-panel shadow-2xl shadow-black/60">
          {items.map((s, i) => (
            <li key={s.handle}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => go(s.handle)}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition ${
                  i === active ? "bg-white/[0.06]" : "hover:bg-white/[0.04]"
                }`}
              >
                <span className="w-8 shrink-0 text-xs tabular-nums text-mute">#{s.rank}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {s.name}
                    {s.verified && <span className="ml-1 text-glow">✦</span>}
                  </span>
                  <span className="block truncate font-mono text-xs text-mute">@{s.handle}</span>
                </span>
                <span className={`shrink-0 text-xs tabular-nums ${s.pnl >= 0 ? "text-up" : "text-down"}`}>
                  {usd(s.pnl)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
