# Relayer worker

Not deployed. Do not run `wrangler deploy` until the owner agrees.

This is the Cloudflare Worker form of `scripts/relayer.mjs`. It signs the same three testnet actions: open a thread as a meta-transaction, reply, and refund. It refuses an RPC URL or account id that is not testnet. `POST /open` accepts only the five sample prices in `web/src/data/founders.ts` and a timeout of 120 or 259200 seconds.

Routes: `GET /health`, `POST /open`, `POST /reply`, `POST /refund`.

## Secrets

Account ids and the testnet RPC are public and live in `wrangler.toml` under `[vars]`. Private keys do not. There is no `.env` in this directory to commit.

After `npx wrangler login`, from `relayer-worker/`:

```sh
npx wrangler secret put SENDER_PRIVATE_KEY
npx wrangler secret put RELAYER_PRIVATE_KEY
npx wrangler secret put FOUNDER_PRIVATE_KEY
```

Paste the `ed25519:` values from the key file used to deploy the contracts. Do not write them into `wrangler.toml`, source, or the Pages build.

Optional:

```sh
npx wrangler secret put RELAYER_TOKEN
```

If `RELAYER_TOKEN` is non-empty, POST must send `Authorization: Bearer <token>`. The static site cannot send that header without publishing the token. Leave the secret unset if `https://receipts-near.pages.dev` should call POST. Set it if only a private client should. A caller who can POST spends `sender.rcpt14c055.testnet`'s dmUSD, and only at the five sample prices.

`GET /health` stays public. It reports `signing: true` or `false` and does not return key material.

## Deploy, when the owner says so

```sh
cd relayer-worker
npm ci
npm test
npx wrangler deploy
```

`npm run check` runs `wrangler deploy --dry-run` and does not deploy.

Browser calls are limited to `ALLOWED_ORIGINS` in `wrangler.toml`: `https://receipts-near.pages.dev`, `http://127.0.0.1:5173`, and `http://127.0.0.1:4173`. Requests with no `Origin` header (curl, the Node scripts) are not blocked by that list. CORS is not authentication.

## Point the static site at it

The Pages build leaves `VITE_RELAYER_URL` unset, so the hosted site does not call a relayer. After a real deploy:

```sh
cd web
VITE_RELAYER_URL=https://receipts-relayer.<account>.workers.dev npm ci
VITE_RELAYER_URL=https://receipts-relayer.<account>.workers.dev npm run build
```

Publish `web/dist` to the Pages project `receipts-near`. Until that second build is published, the site stays in demo mode.

## Local

```sh
cp .dev.vars.example .dev.vars
# fill SENDER_PRIVATE_KEY, RELAYER_PRIVATE_KEY, FOUNDER_PRIVATE_KEY
npm ci
npm run dev
```

`wrangler dev` listens on `127.0.0.1:8788`. The site then needs `VITE_RELAYER_URL=http://127.0.0.1:8788`. The Node process `scripts/relayer.mjs` is the same local loop and does not need this package.
