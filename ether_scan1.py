#!/usr/bin/env python3
"""
ether_scan1.py  —  interactive EVM lookup (free). Bearer-auth fix for the 431.

Type trader names and/or wallet addresses -> prints each one's EVM trades and writes a CSV.
EVM only: Ethereum / BSC / Base (Etherscan V2 free) + Robinhood Chain (Blockscout, no key).

NAME -> WALLET needs FOMO_TOKEN (your privy-token). This build sends it as
Authorization: Bearer (avoids the "431 Request Header Fields Too Large" the cookie hit),
and only falls back to a cookie if Bearer is refused.

SETUP
  pip install requests
  export ETHERSCAN_KEY="your_free_key"
  export FOMO_TOKEN="your_privy_token"     # optional; only for name->wallet. Expires ~hourly.
  python3 ether_scan1.py
"""

import os, csv, time, datetime as dt
import requests

ETHERSCAN_KEY = os.environ.get("ETHERSCAN_KEY", "")
# strip whitespace/newlines in case the long JWT wrapped when pasted
FOMO_TOKEN    = os.environ.get("FOMO_TOKEN", "").strip().replace("\n", "").replace("\r", "").replace(" ", "")
OUT_CSV  = "fomo_evm_trades.csv"
TX_LIMIT = 300

KNOWN_WALLETS = {
    "unipcs": "0x0a6ebed0155edb4b21d92ad02897a626cd90119e",
}

EVM_CHAINS = {
    "ethereum": {"backend": "etherscan_v2", "chainid": 1},
    "bsc":      {"backend": "etherscan_v2", "chainid": 56},
    "base":     {"backend": "etherscan_v2", "chainid": 8453},
    "robinhood":{"backend": "blockscout", "host": "https://robinhoodchain.blockscout.com"},
}
BROWSER_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"),
    "Accept": "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9"}

SESSION = requests.Session()
SLEEP = 0.25


def _get(url, params=None, headers=None, tries=4):
    for i in range(tries):
        try:
            r = SESSION.get(url, params=params, headers=headers, timeout=30)
            if r.status_code == 429: time.sleep(2 ** i); continue
            r.raise_for_status(); return r.json()
        except Exception as e:
            if i == tries - 1: print(f"  ! {url} -> {e}"); return None
            time.sleep(2 ** i)
    return None


def _human_time(t):
    try: return dt.datetime.utcfromtimestamp(int(t)).strftime("%Y-%m-%d %H:%M")
    except Exception: return str(t or "")


# ---------- name -> wallet ----------
def _fomo_profile(name):
    """Fetch a fomo profile. Tries Bearer first (dodges the cookie 431), then cookie.
    Uses a fresh request each call so no session cookies accumulate into the header."""
    if not FOMO_TOKEN:
        return None
    url = f"https://prod-api.fomo.family/v2/users/userHandle/{name}"
    base = {"User-Agent": BROWSER_HEADERS["User-Agent"], "Accept": "application/json"}
    attempts = [("bearer", {**base, "Authorization": f"Bearer {FOMO_TOKEN}"}),
                ("cookie", {**base, "Cookie": f"privy-token={FOMO_TOKEN}"})]
    for mode, hdr in attempts:
        try:
            r = requests.get(url, headers=hdr, timeout=30)
        except Exception as e:
            print(f"  [FOMO] {mode} error: {e}"); continue
        if r.status_code == 431:
            print(f"  [FOMO] {mode}: 431 header too large — trying next method"); continue
        if r.status_code in (401, 403):
            print(f"  [FOMO] {mode}: {r.status_code} (token rejected/expired) — trying next method"); continue
        if r.ok:
            try: return r.json()
            except Exception: return None
        print(f"  [FOMO] {mode}: HTTP {r.status_code}")
    return None


def resolve_name(name):
    key = name.lower().lstrip("@")
    if key in KNOWN_WALLETS:
        return KNOWN_WALLETS[key], "known-list"
    data = _fomo_profile(name)
    if data:
        evm = ""
        def walk(o):
            nonlocal evm
            if isinstance(o, dict):
                for k, v in o.items():
                    if isinstance(v, str) and v.startswith("0x") and len(v) == 42 and \
                       ("evm" in k.lower() or "eth" in k.lower()): evm = v.lower()
                    walk(v)
            elif isinstance(o, list):
                for v in o: walk(v)
        walk(data)
        if evm:
            KNOWN_WALLETS[key] = evm
            return evm, "fomo-profile"
        print(f"  [FOMO] profile fetched but no evm address field found — send me raw/profile_{name}.json")
    return None, None


