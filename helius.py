#!/usr/bin/env python3
"""
helius.py  —  the Solana half of the pipeline.

Two jobs, same shape as the EVM side in resolve_wallets.py:

  1. RESOLVE  — given a mint and the amount fomo says a trader holds, find the wallet
                that actually holds it. Needs holder-lists-by-mint, which the public
                Solana RPC refuses (`getTokenLargestAccounts` -> "Too many requests for
                a specific RPC call", every time). Helius serves it.

  2. TRADES   — decoded swaps for a resolved wallet, via the Enhanced Transactions API.

CREDIT DISCIPLINE (free tier = 1M credits/mo, DAS capped at 2 req/sec)
  standard RPC   1 credit    getTokenLargestAccounts, getMultipleAccounts, getTokenSupply
  DAS            10 credits  getTokenAccounts (full holder list, 1000/page)
  Enhanced       100 credits /v0/addresses/{a}/transactions (100 tx/page)

  So resolution tries the cheap path first: top-20 holders costs 2 credits and settles
  most traders, because a trader only shows up in `topHoldings` when the position is big.
  The 10-credits-per-page DAS scan is the fallback for when they are not in the top 20.

  NOTE: the Enhanced Transactions API is a LEGACY product in maintenance mode. Its
  successors (getTransactionsForAddress, Parsed Events) are paid-plan only, so on the
  free tier this is still the way to get decoded swaps.

SETUP
  export HELIUS_SOLANA_KEY="..."   # free key from helius.dev (or put it in .env)
  python3 helius.py check        # verify the key works and show what it can reach
  python3 helius.py holders <mint>
  python3 helius.py swaps <wallet>
"""

import os
import pathlib
import sys
import time

import requests


def _load_key():
    """HELIUS_SOLANA_KEY from the environment, falling back to .env (which python
    doesn't read on its own — only Next.js does)."""
    for name in ("HELIUS_SOLANA_KEY", "HELIUS_KEY"):
        v = os.environ.get(name, "").strip()
        if v:
            return v
    env = pathlib.Path(".env")
    if env.exists():
        for line in env.read_text().splitlines():
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() in ("HELIUS_SOLANA_KEY", "HELIUS_KEY"):
                return v.strip()
    return ""


HELIUS_KEY = _load_key()
RPC = (os.environ.get("SOLANA_RPC")
       or (f"https://mainnet.helius-rpc.com/?api-key={HELIUS_KEY}" if HELIUS_KEY
           else "https://api.mainnet-beta.solana.com"))
ENHANCED = "https://api.helius.xyz/v0"

TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
DAS_SLEEP = 0.55          # free tier caps DAS at 2 req/sec
MAX_DAS_PAGES = 30        # 30k accounts; large memecoins go deeper, but cap the spend

SESSION = requests.Session()
_decimals_cache = {}


def have_key():
    return bool(HELIUS_KEY)


def rpc(method, params, tries=3):
    """JSON-RPC against Helius (or the public endpoint if no key is set)."""
    for i in range(tries):
        try:
            r = SESSION.post(RPC, json={"jsonrpc": "2.0", "id": "1",
                                        "method": method, "params": params}, timeout=30)
            j = r.json()
            if j.get("error"):
                msg = j["error"].get("message", "")
                if "Too many requests" in msg or r.status_code == 429:
                    time.sleep(1.5 * (i + 1))
                    continue
                return None
            return j.get("result")
        except Exception:
            if i == tries - 1:
                return None
            time.sleep(1.5 * (i + 1))
    return None


def decimals(mint):
    if mint in _decimals_cache:
        return _decimals_cache[mint]
    res = rpc("getTokenSupply", [mint])
    dec = (res or {}).get("value", {}).get("decimals", 0)
    _decimals_cache[mint] = dec
    return dec


