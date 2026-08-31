#!/usr/bin/env python3
"""
bitquery.py  —  EVM holder lookups across all four chains fomo traders use.

WHY BITQUERY REPLACED BLOCKSCOUT
  The first resolver paged Blockscout's top-100 holder list and amount-matched. That
  only finds whales: a trader holding 5,065 tokens of a coin whose 100th-largest holder
  has 1,606,327 is thousands of pages deep. It resolved 79/150.

  Bitquery filters by balance range SERVER-SIDE, so position size stops mattering:

      Balance: {Amount: {ge: "5000", le: "5130"}}
      -> 0x38e636a6…  5065.833841428987149899   vs fomo's 5065.833841428987

  Exact to twelve decimals, on a position that was invisible to the old method. It also
  covers BSC, which has no free holder list at all (Etherscan's is a $199 Pro endpoint
  and Blockscout has no BSC instance).

PLAN NOTE
  This key is limited to the `realtime` dataset — asking for `combined` or `archive`
  returns 403. Realtime carries current balances, which is all resolution needs.

USAGE
  export BITQUERY_KEY=...            # or put it in .env
  python3 bitquery.py check
  python3 bitquery.py holders robinhood 0x39dbed3a2bd333467115de45665cc57f813c4571
  python3 bitquery.py find robinhood 0x39dbed... 10957270.21
"""

import json
import os
import pathlib
import sys
import time

import requests

URL = "https://streaming.bitquery.io/graphql"
DATASET = "realtime"

# fomo's networkId -> Bitquery network name
NETWORKS = {4663: "robinhood", 1: "eth", 56: "bsc", 8453: "base"}

SLEEP = 0.35
SESSION = requests.Session()
_cache = {}


def _load_key():
    key = os.environ.get("BITQUERY_KEY", "").strip()
    if key:
        return key
    env = pathlib.Path(".env")
    if env.exists():
        for line in env.read_text().splitlines():
            line = line.strip()
            if line.startswith("BITQUERY_KEY=") and not line.startswith("#"):
                return line.split("=", 1)[1].strip()
    return ""


BITQUERY_KEY = _load_key()


def have_key():
    return bool(BITQUERY_KEY)


def gql(query, tries=3):
    """POST a GraphQL query. Returns `data`, or None on error."""
    if not have_key():
        return None
    for i in range(tries):
        try:
            r = SESSION.post(URL, headers={"Content-Type": "application/json",
                                           "Authorization": f"Bearer {BITQUERY_KEY}"},
                             json={"query": query}, timeout=60)
            if r.status_code == 429:
                time.sleep(2 ** i)
                continue
            j = r.json()
            if j.get("errors"):
                msg = json.dumps(j["errors"])[:200]
                if "rate" in msg.lower() or "limit" in msg.lower():
                    time.sleep(2 ** i)
                    continue
                return {"__error__": msg}
            return j.get("data")
        except Exception:
            if i == tries - 1:
                return None
            time.sleep(1.5 * (i + 1))
    return None


def holders_in_range(network, contract, lo, hi, limit=30):
    """Holders of `contract` whose balance sits in [lo, hi]. The whole trick.

    Returns [(address, amount)] sorted by balance descending."""
    key = (network, contract.lower(), f"{lo:.6f}", f"{hi:.6f}", limit)
    if key in _cache:
        return _cache[key]

    query = """{
      EVM(network: %s, dataset: %s) {
        Holders(
          where: {
            Currency: {SmartContract: {is: "%s"}}
            Balance: {Amount: {ge: "%.6f", le: "%.6f"}}
          }
          orderBy: {descending: Balance_Amount}
          limit: {count: %d}
        ) {
          Holder { Address }
          Balance { Amount }
        }
      }
    }""" % (network, DATASET, contract, lo, hi, limit)

    data = gql(query)
    rows = []
    if isinstance(data, dict) and "__error__" not in data:
        for h in ((data.get("EVM") or {}).get("Holders") or []):
            try:
                rows.append((h["Holder"]["Address"], float(h["Balance"]["Amount"])))
            except (KeyError, TypeError, ValueError):
                continue
    _cache[key] = rows
    time.sleep(SLEEP)
    return rows


def top_holders(network, contract, limit=10):
    query = """{
      EVM(network: %s, dataset: %s) {
        Holders(
          where: {Currency: {SmartContract: {is: "%s"}}}
          orderBy: {descending: Balance_Amount}
          limit: {count: %d}
        ) { Holder { Address } Balance { Amount } }
      }
    }""" % (network, DATASET, contract, limit)
    data = gql(query)
    if not isinstance(data, dict) or "__error__" in data:
        return []
    return [(h["Holder"]["Address"], float(h["Balance"]["Amount"]))
            for h in ((data.get("EVM") or {}).get("Holders") or [])]


BURN = {"0x0000000000000000000000000000000000000000",
        "0x000000000000000000000000000000000000dead"}


def find_holder(network, contract, target, bands=(0.002, 0.02, 0.15)):
    """Find who holds ~`target` of `contract`, widening the search band as needed.

    Tight first: an exact or near-exact hit is unambiguous. Only widen when nothing
    lands, because a wide band on a popular round number returns many holders."""
    for band in bands:
        lo, hi = target * (1 - band), target * (1 + band)
        rows = [(a, amt) for a, amt in holders_in_range(network, contract, lo, hi)
                if a.lower() not in BURN]
        if rows:
            rows.sort(key=lambda r: abs(r[1] - target))
            return rows, band
    return [], None


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "check"

    if cmd == "check":
        print(f"BITQUERY_KEY : {'set (' + str(len(BITQUERY_KEY)) + ' chars)' if have_key() else 'NOT SET'}")
        print(f"endpoint     : {URL}   dataset: {DATASET}")
        rows = top_holders("robinhood", "0x39dbed3a2bd333467115de45665cc57f813c4571", 3)
        print(f"robinhood    : {len(rows)} holders {'OK' if rows else 'FAILED'}")
        for a, amt in rows:
            print(f"   {a}  {amt:,.4f}")
        for net, token in (("eth", "0xdac17f958d2ee523a2206206994597c13d831ec7"),
                           ("bsc", "0xfe189e97832da1573e4e4ff034f4ffc3a15c7777"),
                           ("base", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")):
            r = top_holders(net, token, 1)
            print(f"{net:<13}: {'OK' if r else 'FAILED'}")

    elif cmd == "holders" and len(sys.argv) > 3:
        for a, amt in top_holders(sys.argv[2], sys.argv[3], 20):
            print(f"  {a}  {amt:,.6f}")

    elif cmd == "find" and len(sys.argv) > 4:
        target = float(sys.argv[4])
        rows, band = find_holder(sys.argv[2], sys.argv[3], target)
        print(f"target {target:,.6f}  band ±{band * 100 if band else '-'}%")
        for a, amt in rows[:10]:
            print(f"  {a}  {amt:,.6f}   off {abs(amt - target) / target * 100:.6f}%")

    else:
        print(__doc__)


if __name__ == "__main__":
    main()
