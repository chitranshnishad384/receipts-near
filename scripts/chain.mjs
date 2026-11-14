import fs from "node:fs";
import path from "node:path";
import { Account, KeyPair, actions, teraToGas } from "near-api-js";

export const RPC_URL = process.env.RPC_URL || "https://test.rpc.fastnear.com";
export const KEYS_FILE =
  process.env.KEYS_FILE || "/home/ubuntu/.near-receipts-keys/demo.env";
export const NEAR = 10n ** 24n;
export const STORAGE_DEPOSIT = 1_250_000_000_000_000_000_000n;
export const REPO_ROOT = path.resolve(import.meta.dirname, "..");

if (!RPC_URL.includes("testnet") && !RPC_URL.includes("://test.")) {
  throw new Error(`Refusing RPC that does not look like testnet: ${RPC_URL}`);
}

export function loadEnv(file = KEYS_FILE) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

export function saveEnv(env, file = KEYS_FILE) {
  const body = Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${body}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export function account(accountId, secret) {
  if (!accountId?.endsWith(".testnet")) {
    throw new Error(`Refusing non-testnet account ${accountId}`);
  }
  return new Account(accountId, RPC_URL, secret);
}

export function freshKey() {
  const key = KeyPair.fromRandom("ed25519");
  return {
    publicKey: key.getPublicKey().toString(),
    secret: key.toString(),
  };
}

export async function view(contractId, method, args = {}) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "receipts-view",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contractId,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      },
    }),
  });
  const json = await response.json();
  if (json.error) {
    const message = json.error.message || json.error.data || JSON.stringify(json.error);
    const error = new Error(message);
    error.code = json.error.cause?.name;
    throw error;
  }
  return JSON.parse(Buffer.from(json.result.result).toString("utf8"));
}

export function txHash(result) {
  return result?.transaction?.hash || result?.transaction_outcome?.id || null;
}

export function outcomeLogs(result) {
  const logs = [];
  for (const receipt of result?.receipts_outcome || []) {
    for (const line of receipt.outcome?.logs || []) logs.push(line);
  }
  return logs;
}

export function threadIdFromLogs(result) {
  for (const line of outcomeLogs(result)) {
    const match = line.match(/receipts:thread=(\d+)/);
    if (match) return Number(match[1]);
  }
  return null;
}

export function assertSuccess(result) {
  const failures = [];
  const parts = [result?.transaction_outcome, ...(result?.receipts_outcome || [])];
  for (const part of parts) {
    const status = part?.outcome?.status;
    if (status?.Failure || status?.failure) {
      failures.push(JSON.stringify(status).slice(0, 800));
    }
  }
  if (result?.status?.Failure || result?.status?.failure) {
    failures.push(JSON.stringify(result.status).slice(0, 800));
  }
  if (failures.length) {
    throw new Error(failures.join("\n"));
  }
}

export function explain(error) {
  const result = error?.transactionResult || error?.cause?.transactionResult;
  if (!result) return error?.stack || String(error);
  const status = result.status || result.transaction_outcome?.outcome?.status;
  return `${error.message}\n${JSON.stringify(status, null, 2).slice(0, 2000)}`;
}

export async function exists(accountId) {
  try {
    await viewAccount(accountId);
    return true;
  } catch (error) {
    const text = String(error.message || error);
    if (text.includes("does not exist") || text.includes("UNKNOWN_ACCOUNT")) return false;
    throw error;
  }
}

async function viewAccount(accountId) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "account",
      method: "query",
      params: {
        request_type: "view_account",
        finality: "final",
        account_id: accountId,
      },
    }),
  });
  const json = await response.json();
  if (json.error) {
    const detail = json.error.data || json.error.cause?.name || "";
    throw new Error(`${json.error.message || "rpc error"} ${detail}`.trim());
  }
  return json.result;
}

export async function send(signer, contractId, methodName, args, { gas = 80, deposit = 0n } = {}) {
  const result = await signer.callFunctionRaw({
    contractId,
    methodName,
    args,
    gas: teraToGas(gas),
    deposit,
    waitUntil: "FINAL",
  });
  assertSuccess(result);
  return result;
}

export function transferCallAction({ escrowId, founderId, handle, message, amount, timeoutSeconds }) {
  return actions.functionCall(
    "ft_transfer_call",
    {
      receiver_id: escrowId,
      amount: String(amount),
      memo: "receipts pay-to-dm",
      msg: JSON.stringify({
        founder: founderId,
        handle,
        message,
        timeout_seconds: timeoutSeconds,
      }),
    },
    teraToGas(80),
    1n,
  );
}
