#!/usr/bin/env python3
"""
resolve_wallets.py  —  finds each trader's REAL trading wallet (EVM).

WHY THIS EXISTS
  fomo's leaderboard gives us `evmAddress` per trader, but that is fomo's provisioned
  (embedded) wallet — verified empty: no transactions on ETH/BSC/Base, and absent from
  the holder list of every token the trader supposedly owns. The positions in
  `topHoldings` are held by a DIFFERENT address. This finds it.

HOW
  fomo tells us the exact size of each position (`humanAmount`), so we ask Bitquery who
  holds that amount of that token, on that chain:

      Balance: {Amount: {ge: "10935385", le: "10979155"}}   # target ±0.2%

  The search band starts tight and only widens if nothing lands. A candidate is then
  cross-checked against the trader's OTHER positions with a plain balanceOf RPC call —
  free, and it works on chains regardless of holder-list availability.

  Ground truth (unipcs): resolves to 0x0a6ebed0155edb4b21d92ad02897a626cd90119e, agreeing
  across Robinhood (0.005% off), a second Robinhood token (0.012%), and BSC (9.3% — he
  kept trading after the snapshot).

  Note these wallets are EIP-7702 delegated EOAs, so they report `is_contract: true`.
  Never filter on that; it throws away the correct answer.

USAGE
  python3 resolve_wallets.py                 # resolve everyone, write data/wallets.json
  python3 resolve_wallets.py unipcs          # one trader, verbose, no write
  python3 resolve_wallets.py --limit 20
  python3 resolve_wallets.py --dry-run
  python3 resolve_wallets.py --retry     # only traders not yet resolved (quota top-up)
"""

import json
import pathlib
import sys
import time

import requests

import bitquery

DATA = pathlib.Path("data/wallets.json")

# Free public RPCs — used only for balanceOf confirmation, which needs no holder list.
RPCS = {
    4663: "https://rpc.mainnet.chain.robinhood.com",
    1:    "https://ethereum-rpc.publicnode.com",
    56:   "https://bsc-dataseed.binance.org",
    8453: "https://mainnet.base.org",
}
CHAIN_NAMES = {4663: "robinhood", 1: "ethereum", 56: "bsc", 8453: "base"}

# Leaderboard is a snapshot; active traders drift. Confirmation is looser than search.
CONFIRM_TOLERANCE = 0.15

SESSION = requests.Session()
_decimals_cache = {}


def _rpc(chain_id, method, params):
    try:
        r = SESSION.post(RPCS[chain_id], json={"jsonrpc": "2.0", "id": 1,
                                               "method": method, "params": params}, timeout=25)
        return r.json().get("result")
    except Exception:
        return None


def decimals(chain_id, contract):
    key = (chain_id, contract.lower())
    if key not in _decimals_cache:
        res = _rpc(chain_id, "eth_call", [{"to": contract, "data": "0x313ce567"}, "latest"])
        try:
            _decimals_cache[key] = int(res, 16)
        except (TypeError, ValueError):
            _decimals_cache[key] = 18
    return _decimals_cache[key]


def balance_of(chain_id, contract, wallet):
    """Confirm a candidate on any chain — no holder list needed, so BSC works too."""
    if chain_id not in RPCS:
        return None
    data = "0x70a08231" + wallet[2:].lower().rjust(64, "0")
    res = _rpc(chain_id, "eth_call", [{"to": contract, "data": data}, "latest"])
    try:
        return int(res, 16) / (10 ** decimals(chain_id, contract))
    except (TypeError, ValueError):
        return None


def _off(actual, target):
    return abs(actual - target) / target if target else None


def resolve(trader, verbose=False):
    holdings = [h for h in (trader.get("holdings") or [])
                if h.get("networkId") in bitquery.NETWORKS
                and h.get("tokenAddress") and (h.get("humanAmount") or 0) > 0]
    if not holdings:
        return {"wallet": "", "confidence": "no-evm-holdings", "matches": []}

    # PASS 1 — ask the chain who holds this exact amount.
    candidates = {}
    for h in holdings:
        cid, contract, target = h["networkId"], h["tokenAddress"], h["humanAmount"]
        rows, band = bitquery.find_holder(bitquery.NETWORKS[cid], contract, target)
        for addr, amt in rows[:5]:
            rec = candidates.setdefault(addr.lower(), {"address": addr, "matches": []})
            rec["matches"].append({"chain": CHAIN_NAMES[cid], "token": contract,
                                   "reported": target, "onchain": amt,
                                   "off_by": _off(amt, target), "band": band})
        if verbose:
            print(f"    {CHAIN_NAMES[cid]:<10} {contract[:12]}… target={target:,.4f} "
                  f"band=±{band * 100 if band else '-'}% hits={len(rows)}")

    if not candidates:
        return {"wallet": "", "confidence": "unresolved", "matches": []}

    best = max(candidates.values(),
               key=lambda c: (len(c["matches"]), -min(m["off_by"] for m in c["matches"])))
    wallet = best["address"]

    # PASS 2 — confirm on the trader's other positions via balanceOf.
    for h in holdings:
        cid, contract, target = h["networkId"], h["tokenAddress"], h["humanAmount"]
        if any(m["token"].lower() == contract.lower() for m in best["matches"]):
            continue
        bal = balance_of(cid, contract, wallet)
        off = _off(bal, target) if bal is not None else None
        if off is not None and off <= CONFIRM_TOLERANCE:
            best["matches"].append({"chain": CHAIN_NAMES[cid], "token": contract,
                                    "reported": target, "onchain": bal,
                                    "off_by": off, "via": "balanceOf"})
            if verbose:
                print(f"    confirmed on {CHAIN_NAMES[cid]}: {bal:,.4f} vs {target:,.4f}")
        time.sleep(0.1)

    n = len(best["matches"])
    best_off = min(m["off_by"] for m in best["matches"])
    if n >= 2:
        confidence = "confirmed"
    else:
        rivals = sorted(min(m["off_by"] for m in c["matches"])
                        for a, c in candidates.items() if a != wallet.lower())
        clear = not rivals or (best_off <= 0.01 and rivals[0] > best_off * 5)
        confidence = "high-candidate" if clear else "ambiguous"

    return {"wallet": wallet, "confidence": confidence, "matches": best["matches"],
            "best_off_by": best_off, "candidates_considered": len(candidates)}