def largest_holders(mint):
    """Top-20 holders, owner-resolved. 2 credits. The cheap path."""
    largest = rpc("getTokenLargestAccounts", [mint])
    accounts = (largest or {}).get("value") or []
    if not accounts:
        return []
    infos = rpc("getMultipleAccounts",
                [[a["address"] for a in accounts], {"encoding": "jsonParsed"}])
    values = (infos or {}).get("value") or []
    out = []
    for acc, info in zip(accounts, values):
        owner = (((info or {}).get("data") or {}).get("parsed") or {}).get("info", {}).get("owner")
        amt = acc.get("uiAmount")
        if owner and amt is not None:
            out.append((owner, float(amt)))
    return out


def all_holders(mint, max_pages=MAX_DAS_PAGES):
    """Every holder of a mint via DAS getTokenAccounts. 10 credits/page, 1000/page.

    Returns owner -> total amount (an owner can hold several token accounts for one mint,
    which is exactly the dedup caveat Helius' own guide calls out)."""
    if not have_key():
        return []
    dec = decimals(mint)
    totals, cursor, pages = {}, None, 0
    while pages < max_pages:
        params = {"mint": mint, "limit": 1000}
        if cursor:
            params["cursor"] = cursor
        res = rpc("getTokenAccounts", params)
        if not res:
            break
        accounts = res.get("token_accounts") or []
        for a in accounts:
            owner, raw = a.get("owner"), a.get("amount")
            if owner and raw:
                totals[owner] = totals.get(owner, 0) + int(raw) / (10 ** dec)
        cursor = res.get("cursor")
        pages += 1
        if not cursor or not accounts:
            break
        time.sleep(DAS_SLEEP)
    return sorted(totals.items(), key=lambda kv: -kv[1])


def balance_of(owner, mint):
    """A candidate's balance of one mint. 1 credit — used to confirm, no holder scan."""
    res = rpc("getTokenAccountsByOwner", [owner, {"mint": mint}, {"encoding": "jsonParsed"}])
    total = 0.0
    for acc in (res or {}).get("value") or []:
        info = ((acc.get("account") or {}).get("data") or {}).get("parsed", {}).get("info", {})
        total += float((info.get("tokenAmount") or {}).get("uiAmount") or 0)
    return total


def swaps(address, limit=100, tx_type="SWAP", before=None):
    """Decoded transactions from the Enhanced Transactions API. 100 credits/call."""
    if not have_key():
        return []
    url = f"{ENHANCED}/addresses/{address}/transactions"
    params = {"api-key": HELIUS_KEY, "limit": min(limit, 100)}
    if tx_type:
        params["type"] = tx_type
    if before:
        params["before-signature"] = before
    try:
        r = SESSION.get(url, params=params, timeout=40)
        if not r.ok:
            return []
        data = r.json()
        return data if isinstance(data, list) else data.get("transactions", [])
    except Exception:
        return []


# ---------- resolution ----------

TOLERANCE = 0.15

# Narrow first, widen only if nothing lands — a flat 15% band catches half the top-20 of
# a popular mint and makes every single-position trader "ambiguous".
BANDS = (0.002, 0.02, 0.15)


def _within(rows, target, bands=BANDS):
    """Tightest band that yields any holder, so an exact hit beats a loose crowd."""
    for b in bands:
        hit = [(o, a) for o, a in rows if abs(a - target) / target <= b]
        if hit:
            return hit, b
    return [], None


