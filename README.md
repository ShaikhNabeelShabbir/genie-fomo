# genie-fomo

Type a fomo trader's name, get their wallet and every EVM transfer they've made — in the
browser, across Ethereum, BSC, Base and Robinhood Chain.

This started as `ether_scan1.py`, an interactive terminal script that asked for names, resolved
them to wallets, and dumped a CSV. The web app does the same job but renders the results:
typeahead search over a local trader directory, a profile card, and a filterable transfer table.
CSV export is still one click away — on whatever you've filtered down to, rather than everything.

---

## Table of contents

- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [The data pipeline](#the-data-pipeline)
- [Name → wallet resolution](#name--wallet-resolution)
- [Fetching transfers](#fetching-transfers)
- [The web app](#the-web-app)
- [API reference](#api-reference)
- [The Python scripts](#the-python-scripts)
- [Configuration](#configuration)
- [Known limits and gotchas](#known-limits-and-gotchas)
- [File map](#file-map)
- [Extending it](#extending-it)

---

## Quick start

```bash
npm install
cp .env.example .env               # add your free ETHERSCAN_KEY
python3 build_directory.py --offline   # build data/wallets.json from the dump on disk
npm run dev                        # http://localhost:3000
```

Three pages' worth of surface area:

| URL | What it does |
| --- | --- |
| `/` | Search a name → wallet → every transfer |
| `/traders` | The whole directory: name, EVM wallet, PnL, volume |
| `/?q=<handle>` | Deep link that runs a lookup on load |

You need Node 18+ (this was built on Node 25) and Python 3 with `requests` for the pipeline
scripts. The app itself has no Python dependency at runtime — it only reads the JSON files.

---

## How it works

```
fomo leaderboard API
        │
        │  build_directory.py            (local, needs FOMO_TOKEN — or --offline)
        ▼
raw/leaderboard.json ──► data/wallets.json      the trader directory: handle, name,
        │                        │              evm, sol, pnl, volume, holdings
        │                        │
        │                        ▼
        │               lib/directory.ts        name → wallet, no network, no token
        │                        │
        │                        ▼
        │               /api/trader/[handle]
        │                        │
        │                        ▼
        │                  lib/evm.ts           4 chains in parallel
        │                        │
        │        ┌───────────────┴───────────────┐
        │        ▼                               ▼
        │  Etherscan V2                    Blockscout
        │  (ETH / BSC / Base)              (Robinhood Chain, keyless)
        │        └───────────────┬───────────────┘
        ▼                        ▼
   fallback source          merged, sorted, rendered
```

The key insight that shapes the whole design: **the leaderboard response already contains every
trader's wallet.** Each entry carries `evmAddress` and `address` (Solana) alongside the display
name. So once `data/wallets.json` exists, the entire name → wallet step is a local lookup — no
fomo API call, no auth token, nothing that expires. The token is only needed to *refresh* the
directory, and only on your machine.

---

## The data pipeline

### The leaderboard shape

`GET https://prod-api.fomo.family/v2/leaderboard/30d` returns:

```jsonc
{
  "success": true,
  "message": "...",
  "statusCode": 200,
  "responseObject": {
    "leaderboard": [
      {
        "id": "0c15c8b8-…",
        "userHandle": "Rvcoobass",
        "displayName": "Rvcoobass",
        "evmAddress": "0x124039e67aad0ca37e1423250330a9ba63d56658",
        "address": "HYZqEC6avfGP1cRnHL6GunSiQZjQzvsPG8cV8LNE3mUj",  // Solana
        "pnl30d": 95577723.46,
        "totalVolume": 41.36,
        "numTrades": 2,
        "swapCount": 3,
        "followers": 63,
        "description": null,
        "profilePictureLink": null,
        "verified": false,
        "topHoldings": [ { "tokenAddress": "0x…", "value": 2669119.99, "pnl": 2647913.65 } ]
      }
      // … 150 entries
    ]
  }
}
```

Note the nesting — `responseObject.leaderboard`, not a bare array — and `userHandle` rather than
`handle`. Both tripped up the original parser.

### Building the directory

```bash
# refresh from the live API (token expires ~hourly)
export FOMO_TOKEN="your_privy_token"
python3 build_directory.py

# or rebuild from the leaderboard dump already on disk — no token, no network
python3 build_directory.py --offline
```

`build_directory.py` writes two things:

- `raw/leaderboard.json` — the untouched API response, kept for debugging and for `--offline`
- `data/wallets.json` — the normalized directory the app actually reads

```jsonc
{
  "window": "30d",
  "generated_at": 1788015741,
  "traders": [
    {
      "rank": 1, "handle": "Rvcoobass", "name": "Rvcoobass",
      "evm": "0x1240…6658", "sol": "HYZqEC…3mUj",
      "pnl": 95577723.46, "volume": 41.36, "trades": 2, "followers": 63,
      "avatar": "", "bio": "", "twitter": "", "verified": false,
      "holdings": [ … ]
    }
  ]
}
```

Because the wallets come straight off the leaderboard, the script makes **one** HTTP request for
150 traders. It only falls back to a per-trader `users/userHandle/{h}` profile call when an entry
somehow has neither address — and then dumps the first such profile to `raw/profile_<handle>.json`
so the extraction can be fixed against a real payload.

`find_addresses()` walks an arbitrary profile object looking for key names containing `evm`/`eth`
(matching a 42-char `0x…`) or `sol` (32–44 chars, no `0x` prefix). That heuristic is the fallback
path only; the fast path reads the fields by name.

### Getting a FOMO_TOKEN

It's the `privy-token` cookie from a logged-in fomo.family session — DevTools → Application →
Cookies. It expires roughly hourly, which is exactly why the directory is cached to disk rather
than resolved live.

Send it as `Authorization: Bearer <token>`, **not** as a `Cookie` header. The cookie form pushes
the request headers over the server's limit and comes back `431 Request Header Fields Too Large`.
Both `build_directory.py` and `lib/fomo.ts` try Bearer first and only fall back to the cookie.

---

## Name → wallet resolution

`lib/directory.ts` resolves in this order:

1. **A `0x…` address** (40 hex chars) is used directly — and matched against the directory in case
   it belongs to a known trader.
2. **Exact match** on handle or display name, case-insensitive, leading `@` stripped.
3. **Prefix match** — first trader whose handle or name starts with the query.
4. **Substring match** — first trader containing the query anywhere.
5. **Live fomo profile** via `lib/fomo.ts`, only if `FOMO_TOKEN` is set. Without a token this
   step is skipped silently and the API returns a clean 404 rather than an auth error.

The typeahead (`/api/traders`) uses the same tiers as a sort key — exact matches rank above
prefix, prefix above substring, ties broken by leaderboard rank.

If `data/wallets.json` is missing, `lib/directory.ts` falls back to parsing `raw/leaderboard.json`
directly, so a fresh clone works before you've run anything.

---

## Fetching transfers

`lib/evm.ts` is a TypeScript port of `ether_scan1.py`'s `pull_wallet`.

| Chain | Backend | Endpoint | Key |
| --- | --- | --- | --- |
| Ethereum | Etherscan V2 | `api.etherscan.io/v2/api?chainid=1` | `ETHERSCAN_KEY` |
| BSC | Etherscan V2 | `chainid=56` | `ETHERSCAN_KEY` (paid) |
| Base | Etherscan V2 | `chainid=8453` | `ETHERSCAN_KEY` (paid) |
| Robinhood Chain | Blockscout | `robinhoodchain.blockscout.com/api/v2` | none |

All four run **in parallel**, and each one's failure is isolated — a dead chain reports its own
error on its own chip instead of failing the lookup. The response carries a per-chain summary:

```jsonc
"chains": [
  { "chain": "ethereum", "count": 8,  "error": null },
  { "chain": "bsc",      "count": 0,  "error": "Free API access is not supported for this chain…" },
  { "chain": "base",     "count": 0,  "error": "Free API access is not supported for this chain…" },
  { "chain": "robinhood","count": 50, "error": null }
]
```

Details worth knowing:

- **Etherscan error reporting is inside the payload, not the status code.** A key or plan problem
  comes back HTTP 200 with `result` as a *string*. The code treats a string `result` as an error —
  except `"No transactions found"`, which is an empty result, not a failure.
- **Blockscout field names.** The current API names the token contract `address_hash`, not
  `address`, and puts authoritative decimals on `total.decimals`. `ether_scan1.py` reads
  `token["address"]`, which is why the `contract` column is blank for Robinhood rows in
  `fomo_evm_trades.csv`. The app reads both spellings.
- **Blockscout pagination.** It returns ~50 items and a `next_page_params` cursor. The app follows
  the cursor up to 10 pages or the requested limit, whichever comes first. The Python script only
  ever read page one.
- **Amounts** are scaled from the raw integer via `BigInt` before the final divide, so large
  meme-coin balances don't lose precision on the way in.
- **Retries**: 3 attempts, exponential backoff, with a dedicated backoff on HTTP 429. 25s timeout
  per request.

Results from all chains are merged and sorted newest-first.

---

## The web app

Next.js 15 (App Router) + React 19 + Tailwind CSS v4, TypeScript throughout.

### `/` — lookup

A client component holding the search/result state.

- `components/SearchBar.tsx` — debounced typeahead (120ms) against `/api/traders`, full keyboard
  navigation (↑/↓/Enter/Escape), click-outside to dismiss. Accepts a name, `@handle` or raw `0x…`.
- `components/TraderCard.tsx` — avatar, display name, verification mark, leaderboard rank, bio,
  click-to-copy EVM and Solana addresses, four stat tiles (30d PnL, volume, trades, followers),
  and the top three holdings with per-token value and PnL.
- `components/TransfersTable.tsx` — the transfer list. Filter by chain, by direction (in/out), by
  token symbol; paginated at 60 rows with "show more"; every hash links to the right block
  explorer for its chain; `↓ CSV` exports the current filtered view.

On mount it reads `?q=` from the URL, seeds the search box and runs the lookup — that's how
`/traders` hands a trader over.

Before any search runs, the page shows the top six of the leaderboard as one-click shortcuts.

### `/traders` — directory

A **server** component: it reads `data/wallets.json` on the server via `lib/directory.ts` and
passes the array straight to `components/TraderList.tsx`, so there's no API round-trip for the
listing. Shows rank, avatar, name/handle, EVM wallet (click to copy), 30d PnL and volume with
trade count. Filter matches name, handle *or* address; sort by rank / pnl / volume / name; 50 rows
at a time. Each row's **Scan →** links to `/?q=<handle>`.

The header line — trader count, how many have an EVM wallet, combined PnL — is computed on the
server from the file, so it always reflects the last `build_directory.py` run.

### Styling

Tailwind v4, configured entirely in CSS. `app/globals.css` defines the palette as `@theme`
tokens — `ink` (page), `panel` (cards), `edge` (borders), `mute` (secondary text), `glow`
(accent), `up`/`down` (green/red) — which Tailwind turns into utilities like `bg-panel`,
`border-edge`, `text-up`. There is no `tailwind.config.js`; `postcss.config.mjs` loads
`@tailwindcss/postcss` and that's the whole setup.

---

## API reference

### `GET /api/traders`

Typeahead / directory search.

| Param | Default | Notes |
| --- | --- | --- |
| `q` | — | Name, handle or address. Empty returns the top of the leaderboard. |
| `limit` | 8 | Capped at 50. |

```jsonc
{
  "total": 150,
  "results": [
    { "rank": 1, "handle": "Rvcoobass", "name": "Rvcoobass",
      "evm": "0x1240…6658", "pnl": 95577723.46, "avatar": "", "verified": false }
  ]
}
```

### `GET /api/trader/[handle]`

Resolve a name (or address) and pull every transfer. `handle` may be a name, `@handle`, or a
`0x…` address. `maxDuration` is 60s.

| Param | Default | Notes |
| --- | --- | --- |
| `limit` | 300 | Per chain. Capped at 1000. |

```jsonc
{
  "trader": { "rank": 44, "handle": "unipcs", "name": "Unipcs",
              "evm": "0x2ac082e2…711c", "sol": "FJDy9FDRy6bw…Z7Q1",
              "pnl": 3073576.99, "volume": 1274680.22, "trades": 1765, "followers": 303502,
              "avatar": "https://…", "bio": "…", "twitter": "", "verified": false,
              "holdings": [ … ] },
  "query": "unipcs",
  "wallet": "0x2ac082e252143c89c6e3bcb972e49855f9f6711c",
  "resolvedVia": "directory",          // "directory" | "address" | "fomo-api"
  "chains": [ { "chain": "ethereum", "count": 8, "error": null }, … ],
  "transfers": [
    { "handle": "unipcs", "wallet": "0x…", "chain": "robinhood",
      "tx_hash": "0x0913…", "time": 1788013487, "token": "ROKU",
      "contract": "0x2c40…", "amount": 87.70277735958747,
      "side": "in", "from": "0x3eCb…", "to": "0x0a6E…" }
  ],
  "pulledAt": "2026-08-29T20:14:02.000Z"
}
```

Errors: **400** empty query, **404** no EVM wallet found for that name.

`trader` is `null` when you look up a raw address that isn't in the directory — the transfer list
still comes back in full.

---

## The Python scripts

Both still work and are still the right tool for some jobs.

### `ether_scan1.py`

Interactive terminal lookup. Prompts for comma-separated names/addresses, resolves each, prints a
per-trader table, and writes `fomo_evm_trades.csv`.

```bash
export ETHERSCAN_KEY="your_free_key"
export FOMO_TOKEN="your_privy_token"   # only for name→wallet
python3 ether_scan1.py
```

Use it for scripting and batch pulls — it takes many traders at once and produces one combined
CSV, which the web app doesn't do. Note its `KNOWN_WALLETS` dict is a hardcoded override that the
app does not share (see gotchas).

### `build_directory.py`

The pipeline described above. Environment: `FOMO_TOKEN`, `WINDOW` (default `30d`), `TOP_N`
(default `150`). `--offline` rebuilds from `raw/leaderboard.json` without a token.

**These scripts read the shell environment, not `.env`.** `.env` is loaded by Next.js only, so
the app and the scripts are configured separately — `export` for Python, `.env` for the app.

---

## Configuration

| Variable | Used by | Required | Notes |
| --- | --- | --- | --- |
| `ETHERSCAN_KEY` | app, `ether_scan1.py` | For EVM chains | Free key from etherscan.io. One key covers all Etherscan V2 chains. Without it, Ethereum/BSC/Base each report `ETHERSCAN_KEY is not set`; Robinhood Chain still works. |
| `FOMO_TOKEN` | `build_directory.py`, `ether_scan1.py`, app (optional) | No | Only refreshes the directory or resolves handles missing from it. Expires ~hourly. |
| `WINDOW` | `build_directory.py` | No | `24h` \| `7d` \| `30d`. Default `30d`. |
| `TOP_N` | `build_directory.py` | No | How many leaderboard entries to keep. Default 150. |

`.gitignore` covers `.env`, `node_modules/`, `.next/`, `raw/profile_*.json` and `.DS_Store`.
`data/wallets.json` and `raw/leaderboard.json` are **not** ignored — they're the shipped cache,
and they contain only public leaderboard data, never the token.

---

## Known limits and gotchas

**BSC and Base need a paid Etherscan plan.** On the free tier both return
`Free API access is not supported for this chain`. This is an account limit, not a bug, and it
applies to `ether_scan1.py` identically — which is why the existing `fomo_evm_trades.csv` contains
only `ethereum` and `robinhood` rows. Ethereum and Robinhood Chain work fine on a free key.

**The directory is cached in memory for the life of the server process.** `lib/directory.ts` reads
`data/wallets.json` once and holds it. After re-running `build_directory.py`, restart the dev
server to see the new data. If that becomes annoying, invalidate on file mtime.

**`ether_scan1.py`'s `KNOWN_WALLETS` disagrees with the leaderboard.** It hardcodes
`unipcs → 0x0a6ebed0…119e`, while the leaderboard's `evmAddress` for unipcs is
`0x2ac082e2…711c`. Both are live wallets — the first has Ethereum *and* Robinhood activity, the
second Robinhood only. The app follows the leaderboard. If the hardcoded one is the correct
primary wallet, that override needs to move into the directory.

**Some PnL figures are implausible at the source.** The top entry can show tens of millions in
30d PnL against ~$40 of volume across 2 trades. Those are fomo's own `pnl30d` / `totalVolume`
values passed through unchanged — worth knowing before quoting them.

**Solana is display-only.** Solana addresses are surfaced and copyable, but no transfers are
fetched for them. Only EVM chains are scanned.

**Don't run `npm run build` while `npm run dev` is live.** The production build overwrites `.next`
underneath the dev server and every route starts 500ing. Fix: stop dev, `rm -rf .next`, restart.

**Transfer counts are bounded.** Every chain honours the `limit` param — 300 per chain by
default, 1000 max. Blockscout additionally stops after 10 pages, whichever comes first. Etherscan
is a single request of `limit` rows.

---

## File map

```
app/
  layout.tsx                     root layout + metadata
  globals.css                    Tailwind v4 import and @theme palette
  page.tsx                       / — search + results, reads ?q= on load
  traders/page.tsx               /traders — server-rendered directory
  api/traders/route.ts           typeahead search over the directory
  api/trader/[handle]/route.ts   resolve name → wallet → transfers

components/
  SearchBar.tsx                  debounced typeahead, keyboard nav
  TraderCard.tsx                 profile header, stats, holdings, copyable wallets
  TransfersTable.tsx             filters, explorer links, CSV export
  TraderList.tsx                 directory table with filter + sort

lib/
  directory.ts                   loads wallets.json, name → wallet matching  (server)
  evm.ts                         transfer fetching, port of pull_wallet      (server)
  evm.client.ts                  chain labels + explorer URLs                (browser-safe)
  fomo.ts                        optional live profile fallback              (server)
  format.ts                      usd / compact / amount / address / time helpers
  types.ts                       Trader, Transfer, ChainResult, LookupResult

build_directory.py               leaderboard → data/wallets.json
ether_scan1.py                   interactive terminal lookup → CSV
data/wallets.json                the trader directory (generated)
raw/leaderboard.json             untouched API response (generated, also the offline source)
fomo_evm_trades.csv              sample output from ether_scan1.py
```

`lib/evm.client.ts` exists so `TransfersTable` can import chain labels and explorer URLs without
pulling the server-side fetching code into the browser bundle.

---

## Extending it

**Add an EVM chain.** Add an entry to `CHAINS` in `lib/evm.client.ts` — `etherscan_v2` with a
`chainId`, or `blockscout` with a `host` — plus its `label` and `explorer`. Add the key to
`ChainKey` in `lib/types.ts`. `lib/evm.ts` picks it up from the config; nothing else changes.

**Add Solana transfers.** Every trader's Solana address is already in the directory as `sol`. It
needs a new backend in `lib/evm.ts` (Helius or Solscan) emitting the same `Transfer` shape, and a
`ChainKey` entry. The table and CSV export work unchanged from there.

**Keep the directory fresh.** `build_directory.py` on a cron — daily, or before a demo. The
leaderboard reshuffles constantly, so ranks and PnL go stale fast. Remember to restart the app.

**Deploy.** It's a stock Next.js app. Set `ETHERSCAN_KEY` in the host's environment and commit
`data/wallets.json` so the directory ships with the build. The `/api/trader/[handle]` route can
take several seconds across four chains — `maxDuration` is set to 60s, which serverless hosts
respect but some plans cap lower.
