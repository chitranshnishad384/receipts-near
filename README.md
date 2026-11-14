# Receipts

Pay-to-DM for a founder directory. Messaging a founder locks a fee in a NEAR testnet escrow. A reply pays the founder. Silence refunds the sender after a deadline. The default deadline is 72 hours. A message can set its own deadline, down to 60 seconds, so a refund can be shown without waiting three days.

Live site: https://receipts-near.pages.dev
Repository: https://github.com/chitranshnishad384/receipts-near

## Problem

A cold message costs the sender nothing, so founders do not answer. The fee has to be conditional: the founder is paid only if they reply, and the sender gets the fee back if they do not.

## Product

A directory of five fictional founders. Each one has a price in dmUSD. The sender writes a message, sees a dry cross-chain quote for that price, and — when a relayer is configured — locks dmUSD in the escrow with a meta-transaction. The founder inbox calls `reply` and the escrow pays the founder. After the deadline anyone may call `refund` and the escrow pays the sender. The static site can be read with no keys and no relayer. Locking, replying, and refunding from the browser need a relayer that holds the demo keys.

Every name, company, city, and revenue figure on the page is fictional. The page says so. `data/ORIGINAL_SEED.flag.md` records that this git history never contained a seed file of real companies' self-reported figures, and that those figures must not be added.

## Track

`realworld`. A founder, or an agency that answers for a founder, can charge for a cold message: the fee waits in escrow, a reply pays them, and silence returns it. The sender does not attach NEAR for gas. Checkout shows what that fee would cost in USDC on another chain.

The loop a company could run tomorrow is the same one with a wallet-signed meta-transaction and a real stablecoin. This repository runs it on NEAR testnet with dmUSD, one shared inbox for the five sample founders, and a relayer that holds the demo keys. The hosted site does not lock a new fee. The relayer is not deployed. dmUSD is not USDC.

Hints from that track that this repo actually uses: a stablecoin-shaped fungible token, a NEAR Intents 1Click quote with `dry: true`, and a NEP-366 meta-transaction.

## How NEAR is used

RPC for deployment and reads: `https://test.rpc.fastnear.com`.

| Account | Role |
| --- | --- |
| `escrow.rcpt14c055.testnet` | Escrow. Holds dmUSD for each thread. `reply` pays the founder. `refund` pays the sender after the deadline. |
| `dmusd.rcpt14c055.testnet` | `dmUSD`, a NEP-141 token with 6 decimals. Stand-in for USDC. Not issued by Circle, not bridged, not redeemable. The token's `disclaimer` view says the same thing on chain. |
| `relayer.rcpt14c055.testnet` | Pays gas for the sender's meta-transaction and for permissionless refunds. |
| `sender.rcpt14c055.testnet` | Demo sender. Signs the delegate action. Does not sign the outer transaction. |
| `founder.rcpt14c055.testnet` | Demo inbox. A reply from this account releases the fee. |
| `rcpt14c055.testnet` | Faucet-created root. Owns minting and the default timeout. |

Explorer account: https://explorer.testnet.near.org/accounts/escrow.rcpt14c055.testnet

Opening a thread is `ft_transfer_call` on `dmusd.rcpt14c055.testnet`. The token calls `ft_on_transfer` on `escrow.rcpt14c055.testnet`. The JSON message is `{ "founder", "handle", "message", "timeout_seconds" }`. The escrow keeps the tokens by returning unused amount `0`. The call is wrapped in a NEP-366 delegate action: the sender signs it, and the relayer submits it. On the open transaction below, `signer_id` is the relayer and the delegate sender is `sender.rcpt14c055.testnet`. The inner action is `ft_transfer_call`. The escrow identifies the user with `predecessor_account_id`, which is the sender, not the relayer.

A founder reply calls `reply`. The escrow transfers dmUSD to the founder and marks the thread `Released`. Anyone can call `refund` once `block_timestamp` is past `opened_at + timeout`. The recorded refund was sent by the relayer, so the sender paid no gas for that either. NEAR does not run the contract on a clock. The contract allows the refund and does not require the sender, but some account still has to send the transaction.