def resolve(trader, holdings, verbose=False):
    """Find a trader's real Solana wallet from their reported Solana positions.

    `holdings` are the topHoldings entries whose networkId is Solana."""
    if not holdings:
        return {"wallet": "", "confidence": "no-sol-holdings", "matches": []}
    if not have_key():
        return {"wallet": "", "confidence": "no-helius-key", "matches": []}

    candidates = {}
    for h in holdings:
        mint, target = h.get("tokenAddress"), h.get("humanAmount") or 0
        if not mint or target <= 0:
            continue

        # Gather WIDE on purpose. Narrowing per-mint first looked more decisive but
        # broke cross-mint agreement: a trader 2.1% off on one mint and 1.0% off on
        # another is the same wallet, and a tight per-mint band throws that away.
        # Ranking below prefers agreement first, tightness second.
        rows = largest_holders(mint)                       # 2 credits
        hit, band = _within(rows, target, (TOLERANCE,))
        source = "top20"
        if not hit:                                        # fall back to the full scan
            rows = all_holders(mint)                       # 10 credits/page
            hit, band = _within(rows, target, (TOLERANCE,))
            source = "das"

        for owner, amt in hit:
            rec = candidates.setdefault(owner, {"address": owner, "matches": []})
            rec["matches"].append({"chain": "solana", "token": mint, "reported": target,
                                   "onchain": amt, "off_by": abs(amt - target) / target,
                                   "source": source, "band": band})
        if verbose:
            print(f"    solana     {mint[:12]}… target={target:,.2f} holders={len(rows)} "
                  f"via={source} band=±{band * 100 if band else '-'}% hits={len(hit)}")
        time.sleep(DAS_SLEEP)

    if not candidates:
        return {"wallet": "", "confidence": "unresolved", "matches": []}

    best = max(candidates.values(),
               key=lambda c: (len(c["matches"]), -min(m["off_by"] for m in c["matches"])))

    # confirm on the trader's other Solana mints without another holder scan
    for h in holdings:
        mint, target = h.get("tokenAddress"), h.get("humanAmount") or 0
        if not mint or target <= 0:
            continue
        if any(m["token"] == mint for m in best["matches"]):
            continue
        bal = balance_of(best["address"], mint)             # 1 credit
        if bal and abs(bal - target) / target <= TOLERANCE:
            best["matches"].append({"chain": "solana", "token": mint, "reported": target,
                                    "onchain": bal, "off_by": abs(bal - target) / target,
                                    "source": "balanceOf"})

    n = len(best["matches"])
    best_off = min(m["off_by"] for m in best["matches"])
    if n >= 2:
        confidence = "confirmed"
    else:
        rivals = sorted(min(m["off_by"] for m in c["matches"])
                        for a, c in candidates.items() if a != best["address"])
        clear = not rivals or (best_off <= 0.02 and rivals[0] > best_off * 5)
        confidence = "high-candidate" if clear else "ambiguous"

    return {"wallet": best["address"], "confidence": confidence,
            "matches": best["matches"], "best_off_by": best_off,
            "candidates_considered": len(candidates)}


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "check"

    if cmd == "check":
        print(f"HELIUS_SOLANA_KEY : {'set (' + str(len(HELIUS_KEY)) + ' chars)' if HELIUS_KEY else 'NOT SET — using public RPC'}")
        print(f"RPC endpoint : {RPC.split('api-key=')[0]}{'api-key=…' if 'api-key=' in RPC else ''}")
        slot = rpc("getSlot", [])
        print(f"getSlot      : {slot if slot else 'FAILED'}")
        # NB: not USDC — getTokenLargestAccounts returns nothing for the very largest
        # mints. Use a normal SPL token, which is what we actually query.
        mint = "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump"
        print(f"getTokenSupply.decimals       : {decimals(mint)}")
        rows = largest_holders(mint)
        print(f"getTokenLargestAccounts       : {len(rows)} owners "
              f"{'✔ (this is what the public RPC refuses)' if rows else '✘ blocked — need a Helius key'}")
        if have_key():
            das = rpc("getTokenAccounts", {"mint": mint, "limit": 5})
            n = len((das or {}).get("token_accounts") or [])
            print(f"DAS getTokenAccounts          : {n} accounts "
                  f"{'✔' if n else '✘ (DAS may not be enabled on this key)'}")

    elif cmd == "holders" and len(sys.argv) > 2:
        mint = sys.argv[2]
        print(f"top-20 holders of {mint} (decimals={decimals(mint)}):")
        for owner, amt in largest_holders(mint):
            print(f"  {owner}  {amt:,.4f}")

    elif cmd == "swaps" and len(sys.argv) > 2:
        txs = swaps(sys.argv[2])
        print(f"{len(txs)} decoded transaction(s)")
        for t in txs[:15]:
            print(f"  {t.get('type'):<14} {t.get('source'):<12} {t.get('description', '')[:90]}")

    else:
        print(__doc__)


if __name__ == "__main__":
    main()
