import Link from "next/link";
import TraderList from "@/components/TraderList";
import { traders } from "@/lib/directory";
import { usd } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "genie-fomo — trader directory",
};

export default function TradersPage() {
  const list = traders();
  const totalPnl = list.reduce((sum, t) => sum + t.pnl, 0);
  const withWallet = list.filter((t) => t.evm).length;

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10">
      <header className="mb-8 flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            genie<span className="text-glow">·</span>fomo <span className="text-mute">/ directory</span>
          </h1>
        </div>
        <Link
          href="/"
          className="ml-auto rounded-xl border border-edge px-4 py-2 text-sm font-medium text-mute transition hover:border-glow/50 hover:text-white"
        >
          ← Lookup
        </Link>
      </header>

      {list.length === 0 ? (
        <div className="rounded-2xl border border-down/40 bg-down/5 p-5 text-sm text-down">
          No directory found. Run <span className="font-mono">python3 build_directory.py --offline</span>{" "}
          to build <span className="font-mono">data/wallets.json</span>.
        </div>
      ) : (
        <TraderList traders={list} />
      )}
    </main>
  );
}