The checkout that would have been a card form is a NEAR Intents [1Click quote](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote) with `dry: true`. The browser POSTs to `https://1click.chaindefuser.com/v0/quote` for an `EXACT_OUTPUT` of the message price in USDC on NEAR, paid from USDC on Base, Ethereum, Arbitrum, or Solana. Dry quotes do not include a deposit address. This app throws if a response has one. Nothing is swapped and no mainnet token moves. There was no Stripe code in this repo to delete. Asset ids were read from `GET https://1click.chaindefuser.com/v0/tokens` on 2026-11-14. No 1Click JWT is used.

### Recorded testnet transactions

Read from chain on 2026-11-14. Thread 1 is `Released`. Thread 2 is `Refunded`. Sender balance 970.00 dmUSD. Escrow balance 0. Founder balance 30.00 dmUSD. A later local loop spends more of the sender balance and adds threads. The same facts are in `web/public/network.json`.

| Step | Transaction |
| --- | --- |
| Create root | https://explorer.testnet.near.org/transactions/ECDBZ1kYcV5GQ6Yc1qC3GLbWrxj228RWVqNMuc9whEKP |
| Deploy dmUSD | https://explorer.testnet.near.org/transactions/3dhXnfmaYYNpJDdHNcQnpV6cGwXCzAp85Ub9giT8c4XF |
| Init dmUSD | https://explorer.testnet.near.org/transactions/3VgPYcokLW6caUYFj9BxrSWfQ56MZiGJQv9xhDTPD1wV |
| Deploy escrow | https://explorer.testnet.near.org/transactions/Go2tnrzBmrSY45ErQvC9DeQCKU4bkNLnLYC71LWpKYTg |
| Init escrow | https://explorer.testnet.near.org/transactions/8vMChccbqG9f1GYVcmDYS2qe2zsQ9vFmLsv4uRQFZFZy |
| Mint 1000 dmUSD to the sender | https://explorer.testnet.near.org/transactions/j3nAQcUogC1Tkf2q7tE9BQ8ozMj1zMPs5yAJHKwztmJ |
| Open thread 1 (meta-transaction, 30 dmUSD, 72h) | https://explorer.testnet.near.org/transactions/CTgCUrvr1Z4UjBrRfArhP4ZXZvm8PsxfiW3k7fCcCxRc |
| Founder reply releases thread 1 | https://explorer.testnet.near.org/transactions/GLiLnCymMLfbEnVNZA7Cn76DDqwdALaTFJLbshAUaT7e |
| Open thread 2 (meta-transaction, 5 dmUSD, 120s) | https://explorer.testnet.near.org/transactions/FrdtgHVZ3vMe8Btie9Uxdw9ydC4y8q7WHqGK7Coya2ww |
| Refund thread 2 after the timeout | https://explorer.testnet.near.org/transactions/FJ7ChAAwN6si6dPAcHu3FBD6xQct4gYN47VT9HajU1PK |

## Do this, then see that

Static site, no keys. Build command and output are in the next section. Open https://receipts-near.pages.dev (the Pages project `receipts-near`, built from this repository), or a local preview at http://127.0.0.1:4173 .

The steps below are that build, with `VITE_RELAYER_URL` unset.

