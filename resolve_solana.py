#!/usr/bin/env python3
"""
resolve_solana.py  —  finds each trader's REAL Solana trading wallet.

Same idea as resolve_wallets.py, other chain. fomo's leaderboard `address` field is the
trader's provisioned wallet — all 150 of them have never been funded with SOL and hold
next to nothing. The Solana positions in `topHoldings` sit somewhere else.

METHOD
  fomo reports the exact size of each Solana position, so we ask who holds that amount
  of that mint:

    1. getTokenLargestAccounts (2 credits) — top 20 holders, owner-resolved. Settles the
       big positions, which is most of what shows up in topHoldings.
    2. DAS getTokenAccounts (10 credits/page) — full holder list, only when step 1 misses.
    3. getTokenAccountsByOwner (1 credit) — confirm the candidate on the trader's other
       mints without another holder scan.

  Kept separate from the EVM pass because it has its own key, its own quota and its own
  rate limit (DAS is capped at 2 req/sec on the free tier).

USAGE
  python3 resolve_solana.py                # everyone, writes data/wallets.json
  python3 resolve_solana.py PoorGoat_      # one trader, verbose, no write
  python3 resolve_solana.py --limit 20
  python3 resolve_solana.py --retry        # only traders still without an answer
  python3 resolve_solana.py --dry-run
"""

import json
import pathlib
import sys
import time

import helius

DATA = pathlib.Path("data/wallets.json")
SOLANA_NETWORK_ID = 1399811149


def sol_holdings(trader):
    return [h for h in (trader.get("holdings") or [])
            if h.get("networkId") == SOLANA_NETWORK_ID
            and h.get("tokenAddress") and (h.get("humanAmount") or 0) > 0]


def flag_collisions(traders):
    """One wallet cannot belong to two traders — a shared hit is a pool or an exchange."""
    seen = {}
    for t in traders:
        w = t.get("resolved_sol") or ""
        if w:
            seen.setdefault(w, []).append(t)
    n = 0
    for w, group in seen.items():
        if len(group) > 1:
            n += 1
            for t in group:
                t["sol_resolution"]["confidence"] = "collision"
                t["sol_resolution"]["shared_with"] = [g["handle"] for g in group
                                                      if g["handle"] != t["handle"]]
    return n


def main():
    args = sys.argv[1:]
    dry = "--dry-run" in args
    retry = "--retry" in args
    limit = None
    if "--limit" in args:
        limit = int(args[args.index("--limit") + 1])
        args = [a for a in args if a not in ("--limit", str(limit))]
    handles = [a for a in args if not a.startswith("--")]

    if not helius.have_key():
        print("HELIUS_SOLANA_KEY is not set — add it to .env")
        return
    if not DATA.exists():
        print("data/wallets.json missing — run: python3 build_directory.py --offline")
        return

    doc = json.load(open(DATA))
    traders = doc["traders"]

    if handles:
        wanted = {h.lower() for h in handles}
        targets = [t for t in traders if t["handle"].lower() in wanted]
        if not targets:
            print(f"no such handle: {', '.join(handles)}")
            return
        dry = True
    elif retry:
        targets = [t for t in traders
                   if t.get("sol_resolution", {}).get("confidence")
                   not in ("confirmed", "high-candidate", "no-sol-holdings")]
        if limit:
            targets = targets[:limit]
        print(f"retry mode: {len(targets)} trader(s) still need a Solana answer")
    else:
        targets = traders[:limit] if limit else traders

    with_sol = sum(1 for t in targets if sol_holdings(t))
    print(f"resolving Solana wallets for {len(targets)} trader(s) "
          f"({with_sol} have Solana positions)\n")

    stats = {}
    for i, t in enumerate(targets, 1):
        hs = sol_holdings(t)
        print(f"{i:>3}. {t['handle']}")
        res = helius.resolve(t, hs, verbose=bool(handles))
        t["resolved_sol"] = res["wallet"]
        t["sol_resolution"] = {k: v for k, v in res.items() if k != "wallet"}
        stats[res["confidence"]] = stats.get(res["confidence"], 0) + 1

        if res["wallet"]:
            print(f"     -> {res['wallet']}  [{res['confidence']}, {len(res['matches'])} match(es)]")
            if handles:
                for m in res["matches"]:
                    print(f"        {m['token'][:14]}…  reported {m['reported']:,.4f} "
                          f"vs on-chain {m['onchain']:,.4f}  ({m['off_by'] * 100:.4f}% off)"
                          f"  [{m.get('source')}]")
                print(f"     leaderboard said: {t['sol']}")
                print(f"     same wallet?      {'YES' if res['wallet'] == t['sol'] else 'NO — leaderboard address is not the trading wallet'}")
        else:
            print(f"     -> {res['confidence']}")

    if not handles:
        n = flag_collisions(targets)
        if n:
            print(f"\n{n} address(es) claimed by more than one trader -> 'collision'")
            stats = {}
            for t in targets:
                c = t.get("sol_resolution", {}).get("confidence", "?")
                stats[c] = stats.get(c, 0) + 1

    print("\n" + "=" * 60)
    for k, v in sorted(stats.items(), key=lambda x: -x[1]):
        print(f"  {k:<20} {v}")

    if not dry:
        doc["sol_resolved_at"] = int(time.time())
        with open(DATA, "w") as f:
            json.dump(doc, f, indent=2)
        good = sum(1 for t in traders
                   if t.get("sol_resolution", {}).get("confidence")
                   in ("confirmed", "high-candidate"))
        print(f"\nwrote {DATA} — {good}/{len(traders)} traders have a usable Solana wallet.")
    else:
        print("\n(dry run — data/wallets.json not modified)")


if __name__ == "__main__":
    main()
