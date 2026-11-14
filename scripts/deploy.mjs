import fs from "node:fs";
import path from "node:path";
import {
  KEYS_FILE,
  NEAR,
  REPO_ROOT,
  STORAGE_DEPOSIT,
  account,
  exists,
  explain,
  freshKey,
  loadEnv,
  saveEnv,
  send,
  txHash,
  view,
} from "./chain.mjs";

const rootEnv = loadEnv("/home/ubuntu/.near-receipts-keys/root.env");
const env = { ...rootEnv, ...loadEnv() };
env.RPC_URL = env.RPC_URL || "https://test.rpc.fastnear.com";
const rootId = env.ROOT_ACCOUNT;
const rootKey = env.ROOT_PRIVATE_KEY;
if (!rootId || !rootKey) {
  throw new Error("ROOT_ACCOUNT and ROOT_PRIVATE_KEY are required");
}

const specs = [
  ["TOKEN", "dmusd", 3n * NEAR],
  ["ESCROW", "escrow", (35n * NEAR) / 10n],
  ["RELAYER", "relayer", (12n * NEAR) / 10n],
  ["SENDER", "sender", (35n * NEAR) / 100n],
  ["FOUNDER", "founder", (4n * NEAR) / 10n],
];

for (const [name, prefix] of specs) {
  env[`${name}_ACCOUNT`] = env[`${name}_ACCOUNT`] || `${prefix}.${rootId}`;
}

const txs = {};

async function ensureSubaccount(name) {
  const accountId = env[`${name}_ACCOUNT`];
  if (await exists(accountId)) {
    console.log(`exists ${accountId}`);
    if (!env[`${name}_PRIVATE_KEY`]) {
      throw new Error(`${accountId} exists but ${name}_PRIVATE_KEY is missing from ${KEYS_FILE}`);
    }
    return;
  }
  const key = freshKey();
  env[`${name}_PRIVATE_KEY`] = key.secret;
  saveEnv(env);
  const root = account(rootId, rootKey);
  const spec = specs.find(([label]) => label === name);
  const result = await root.createSubAccount({
    accountOrPrefix: accountId,
    publicKey: key.publicKey,
    nearToTransfer: spec[2],
  });
  txs[`create${name}`] = txHash(result);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await exists(accountId)) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.log(`created ${accountId} ${txs[`create${name}`]}`);
}

async function deployWasm(name, wasmFile, init) {
  const accountId = env[`${name}_ACCOUNT`];
  const signer = account(accountId, env[`${name}_PRIVATE_KEY`]);
  const wasm = fs.readFileSync(path.join(REPO_ROOT, "target/wasm32-unknown-unknown/release", wasmFile));
  const deployed = await signer.deployContract(wasm);
  txs[`deploy${name}`] = txHash(deployed);
  console.log(`deployed ${accountId} ${txs[`deploy${name}`]} (${wasm.length} bytes)`);
  try {
    const initialized = await send(signer, accountId, "new", init, { gas: 30 });
    txs[`init${name}`] = txHash(initialized);
    console.log(`initialized ${accountId} ${txs[`init${name}`]}`);
  } catch (error) {
    const text = explain(error);
    if (!text.includes("already been initialized") && !text.includes("already initialized")) {
      throw error;
    }
    console.log(`already initialized ${accountId}`);
  }
}

try {
  for (const [name] of specs) {
    await ensureSubaccount(name);
  }
  saveEnv(env);

  await deployWasm("TOKEN", "dmusd.wasm", { owner_id: rootId });
  await deployWasm("ESCROW", "escrow.wasm", {
    token: env.TOKEN_ACCOUNT,
    owner_id: rootId,
    default_timeout_seconds: 72 * 60 * 60,
  });

  const root = account(rootId, rootKey);
  for (const accountId of [env.ESCROW_ACCOUNT, env.SENDER_ACCOUNT, env.FOUNDER_ACCOUNT]) {
    const balance = await view(env.TOKEN_ACCOUNT, "storage_balance_of", { account_id: accountId });
    if (balance) {
      console.log(`registered ${accountId}`);
      continue;
    }
    const result = await send(
      root,
      env.TOKEN_ACCOUNT,
      "storage_deposit",
      { account_id: accountId, registration_only: true },
      { gas: 30, deposit: STORAGE_DEPOSIT },
    );
    console.log(`registered ${accountId} ${txHash(result)}`);
  }

  const senderBalance = BigInt(
    (await view(env.TOKEN_ACCOUNT, "ft_balance_of", { account_id: env.SENDER_ACCOUNT })) || "0",
  );
  if (senderBalance < 1_000_000_000n) {
    const minted = await send(
      root,
      env.TOKEN_ACCOUNT,
      "mint",
      { account_id: env.SENDER_ACCOUNT, amount: "1000000000" },
      { gas: 30 },
    );
    txs.mint = txHash(minted);
    console.log(`minted 1000 dmUSD to sender ${txs.mint}`);
  } else {
    console.log(`sender already holds ${senderBalance} raw dmUSD`);
  }

  const config = await view(env.ESCROW_ACCOUNT, "get_config", {});
  const disclaimer = await view(env.TOKEN_ACCOUNT, "disclaimer", {});
  const network = {
    network: "testnet",
    rpc: "https://test.rpc.fastnear.com",
    escrow: env.ESCROW_ACCOUNT,
    token: env.TOKEN_ACCOUNT,
    founder: env.FOUNDER_ACCOUNT,
    sender: env.SENDER_ACCOUNT,
    relayer: env.RELAYER_ACCOUNT,
    root: rootId,
    decimals: 6,
    symbol: "dmUSD",
    defaultTimeoutSeconds: Number(config.default_timeout_seconds),
    disclaimer,
    txs,
    demo: null,
  };
  const out = path.join(REPO_ROOT, "web/public/network.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(network, null, 2)}\n`);
  fs.mkdirSync(path.join(REPO_ROOT, "docs"), { recursive: true });
  fs.writeFileSync(path.join(REPO_ROOT, "docs/tx-log.json"), `${JSON.stringify(network, null, 2)}\n`);
  console.log("wrote web/public/network.json");
  console.log(JSON.stringify(txs, null, 2));
} catch (error) {
  console.error(explain(error));
  process.exit(1);
}