1. Open `#/`. See the banner `NEAR testnet · dmUSD is a stand-in token, not Circle USDC · 1Click quotes are dry and move no funds`. See the heading `Message a founder. The fee waits.` See five cards: Kite & Column (Lila Pender, Portland), Harbor Mint (Otto Bramble, Halifax), Salt Route (June Okonkwo, Accra), Lowlamp Studio (Nico Feld, Leipzig), Brine Mail (Sera Quill, Cork). Each card says `fictional sample ARR`.
2. Open Salt Route, `#/f/june-okonkwo`. See `30.00 dmUSD`, a textarea labeled `What do you want to ask?`, and the choices `72 hours` and `2 minutes, for the refund demo`.
3. Type any message. Press `Continue to dry quote`. The address is `#/checkout/june-okonkwo`. See the message, the row `Locked until reply` / `30.00 dmUSD`, and the panel heading `Pay from any chain`.
4. `Base USDC` is already selected. See a live USDC amount on Base, a line that it delivers about 30 USDC on NEAR, a time estimate, and the sentence `No deposit address on this quote. The testnet lock is separate.` Pressing `Ethereum USDC`, `Arbitrum USDC`, or `Solana USDC` asks for another dry quote. The button `Lock dmUSD, relayer pays gas` is disabled.
5. Under that button, see `Demo mode. This build has no relayer URL, so a new fee cannot be locked from the browser and this page does not contact a relayer.` The word `Released` links to https://explorer.testnet.near.org/transactions/GLiLnCymMLfbEnVNZA7Cn76DDqwdALaTFJLbshAUaT7e . The word `Refunded` links to https://explorer.testnet.near.org/transactions/FJ7ChAAwN6si6dPAcHu3FBD6xQct4gYN47VT9HajU1PK . `Thread 1` links to `#/t/1`. `thread 2` links to `#/t/2`. The page does not request a relayer.
6. Open `#/t/1`. See the stamp `released` (the stylesheet draws it in capitals), the message about 300kg on Fridays, and the reply `Yes, under 400kg. Send the harbor and the landing day and I will hold a Friday slot.` See amount `30.00 dmUSD`, sender `sender.rcpt14c055.testnet`, and links `Opened` and `Settled`. See balances: sender `970.00 dmUSD`, escrow `0.00 dmUSD`, founder `30.00 dmUSD`, unless a later loop has spent more.
7. Open `#/t/2`. See the stamp `refunded`, Nico Feld's gasket question, no reply, amount `5.00 dmUSD`, and links `Opened` and `Settled`. Escrow balance `0.00 dmUSD`.
8. Open `#/desk`. See the heading `Reply, and the fee is yours.` See both threads, stamps `released` and `refunded`. Neither is open, so there is no reply box. The line under the heading says this build has no relayer URL, so a reply cannot be signed here. The same demo-mode note is on the page. The nav item `Escrow` opens https://explorer.testnet.near.org/accounts/escrow.rcpt14c055.testnet .

Screenshots at 1280x800 are in `docs/screenshots/`. `docs/receipts-demo.mp4` is a 48-second walkthrough of the directory, a dry quote, the released thread, and the refunded thread. It was recorded before the demo-mode note. `docs/DEMO_POST.md` is a draft and has not been posted.

## Run locally

### Read the site

Contracts, if you build them (Rust 1.100, `wasm32-unknown-unknown`):

```sh
cargo test --workspace
cargo build --workspace --release --target wasm32-unknown-unknown
```

Static site. Build command: `npm ci && npm run build` in `web/`, with `VITE_RELAYER_URL` unset. Output directory: `web/dist`. That folder is a Cloudflare Pages static site (`web/public/_redirects` sends unknown paths to `index.html`). No server is required to read the directory, the dry quote, or the recorded threads.

```sh
cd web
npm ci
npm run build
npm run preview
```

Open http://127.0.0.1:4173 and follow the steps above.

### Full loop (lock, reply, refund)

This needs the testnet key file. It is not in the repo. Copy `scripts/.env.example` to a path outside the repo and fill the `ed25519:` secrets for the sender, founder, and relayer accounts above. The accounts already exist. Do not commit the file.

Terminal A:

```sh
cd scripts
npm ci
KEYS_FILE=$HOME/.receipts-testnet.env node relayer.mjs
```

The process listens on `http://127.0.0.1:8788` only. `GET /health` returns `{ "ok": true, "network": "testnet" }`.

Terminal B:

```sh
cd web
npm ci
VITE_RELAYER_URL=http://127.0.0.1:8788 npm run dev
```

Open http://127.0.0.1:5173 .

1. Open `#/f/nico-feld` (Lowlamp Studio, `5.00 dmUSD`). Write a message. Leave `72 hours` selected. Press `Continue to dry quote`.
2. On `#/checkout/nico-feld`, wait until `Lock dmUSD, relayer pays gas` is enabled. That happens after `GET http://127.0.0.1:8788/health` succeeds. Press it. The button label becomes `Signing meta-transaction…`.
3. The address becomes `#/t/3` or the next id. See the stamp `open`. Sender balance is 5.00 dmUSD lower than before the click. Escrow balance is `5.00 dmUSD`.
4. Open `#/desk`. That thread is `open`. The reply box already contains `Yes — send the harbor and the day you land.` Press `Reply and release`. The stamp becomes `released`. Founder balance is 5.00 dmUSD higher. Escrow balance is `0.00` again.
5. Open `#/f/nico-feld` again. Write a second message. Select `2 minutes, for the refund demo`. Continue, then press `Lock dmUSD, relayer pays gas`.
6. Open the new thread. Wait until the reply deadline is in the past (about two minutes). The button `Refund to sender` appears. Press it. The stamp becomes `refunded`. The 5.00 dmUSD is back on the sender. Escrow is `0.00`.

