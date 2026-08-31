# genie-fomo — Project Context & Handoff

> A complete record of the design conversation behind this project, plus the
> **confirmed technical facts** (endpoints, auth, response shapes, chains, pricing)
> discovered along the way. Written so a fresh agent (Claude Code) or teammate can
> pick up with full context. Facts marked ✅ were verified live during the session;
> ⚠️ marks assumptions or things still to confirm.

---

## TL;DR (read this first)

**Goal:** Given the top traders on **fomo.family**'s leaderboard, resolve each one to
their on-chain wallet(s) (Solana + EVM), pull their trade history across chains, and
present it — as a CSV/table and, ultimately, a small Next.js app for an internal team demo.

**Where we landed:**

- **Resolution is solved and free.** fomo.family's leaderboard API returns each trader's
  handle **and both wallet addresses and their positions** in a single call. No paid
  resolver, no fingerprinting needed. (We spent a lot of the session not knowing this.)
- **Trades are free on every chain we need**: ETH/BSC/Base via Etherscan V2 (free key),
  Robinhood Chain via Blockscout (no key), Solana via public RPC (free) or Helius (free tier).
- **The one credential that isn't free-and-clean:** reading fomo's own API needs *your
  logged-in session token* (a Privy JWT, expires ~hourly). That's fine for a local script /
  internal tool; it is **not** safe to ship in a public app. The clean public alternative is
  the paid fomoscan API.
- **Architecture chosen:** a local Python script uses your token *once* to build a cached
  `wallets.json` (token never leaves your machine); the Next.js app reads that cache and
  fetches trades live with free explorer keys stored server-side.

