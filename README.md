# genie-fomo

Type a fomo trader's name → get their wallet and every EVM transfer, in the browser.

Same lookup `ether_scan1.py` does interactively, except it renders the results instead of
dropping a CSV on disk (CSV is still one click away, on whatever you've filtered down to).

## Setup

```bash
npm install
cp .env.example .env        # add your free ETHERSCAN_KEY
npm run dev                 # http://localhost:3000
```

## How a name becomes a wallet

`data/wallets.json` is the directory the app searches. Build it from the fomo leaderboard:

```bash
python3 build_directory.py --offline   # from the raw/leaderboard.json already on disk
export FOMO_TOKEN="privy-token"        # or pull a fresh leaderboard (token expires ~hourly)
python3 build_directory.py
```

The leaderboard response already carries `evmAddress` and `address` per trader, so no
per-profile calls and no token are needed once the file exists — the whole name → wallet
step is local. Set `FOMO_TOKEN` in `.env` only if you want the app to resolve handles that
aren't in the directory yet; without it those return a clean "not found".

The app falls back to reading `raw/leaderboard.json` directly if `data/wallets.json` is missing.

## Chains

| Chain | Backend | Key |
| --- | --- | --- |
| Ethereum | Etherscan V2 | `ETHERSCAN_KEY` |
| BSC | Etherscan V2 | `ETHERSCAN_KEY` |
| Base | Etherscan V2 | `ETHERSCAN_KEY` |
| Robinhood Chain | Blockscout | none |

All four are fetched in parallel; a chain that fails is reported per-chain instead of
failing the whole lookup. **BSC and Base need a paid Etherscan plan** — on the free tier
they come back as `Free API access is not supported for this chain`, which the UI shows on
the chain chip. Ethereum and Robinhood Chain work on the free key.

## Layout

```
app/page.tsx                    search + results
app/api/traders/route.ts        typeahead over the directory
app/api/trader/[handle]/route.ts  resolve name → wallet → transfers
lib/directory.ts                name → wallet (local, exact → prefix → substring)
lib/evm.ts                      transfer fetching (port of ether_scan1.py's pull_wallet)
lib/evm.client.ts               chain labels + explorer links (browser-safe)
lib/fomo.ts                     optional live profile fallback
```