# ---------- trades ----------
def pull_wallet(handle, address):
    rows = []
    for chain, cfg in EVM_CHAINS.items():
        n = 0
        if cfg["backend"] == "etherscan_v2":
            d = _get("https://api.etherscan.io/v2/api", params={
                "chainid": cfg["chainid"], "module": "account", "action": "tokentx",
                "address": address, "startblock": 0, "endblock": 99999999,
                "page": 1, "offset": TX_LIMIT, "sort": "desc", "apikey": ETHERSCAN_KEY})
            for t in (d.get("result") if isinstance(d, dict) else []) or []:
                if not isinstance(t, dict): continue
                try: amt = int(t.get("value", "0")) / (10 ** int(t.get("tokenDecimal") or 0))
                except Exception: amt = t.get("value")
                rows.append({"handle": handle, "wallet": address, "chain": chain,
                    "tx_hash": t.get("hash"), "time": t.get("timeStamp"), "token": t.get("tokenSymbol"),
                    "contract": t.get("contractAddress"), "amount": amt,
                    "side": "in" if (t.get("to","").lower()==address.lower()) else "out",
                    "from": t.get("from"), "to": t.get("to")}); n += 1
        else:
            d = _get(f'{cfg["host"]}/api/v2/addresses/{address}/token-transfers', headers=BROWSER_HEADERS)
            for t in (d.get("items") if isinstance(d, dict) else []) or []:
                tok = t.get("token") or {}
                try: amt = int((t.get("total") or {}).get("value")) / (10 ** int(tok.get("decimals") or 0))
                except Exception: amt = (t.get("total") or {}).get("value")
                frm = (t.get("from") or {}).get("hash", ""); to = (t.get("to") or {}).get("hash", "")
                rows.append({"handle": handle, "wallet": address, "chain": chain,
                    "tx_hash": t.get("tx_hash") or t.get("transaction_hash"), "time": t.get("timestamp"),
                    "token": tok.get("symbol"), "contract": tok.get("address"), "amount": amt,
                    "side": "in" if to.lower()==address.lower() else "out", "from": frm, "to": to}); n += 1
        print(f"    {chain}: {n}")
        time.sleep(SLEEP)
    return rows


def print_table(rows):
    by = {}
    for r in rows: by.setdefault(r["handle"], []).append(r)
    for handle, rs in by.items():
        print("\n" + "=" * 74)
        print(f"{handle}   {rs[0]['wallet']}")
        print(f"  {'chain':<9} {'time':<17} {'side':<4} {'amount':<18} token")
        print("  " + "-" * 70)
        for r in rs[:60]:
            print(f"  {r['chain']:<9} {_human_time(r['time']):<17} {r['side']:<4} "
                  f"{str(r['amount'])[:18]:<18} {r.get('token') or ''}")
        if len(rs) > 60: print(f"  … +{len(rs)-60} more (in CSV)")


def prompt_targets():
    print("\nEnter trader names and/or EVM wallet addresses, comma-separated:")
    print("(e.g.  unipcs, AJC, 0x0a6e...)")
    return [x.strip() for x in input("> ").strip().split(",") if x.strip()]


def main():
    if not ETHERSCAN_KEY:
        print("Set ETHERSCAN_KEY (free tier from etherscan.io) and rerun."); return
    if FOMO_TOKEN:
        print(f"(FOMO_TOKEN loaded, {len(FOMO_TOKEN)} chars)")
    targets = prompt_targets()
    if not targets:
        print("Nothing entered."); return

    resolved = []
    for it in targets:
        if it.lower().startswith("0x") and len(it) == 42:
            resolved.append((it[:8] + "…", it.lower()))
        else:
            addr, how = resolve_name(it)
            if addr:
                print(f"  {it} -> {addr}  ({how})")
                resolved.append((it, addr))
            else:
                print(f"  {it}: UNRESOLVED — set/refresh FOMO_TOKEN, or paste the wallet address.")

    all_rows = []
    for handle, addr in resolved:
        print(f"\n[{handle}] {addr}")
        all_rows += pull_wallet(handle, addr)

    if not all_rows:
        print("\nNo trades found (or nothing resolved)."); return

    cols = ["handle","wallet","chain","tx_hash","time","token","contract","amount","side","from","to","pulled_at"]
    ts = dt.datetime.utcnow().isoformat(timespec="seconds") + "Z"
    for r in all_rows: r["pulled_at"] = ts
    with open(OUT_CSV, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows(all_rows)
    print_table(all_rows)
    print(f"\nwrote {len(all_rows)} transfers -> {OUT_CSV}")


if __name__ == "__main__":
    main()