**What's built:** `build_directory.py` (leaderboard → `wallets.json`), plus a Next.js +
Tailwind app (`genie-fomo`) with a `/api/trades` route and a search UI. Several standalone
CLI scripts also exist (see [Deliverables](#deliverables)).

**Immediate TODO:** the leaderboard JSON shape is now **confirmed** (see below) — the shipped
`build_directory.py` parser used *guessed* field names and needs updating to the real ones.
That's the one change blocking a clean run.

---

## The platforms involved

| Platform | Role | Access | Cost |
|---|---|---|---|
| **fomo.family** | Cross-chain social copy-trading app; source of the leaderboard + trader profiles/positions | Private API, needs your logged-in Privy session | "free" but ToS-exposed / token-gated |
| **fomoscan.sh** | 3rd-party index; resolves a fomo handle → verified sol+evm wallet in one call | Public API, Bearer key | **Paid** (~$79/mo Starter) ⚠️ |
| **terminal.fomoscan.sh** | fomo copy-trading terminal (UI showed wallets during recon) | Web UI | free to view |
| **Etherscan V2** | EVM trades for ETH / BSC / Base (one key, `chainid` switch) | API key | **Free tier** works (community endpoints) ✅ |
| **Robinhood Chain Blockscout** | EVM explorer for Robinhood Chain (chainid 4663) | REST API, no key | Free ✅ |
| **Solana public RPC** | Solana tx history + holders | JSON-RPC, no key | Free (slow, rate-limited) ✅ |
| **Helius** | Faster Solana RPC + decoded swaps (Enhanced API) + token metadata (DAS) + webhooks | API key | **Free tier**: 1M credits/mo, 10 RPS (2 RPS on Enhanced/DAS) ⚠️ pricing mid-2026 |
| **Solscan Pro** | Decoded Solana activity + full holder lists | API key | **Paid** (from ~$32/mo) ⚠️ |
| ~~robinscan.io~~ | **NOT the official Robinhood explorer.** Multiple copycat domains exist; security writeups flag branded "Robinscan" as unverified/possible signature-harvesters. **Use Blockscout instead.** | — | avoid |

---

## The manual flow (the exact process we're automating)

This is the end-to-end process demonstrated by hand (with screenshots) and confirmed to
work. **This is the target behaviour** — the scripts/app automate exactly these steps. Read
this to understand *what* the pipeline reproduces; the API reference below is *how*.

Worked example throughout: trader **`unipcs`** (leaderboard #1 during testing).

### Step 1 — Leaderboard → pick the window → note the top traders
On **fomo.family**, open the **Leaderboard** and select the time window (**7D** or **30D**).
Read off the top traders — each shows a display name, `@handle`, and PnL (e.g. Unipcs
`@unipcs` +$1.1M; AJC `@AvgJoesCrypto`; cosby `@cosby`; Eagle_0X; DumbCrayonEater; …).
> Note: the **handle** (grey `@name`) is what the API needs, not the bold **display name**.
> The profile URL is the source of truth: `fomo.family/profile/DumbCrayonEater` → handle is
> `DumbCrayonEater`. (Typing a display name like "AJC" into the API 404s; the handle is
> `AvgJoesCrypto`.)

### Step 2 — Open a trader's profile → read their positions + contracts
Go to `fomo.family/profile/<handle>`. The **Positions** panel lists each token the trader
holds with the amount, and hovering a token shows a tooltip with **Market Cap, 24h Volume,
Holders, Top-10 %, and the token's Contract address**. Record, per token: symbol, amount,
contract, and which **chain** it's on. For `unipcs` this included:
- **PONS** — 10.9M — contract `0x39dbed3a2bd333467115de45665cc57f813c4571` — Robinhood Chain (EVM)
- **BOW** — 25.5M — contract `0x451b42a15100c340ca12f7c66de06fac5ea2d751` — Robinhood Chain (EVM)
- **USELESS** — 15.1M — mint `Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk` — Solana
- **KORI** — 14M — mint `HtTYHz1Kf3rrQo6AqDLmss7gq5WrkWAaXn3tupUZbonk` — Solana
> The profile does **not** display the trader's own wallet address — only token contracts.
> That's why steps 3–6 exist (to *infer* the wallet) unless you read it from the API/leaderboard.

### Step 3 — Take an EVM token contract → explorer → Holders tab
Copy an EVM token's contract (e.g. PONS `0x39db…3c4571`) and open it on the chain's block
explorer, **Holders** tab. This lists every holder address ranked by balance.
> Robinhood Chain: use the **official Blockscout** (`robinhoodchain.blockscout.com`), **not**
> robinscan.io (unofficial/flagged). In the browser the explorer's Holders page + "Download
> CSV" work for the manual version.

### Step 4 — Repeat for a second same-chain token
Do the same for another token the trader holds **on the same chain** (e.g. BOW
`0x451b…a2d751`) → Holders tab.

### Step 5 — Intersect the two holder lists → the common address is the wallet
Find the address that appears in **both** holder lists, ignoring infrastructure (Raydium
pools, CEX cold wallets, Uniswap pool manager). For `unipcs`: PONS holders (rank 3) ∩ BOW
holders (rank 4) → **`0x0a6EBE…90119E`**. That is his EVM wallet.
> Why it works: copytraders mirror trades with smaller capital, so they sit low in the list;
> comparing the **top** holders filters them out by size. It only works when the trader is a
> **top-N holder** of the tokens (i.e. a whale on those positions).

### Step 6 — Repeat on Solana for the SOL wallet
Same method with the trader's **Solana** tokens on **Solscan**: USELESS holders (rank 15:
`2heJbC…6LDogF`, 15.1M) ∩ KORI holders (rank 10: `2heJbC…6LDogF`, 14M) → SOL wallet
**`2heJbC32Tpfcb3nbUb5ER61K11FGZVfVGtVnDm6LDogF`**.
> Chains are separate namespaces: searching the EVM address inside a Solana holder list
> returns **0/0**. The intersection recovers each chain's wallet **independently** — it does
> **not** prove the two wallets are the same person. Only fomo's own attribution links them.

### Step 7 — Cross-verify on the fomoscan terminal
Open **terminal.fomoscan.sh**, "Set up copytrade" for the trader — the panel shows fomo's
recorded **SOL + EVM addresses** for that handle. Confirm they match the intersection result.
For `unipcs`: terminal showed SOL `2heJbC32…6LDogF` and EVM
`0x0a6ebed0155edb4b21d92ad02897a626cd90119e` — both matched. ✅
> This is the confidence check. Match against fomoscan (or fomo's own data) promotes a result
> from `high-candidate` to confirmed. Intersection **alone** is a strong guess, never proof.

### Step 8 — Use the confirmed wallet → pull its transactions
Open the confirmed wallet's **account page** on the explorer (Solscan for SOL, Etherscan/
Blockscout for EVM) → **Transactions / Swaps**. That is the trader's trade history.
For `unipcs`'s SOL wallet: Solscan showed 170 tokens (~$953k), funded by KuCoin, and swaps
tagged **"DFlow: Swap · By Fomo Co-signer"**.
> The **"Fomo Co-signer"** signer on the swaps is independent proof the wallet is a real fomo
> account (a good confidence bump) — not just some holder that happened to match.

### Step 9 — Record into a table
For each trader: `handle`, `twitter` (if any), `sol_address`, `evm_address`, positions, and
trades → one CSV/table.

### How the automation maps to this manual flow
| Manual step | Automated by |
|---|---|
| 1–2. Leaderboard + profile positions/contracts | **fomo leaderboard API** (`/leaderboard/{window}`) — one call returns handle + **both wallets** + `topHoldings`. Collapses steps 1–6. |
| 3–6. Holder intersection to infer the wallet | **Only needed as a fallback** now (traders not in the API), via Blockscout holders (EVM) + Solana RPC `getTokenLargestAccounts` (SOL). |
| 7. Cross-verify on fomoscan | Optional `cross_check` column; or the leaderboard/profile *is* the authoritative source. |
| 8. Pull transactions | **Etherscan V2 / Blockscout / Solana RPC (or Helius)** per resolved wallet. |
| 9. Table | Single CSV / `wallets.json` + the app's live trade table. |

> **Key takeaway:** the manual flow *inferred* the wallet from public positions because the
> profile page hides the address. The **leaderboard API returns the address directly**, so the
> automated pipeline skips the inference (steps 3–7) for anyone on the leaderboard and keeps it
> only as a fallback for off-leaderboard traders.

---

## Confirmed API reference

### fomo.family (private — needs your token)

- **Base:** `https://prod-api.fomo.family/v2`
- **Auth:** `Authorization: Bearer <privy-token>` ✅
  - The **cookie** form (`Cookie: privy-token=…`) returns **HTTP 431 (Request Header Fields
    Too Large)** — the JWT + cookies overflow the server's header cap. **Bearer avoids this.** ✅
  - CORS + 431 only bite in a **browser** context; from a server-side script (Python/Node)
    there's no CORS, and Bearer keeps the header small. ✅
  - Token is a **Privy JWT**, `aud` = fomo's Privy app id (`cm6h485o300n3zj9yl6vpedq7`),
    **expires ~1 hour**. Grab from browser: DevTools → Application → Cookies → `fomo.family`
    → `privy-token`. ✅
  - You **cannot** mint a valid token from your own Privy/Clerk app — tokens are scoped to
    fomo's Privy tenant (`aud`) and a real fomo user (`sub`). "Log in with Privy" on your own
    app authenticates users to *your* app, not to fomo. ✅

- **Leaderboard:** `GET /leaderboard/{window}` where window ∈ `24h | 7d | 30d` ✅
  - Response shape (**confirmed** from a live capture):
    ```json
    {
      "success": true,
      "message": "...",
      "statusCode": 200,
      "responseObject": {
        "leaderboard": [
          {
            "id": "6e51b3ef-...",              // stable id (handles can change)
            "userHandle": "DumbCrayonEater",   // <-- the handle to use
            "displayName": "DumbCrayonEater",  // shown name (may differ from handle)
            "address": "43nktK56...",          // <-- SOLANA wallet
            "evmAddress": "0xb48ae67b...",     // <-- EVM wallet
            "twitter": null,                    // X handle when set (often null)
            "pnl30d": 3272625.90,
            "numTrades": 1708,
            "totalVolume": 913117.47,
            "followers": 308822,
            "totalHoldings": 61,
            "topHoldings": [
              { "tokenAddress": "0x2e8c...", "networkId": 4663,
                "humanAmount": 29322551.56, "value": 2669119.99, "pnl": 2647913.65 }
            ]
          }
          // ~150 entries
        ]
      }
    }
    ```
  - **This single call gives handle + both wallets + positions for ~150 traders.** It makes
    the whole resolver / holder-intersection machinery unnecessary. `networkId` in
    `topHoldings` identifies the chain (4663 = Robinhood Chain).

- **Profile:** `GET /users/userHandle/{handle}` — returns the individual profile (also
  contains wallet fields). Redundant now that the leaderboard carries everything, but useful
  for a single lookup by handle. ✅ (`userHandle` is the path param — the `@handle`, **not**
  the display name. Typing a display name → 404.)

> ⚠️ **Parser fix needed:** the shipped `build_directory.py` looked for `handle`/`username`
> and generic address fields. Update it to read `responseObject.leaderboard[]` and map
> `userHandle`, `displayName`, `address` (SOL), `evmAddress`, `twitter`, `pnl30d`,
> `topHoldings`. This is the one known code change outstanding.

### Etherscan V2 (free) — ETH / BSC / Base

- `GET https://api.etherscan.io/v2/api?chainid={id}&module=account&action=tokentx&address={addr}&page=1&offset=300&sort=desc&apikey={KEY}` ✅
- **One key covers all chains** via `chainid`: Ethereum `1`, BSC `56`, Base `8453`. ✅
- V1 per-chain endpoints were deprecated (Aug 2025); V2 is the current unified API. ✅
- Free tier: community endpoints, ~100k calls/day. `tokentx` is a community endpoint → free. ✅
- Amounts are raw integers; divide by `10 ** tokenDecimal`.

### Robinhood Chain — Blockscout (free, no key)

- Host: `https://robinhoodchain.blockscout.com`
- Token transfers: `GET /api/v2/addresses/{addr}/token-transfers` ✅
- Token holders: `GET /api/v2/tokens/{contract}/holders`
- **403 fix:** send browser-like headers (`User-Agent`, `Accept`) — Cloudflare blocks bare
  requests; with headers it returns data. ✅ (Confirmed working — Robinhood rows came through.)
- Amounts: `total.value` raw; divide by `10 ** token.decimals`. (Early CSV bug: forgot to
  scale these — fixed.)

### Solana — public RPC (free) / Helius (free tier, better)

- Public RPC: `https://api.mainnet-beta.solana.com` (slow, rate-limited, may time out on Vercel).
- Methods used:
  - `getSignaturesForAddress(addr, {limit})` → tx signatures ✅
  - `getTransaction(sig, {encoding:"jsonParsed", maxSupportedTransactionVersion:0})` → decode
    token moves from `meta.preTokenBalances` / `meta.postTokenBalances` diff (owner == wallet):
    positive delta = buy/received, negative = sell/sent. ✅ (This is our free "decode.")
  - `getTokenLargestAccounts(mint)` → top-20 holders (token accounts; resolve owners via
    `getMultipleAccounts` jsonParsed). Free holder source for the intersection. ✅
- **Helius (recommended upgrade, free tier):**
  - Drop-in RPC (set `SOLANA_RPC` to the Helius URL) → fixes slowness/timeouts. ✅ pricing
  - **Enhanced Transactions API** decodes SPL transfers / DeFi swaps / NFT events into
    structured JSON — i.e. *labeled* swaps for free (what Solscan Pro's $32 buys). ⚠️ confirm endpoint in docs
  - **DAS API** (`getAsset`) → token metadata, so mint → symbol without a hardcoded map. ⚠️ confirm endpoint
  - **Webhooks** → real-time wallet activity (optional "live feed" feature).
  - Free limits: 1M credits/mo, 10 RPS, **2 RPS on Enhanced/DAS** (throttles bulk pulls).

### fomoscan (paid resolver)

- `GET https://api.fomoscan.sh/v2/user/handle/{handle}` with `Authorization: Bearer <key>` →
  `{ id, handle, name, solanaAddress, evmAddress }`. ✅ (shape)
- Key from `partner.fomoscan.sh`. **Free tier does NOT cover this endpoint** — returns
  **HTTP 402 Payment Required**; needs a paid plan (~$79/mo Starter). ⚠️
- Its key *is* a real server credential (not personal, not hourly) — the only clean way to do
  name→wallet in a **public** deployed app. This is the honest argument for paying.

### Known Solana mint → symbol (seed map)

```
EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v = USDC
Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB = USDT
So11111111111111111111111111111111111111112 = SOL (wrapped)
Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk = USELESS
HtTYHz1Kf3rrQo6AqDLmss7gq5WrkWAaXn3tupUZbonk = KORI
```

### Reference wallet (test subject: `unipcs`)

- EVM: `0x0a6ebed0155edb4b21d92ad02897a626cd90119e`
- SOL: `2heJbC32Tpfcb3nbUb5ER61K11FGZVfVGtVnDm6LDogF`
- Confirmed across: manual holder-intersection, fomoscan terminal, and fomo profile. ✅

---

## The holder-intersection method (fingerprinting) — kept as a fallback

Before we found that the leaderboard returns wallets directly, the plan was to *infer* a
trader's wallet from their public positions. It works, with heavy caveats, and is retained
as a free fallback for traders **not** on the leaderboard.

**How:** take ≥2 tokens the trader holds **on the same chain**, pull each token's top-N
holder list, intersect them; the common address is the candidate wallet. Validated on
`unipcs` on **both** chains (PONS ∩ BOW on Robinhood → EVM wallet; USELESS ∩ KORI on Solana →
SOL wallet), matching fomoscan. ✅

**Hard caveats (why it's a fingerprint, never "verified"):**

- It identifies a **wallet**, not a **person**. The "handle ↔ wallet" link is an off-chain
  fact in fomo's DB; nothing on-chain proves it. So label results `high-candidate`, not
  "verified."
- **Infra contamination:** raw intersections include pools/CEX wallets that hold *every*
  token. Real example from the data: **Raydium Vault Authority #2** appeared in both USELESS
  and KORI holder lists → it survives a naive intersection. Must filter labeled infra
  (Raydium/Orca/Uniswap pools, Kraken/KuCoin/MEXC/Binance/Bitvavo cold wallets, program
  authorities). The "single clean match" you get by eye is because a human ignores these; a
  script won't.
- **Whale-only:** only works if the trader is a top-N holder of their tokens. Fails on small
  positions.
- **Can't bridge chains:** intersecting SOL holders and EVM holders gives two addresses with
  no on-chain proof they're the same person. Only fomo's own attribution links them.
- Full holder lists are a paid/heavy pull on some explorers; top-N is enough and cheaper.

**Confidence labels used in the scripts:**
`account-linked` (from fomo/fomoscan) → `cosigner-confirmed` (Fomo Co-signer seen on Solana
swaps) → `high-candidate` (single intersection hit) → `ambiguous` (>1 hit) → `manual`.

**"Fomo Co-signer" signal:** a fomo user's Solana swaps are co-signed by "Fomo Co-signer"
(visible on Solscan). Its presence in a wallet's swaps is independent corroboration that the
wallet is a real fomo account — a good confidence bump.

---

## Free vs Paid — the honest cost table

| Capability | Free path | Paid alternative |
|---|---|---|
| Leaderboard (top traders) | fomo API + **your token** (local only) | — (no API sells this) |
| Handle → wallet | leaderboard/profile via your token; or free intersection (whale-only) | **fomoscan ~$79/mo** (clean, deployable) |
| EVM trades (ETH/BSC/Base) | **Etherscan V2 free** | — |
| Robinhood Chain trades | **Blockscout free** | — |
| Solana trades (raw decode) | **public RPC / Helius free** | — |
| Solana trades (labeled swaps) | **Helius Enhanced free** ⚠️ | Solscan Pro ~$32/mo |
| Solana token symbols | **Helius DAS free** ⚠️ / hardcoded map | Solscan |
| Fast/reliable Solana on Vercel | **Helius free RPC** | any paid RPC |

**Bottom line:** the entire pipeline can run **$0 in API fees**. The only non-free-and-clean
piece is the fomo leaderboard/profile read, which rides your personal login. Pay for fomoscan
only if you need name→wallet in a **public** app.

---

## Architecture (chosen)

```
LOCAL (your machine, your token)                 DEPLOYED (Vercel, free keys only)
─────────────────────────────                    ─────────────────────────────────
build_directory.py                               Next.js app (genie-fomo)
  FOMO_TOKEN (Bearer) ─▶ /leaderboard/30d          data/wallets.json  (committed cache)
  parse responseObject.leaderboard                 app/  UI: search a name ─▶
  ─▶ data/wallets.json                             /api/trades?evm=&sol= ─▶
     {handle, name, evm, sol, pnl, positions}        Etherscan V2 / Blockscout / Solana RPC
                                                      (keys in Vercel env vars, server-side)
  (token NEVER committed; refresh cache            ─▶ live trades ─▶ table
   on a cadence — leaderboard reshuffles)
```

**Why split this way:** name→wallet changes rarely → resolve once, cache, keep the token
local. Trades change constantly → fetch live with safe keys. This removes the hourly-token
problem from the deployed app entirely.

---

## Deliverables (files produced this session)

| File | What it does | Status |
|---|---|---|
| `build_directory.py` | Local: 30d leaderboard → `data/wallets.json` (Bearer auth). | ⚠️ parser needs the confirmed field mapping (`responseObject.leaderboard`, `userHandle`, `address`, `evmAddress`). |
| `ether_scan1.py` | Interactive EVM-only CLI: type names/addresses → EVM trades table + CSV. Bearer name-resolution (431 fix). | ✅ EVM trades confirmed working; name lookup pending the leaderboard fix / correct handle. |
| `fomo_free.py` | All-free multi-chain trade puller for known wallets (Etherscan + Blockscout + Solana RPC balance-diff). | ✅ produced a real cross-chain CSV for unipcs. |
| `fomo_scanner.py` | Full flow: resolve (manual / fomo-profile / paid fomoscan / free intersection) → trades → single CSV; interactive prompt; `[FREE]`/`[PAID]` tagged logging. | ⚠️ uses cookie auth for fomo (needs Bearer swap); leaderboard parser needs the fix. |
| `genie-fomo/` (Next.js + Tailwind) | App: `data/wallets.json` directory + search UI (`app/explorer.tsx`) + `/api/trades` route (`lib/fetchers.ts`). Cool terminal-ledger aesthetic, monospace on-chain data, buy/sell color. | ⚠️ code written but not build-verified in this environment; `lib/fetchers.ts` Solana path is raw-decode (could upgrade to Helius). |

Outputs (CSV columns used): `handle, wallet, chain, tx_hash/tx, time, token, contract/mint,
amount, side (buy/sell/in/out), from, to, pulled_at` (plus resolution/confidence/notes in the
full scanner).

---

## Chronological decision log (the "why", so context isn't lost)

1. **Started** wanting to scrape fomo leaderboard → profiles → contracts → explorers → map
   wallets → trades → table; asked for a Python or n8n pipeline.
2. **Reframed:** fomoscan's API does handle→wallet in one call, so most of the manual
   "fingerprinting" plan was redundant *if* you pay. Flagged robinscan.io as unofficial.
3. **User pushed the intersection method** (find wallet via common token holders) and proved
   it manually on `unipcs` — EVM (PONS ∩ BOW) then Solana (USELESS ∩ KORI), cross-checked on
   fomoscan. Correct that it *works*; corrected that it's a **fingerprint, not proof**, and
   surfaced infra contamination (Raydium in both lists) + the cross-chain-link gap.
4. **Browser recon** of fomo.family confirmed the leaderboard + profile endpoints are
   **private** (Privy JWT, `no-store`, CORS-locked; cookie → 431). Concluded: don't scrape
   fomo headlessly; use fomoscan or a token.
5. **Pricing reality check:** fomoscan free tier → **402** (paid-only, ~$79); Solscan →
   **no free tier** (from ~$32). Etherscan free works. So the "clean" pipeline is ~$100+/mo;
   the free pipeline needs workarounds.
6. **Went free-first:** Etherscan (EVM) + Blockscout (Robinhood, 403 fixed with headers) +
   **public Solana RPC** (corrected an earlier wrong claim that "there's no free Solana
   source" — RPC gives raw-but-real data free). Produced a real multi-chain CSV.
7. **Token-in-a-script:** switched fomo auth from cookie → **Bearer**, which fixes the 431 and
   lets a script call the leaderboard/profile directly (no browser needed).
8. **App design:** local resolver builds a cached `wallets.json` (token stays local); Next.js
   app reads it + fetches trades live. Rejected "log in with Privy like Clerk" — auth
   providers can't mint tokens valid for *fomo's* backend.
9. **Leaderboard shape confirmed** (`responseObject.leaderboard[]` with `userHandle`,
   `address`=SOL, `evmAddress`, `topHoldings`, `twitter`, `pnl30d`) — collapses resolution to
   one free call; retire fingerprinting to fallback.
10. **Helius evaluated** as a free upgrade for Solana (fast RPC + Enhanced decoded swaps + DAS
    symbols + webhooks).

---

## Known limits & honest caveats

- **fomo token expires ~hourly** and is a personal login credential. Fine locally; never
  commit it, never ship it in a public app.
- **ToS:** automating a private authed endpoint (fomo) is ToS-exposed. Acceptable for a small
  internal tool on your own session; do **not** scale it into a public product on a personal
  login. Public = pay for fomoscan.
- **Directory is a leaderboard snapshot** (top ~150), not "all of fomo," and **goes stale** —
  re-run `build_directory.py` on a cadence. Handles can change; the `id` is stable.
- **Solana on public RPC** is slow and capped (≈12–60 signatures) and may time out on Vercel's
  function limit → use a free Helius RPC URL.
- **Amounts are token quantities, not USD.** Robinhood amounts must be decimal-scaled.
- **Solana tokens outside the known-symbol map** show as mint addresses (Helius DAS fixes this).
- **The Next.js app was not build-verified** in this environment (sandbox disk/npm limits) —
  run `npm install && npm run build` locally to confirm.
- Response shapes for Solscan/Blockscout/Helius Enhanced were partly written against docs, not
  live runs — verify field names on first run.

---

## Security note (important)

During the session, live API keys (Etherscan, fomoscan, Solscan) and a fomo `privy-token` were
pasted into chat and should be treated as compromised → **rotate them.** Going forward:
- Keys/token live in **env vars** locally and **Vercel Environment Variables** in prod.
- **Never** paste secrets into chat, commit them, or embed them in frontend code.
- The `.gitignore` already excludes `.env.local` and `raw/`.

---

## Next steps (recommended order)

1. **Fix `build_directory.py`** to the confirmed leaderboard shape (`responseObject.leaderboard`,
   `userHandle` / `address` / `evmAddress` / `topHoldings` / `twitter` / `pnl30d`). Then a
   single run produces a full `wallets.json` for ~150 traders — resolver done, free.
2. **Swap `fomo_scanner.py`** fomo calls from cookie → Bearer (same 431 fix as `ether_scan1.py`).
3. **Get a free Helius key**, set `SOLANA_RPC` to it; optionally rewrite the Solana fetcher to
   Helius **Enhanced Transactions** (labeled swaps) + **DAS** (symbols) — verify endpoints in
   Helius docs first.
4. **Build-verify the Next.js app** locally, wire `lib/fetchers.ts` to the same logic, deploy to
   Vercel with `ETHERSCAN_KEY` + `SOLANA_RPC` env vars.
5. **Decide free vs paid for public use:** if the app must resolve arbitrary names for anyone,
   budget fomoscan (~$79/mo) — it's the only deployable resolver. Otherwise keep the cached
   `wallets.json` + local refresh.