def flag_collisions(traders):
    """Two traders cannot share a trading wallet. If one address is claimed twice it is
    almost certainly a pool or a fomo-internal address, so demote every claim to it."""
    seen = {}
    for t in traders:
        w = (t.get("resolved_evm") or "").lower()
        if w:
            seen.setdefault(w, []).append(t)
    collisions = 0
    for w, group in seen.items():
        if len(group) > 1:
            collisions += 1
            for t in group:
                t["resolution"]["confidence"] = "collision"
                t["resolution"]["shared_with"] = [g["handle"] for g in group
                                                  if g["handle"] != t["handle"]]
    return collisions


def main():
    args = sys.argv[1:]
    dry = "--dry-run" in args
    limit = None
    if "--limit" in args:
        limit = int(args[args.index("--limit") + 1])
        args = [a for a in args if a not in ("--limit", str(limit))]
    retry = "--retry" in args
    handles = [a for a in args if not a.startswith("--")]

    if not bitquery.have_key():
        print("BITQUERY_KEY is not set — add it to .env")
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
        # Quota exhaustion looks identical to a genuine miss, so a top-up run re-tries
        # everything that has no usable answer yet and leaves settled results alone.
        targets = [t for t in traders
                   if t.get("resolution", {}).get("confidence")
                   not in ("confirmed", "high-candidate", "no-evm-holdings")]
        if limit:
            targets = targets[:limit]
        print(f"retry mode: {len(targets)} trader(s) still need an answer")
    else:
        targets = traders[:limit] if limit else traders

    print(f"resolving {len(targets)} trader(s) via Bitquery "
          f"({', '.join(bitquery.NETWORKS.values())})\n")

    stats = {}
    for i, t in enumerate(targets, 1):
        print(f"{i:>3}. {t['handle']}")
        res = resolve(t, verbose=bool(handles))
        t["resolved_evm"] = res["wallet"]
        t["resolution"] = {k: v for k, v in res.items() if k != "wallet"}
        stats[res["confidence"]] = stats.get(res["confidence"], 0) + 1

        if res["wallet"]:
            print(f"     -> {res['wallet']}  [{res['confidence']}, {len(res['matches'])} match(es)]")
            if handles:
                for m in res["matches"]:
                    print(f"        {m['chain']:<10} reported {m['reported']:,.4f} "
                          f"vs on-chain {m['onchain']:,.4f}  ({m['off_by'] * 100:.4f}% off)"
                          f"{'  [balanceOf]' if m.get('via') else ''}")
                print(f"     leaderboard said: {t['evm']}")
                print(f"     same wallet?      {'YES' if res['wallet'].lower() == t['evm'].lower() else 'NO — leaderboard address is not the trading wallet'}")
        else:
            print(f"     -> {res['confidence']}")

    if not handles:
        n = flag_collisions(targets)
        if n:
            print(f"\n{n} address(es) claimed by more than one trader -> demoted to 'collision'")
            stats = {}
            for t in targets:
                c = t.get("resolution", {}).get("confidence", "?")
                stats[c] = stats.get(c, 0) + 1

    print("\n" + "=" * 60)
    for k, v in sorted(stats.items(), key=lambda x: -x[1]):
        print(f"  {k:<20} {v}")

    if not dry:
        doc["resolved_at"] = int(time.time())
        with open(DATA, "w") as f:
            json.dump(doc, f, indent=2)
        good = sum(1 for t in traders
                   if t.get("resolution", {}).get("confidence") in ("confirmed", "high-candidate"))
        print(f"\nwrote {DATA} — {good}/{len(traders)} traders resolved with usable confidence.")
    else:
        print("\n(dry run — data/wallets.json not modified)")


if __name__ == "__main__":
    main()