`scripts/demo-flow.mjs` does the same two settlements from the command line (30 dmUSD to June with a reply, then 5 dmUSD to Nico with a 120 second timeout and a refund). It rewrites `web/public/network.json` and `docs/tx-log.json` with the new transaction hashes. Run it only if you mean to replace the recorded demo. Both `scripts/deploy.mjs` and `scripts/demo-flow.mjs` refuse an RPC URL that does not look like testnet.

`scripts/relayer.mjs` is the process the browser calls. It is not part of `web/dist`.

### Worker, not deployed

`relayer-worker/` is the same relayer as a Cloudflare Worker. It has not been deployed. Deploy steps, and the rule that private keys are `wrangler secret put` values and not config, are in `relayer-worker/DEPLOY.md`. The Pages build does not set `VITE_RELAYER_URL`, so publishing `web/dist` does not point the site at a worker.

## Tests and CI

`cargo test --workspace` covers mint and transfer rules, a failed `ft_transfer_call` refund, opening a thread only from the token contract, rejecting a stranger's reply, rejecting a refund before the deadline, accepting one after it, and the success and failure callbacks. `.github/workflows/ci.yml` runs those tests, the wasm release build, `npm run build` in `web/` (and checks the bundle contains no relayer origin), and `npm test` in `relayer-worker/`.

## Hackathon diff

This repository was created on 2026-11-05, inside the window that opened on 2026-10-19 (development through 2026-11-14). The baseline commit is `5110f01779384c6d1f16d2f57e0fa81ed27c6e94`, whose only content is the sentence "Verified-revenue social network for founders." There is no commit before the window, so there is no `pre-hackathon` tag.

This public repository is a single-commit snapshot of the `near-hackathon` branch (tip `c3fd3bb`) of the original development repository, so the per-commit history is not included here.

Everything after that commit was written for the hackathon: both contracts, the scripts, the static site, the dry 1Click checkout, the local relayer, the tests, the undeployed Worker under `relayer-worker/`, and this README.

Libraries and tools, all allowed: `near-sdk` 5.23.0, `near-api-js` 7.5.3, React 19, Vite 6, Wrangler 4 (dev dependency of the undeployed worker), and the public 1Click HTTP API. The `unit-testing` feature of `near-sdk` is enabled so `cargo test` can run on the host. That feature's mock code is compiled out of the wasm target. No pre-hackathon library of ours is used.

The code was written with Cursor Grok. AI-generated code is allowed; this is the disclosure.

## Limitations

- `dmUSD` is not USDC. A dry 1Click quote prices real USDC on mainnet routes and then stops. The escrow is funded only with the testnet stand-in.
- The quote recipient and refund address are placeholders required by the quote API. They are not paid.
- A refund does not fire by itself. After the deadline any account may call `refund`. The demo relayer does that. There is no chain cron.
- The static build leaves `VITE_RELAYER_URL` unset. Lock, reply, and refund from that build do nothing on chain. The checkout page does not call a relayer. The Worker in `relayer-worker/` is not deployed. Hosting it is a separate decision: the worker holds the sender key, so a public POST spends the remaining testnet dmUSD.
- Founder prices live in the frontend. The contract escrows whatever amount was transferred, with a minimum of 1 dmUSD. The relayer only forwards the five sample prices.
- All five sample founders settle to one inbox account so the demo can be answered with one key. The handle is stored on the thread.
- The local relayer holds the sender, founder, and relayer keys. A production sender would sign the delegate action in a wallet. The relayer would only submit that signed blob, and it would still only relay `ft_transfer_call` into this escrow.
- The sender account has to exist before a meta-transaction. The relayer pays the 1 yoctoNEAR attached to `ft_transfer_call`.
- Contract storage is paid by the escrow account. A testnet caller can open threads until that balance is tight.
- If the token transfer fails, the callback reopens the thread. The callback itself does not panic if the thread is already settled.
- Revenue figures are not verified. The product name describes the idea. This demo does not attest revenue.
- Balances and thread count in the steps above were read on 2026-11-14. They change if someone runs the full loop.

## License

MIT. See `LICENSE`.
