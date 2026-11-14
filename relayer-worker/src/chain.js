import { Account, actions, teraToGas } from "near-api-js";

function signer(accountId, secret, rpc) {
  if (!String(accountId).endsWith(".testnet")) {
    throw new Error(`Refusing non-testnet account ${accountId}`);
  }
  if (typeof secret !== "string" || !secret.startsWith("ed25519:")) {
    throw new Error("Refusing a key that is not an ed25519 secret");
  }
  if (String(rpc).includes("mainnet")) {
    throw new Error("Refusing RPC that does not look like testnet");
  }
  return new Account(accountId, rpc, secret);
}

async function view(rpc, contractId, method, args) {
  const response = await fetch(rpc, {
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
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
  });
  const json = await response.json();
  if (json.error) {
    throw new Error(json.error.message || "NEAR view call failed");
  }
  const bytes = Uint8Array.from(json.result.result);
  return JSON.parse(new TextDecoder().decode(bytes));
}

function outcomeLogs(result) {
  const logs = [];
  for (const receipt of result?.receipts_outcome || []) {
    for (const line of receipt.outcome?.logs || []) logs.push(line);
  }
  return logs;
}

function threadIdFromLogs(result) {
  for (const line of outcomeLogs(result)) {
    const match = line.match(/receipts:thread=(\d+)/);
    if (match) return Number(match[1]);
  }
  return null;
}

export function txHash(result) {
  return result?.transaction?.hash || result?.transaction_outcome?.id || null;
}

function assertSuccess(result) {
  const failures = [];
  const parts = [result?.transaction_outcome, ...(result?.receipts_outcome || [])];
  for (const part of parts) {
    const status = part?.outcome?.status;
    if (status?.Failure || status?.failure) failures.push(JSON.stringify(status).slice(0, 400));
  }
  if (result?.status?.Failure || result?.status?.failure) {
    failures.push(JSON.stringify(result.status).slice(0, 400));
  }
  if (failures.length) throw new Error(failures.join("\n"));
}

async function settledThread(rpc, escrowId, threadId, expected) {
  let thread = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    thread = await view(rpc, escrowId, "get_thread", { thread_id: threadId });
    if (thread?.status === expected || thread?.status === "Open") return thread;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return thread;
}

export async function openWithMeta(env, { handle, message, amount, timeoutSeconds }) {
  const sender = signer(env.SENDER_ACCOUNT, env.SENDER_PRIVATE_KEY, env.RPC_URL);
  const relayer = signer(env.RELAYER_ACCOUNT, env.RELAYER_PRIVATE_KEY, env.RPC_URL);
  const { signedDelegate } = await sender.createSignedMetaTransaction({
    receiverId: env.TOKEN_ACCOUNT,
    actions: [
      actions.functionCall(
        "ft_transfer_call",
        {
          receiver_id: env.ESCROW_ACCOUNT,
          amount: String(amount),
          memo: "receipts pay-to-dm",
          msg: JSON.stringify({
            founder: env.FOUNDER_ACCOUNT,
            handle,
            message,
            timeout_seconds: timeoutSeconds,
          }),
        },
        teraToGas(80),
        1n,
      ),
    ],
    blockHeightTtl: 200,
  });
  const result = await relayer.relayMetaTransaction(signedDelegate);
  assertSuccess(result);
  const hash = txHash(result);
  let threadId = threadIdFromLogs(result);
  let thread = null;
  for (let attempt = 0; attempt < 8 && !thread; attempt += 1) {
    if (!threadId) {
      const listed = await view(env.RPC_URL, env.ESCROW_ACCOUNT, "list_threads", { from_index: 0, limit: 20 });
      const match = listed.find((item) => item.sender === env.SENDER_ACCOUNT && item.message === message);
      threadId = match?.id ?? null;
    }
    if (threadId) thread = await view(env.RPC_URL, env.ESCROW_ACCOUNT, "get_thread", { thread_id: threadId });
    if (!thread) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!threadId || !thread) {
    throw new Error(`meta-transaction ${hash || ""} did not open a thread`);
  }
  return { hash, threadId, thread, signer: env.RELAYER_ACCOUNT, sender: env.SENDER_ACCOUNT };
}

export async function replyToThread(env, threadId, text) {
  const founder = signer(env.FOUNDER_ACCOUNT, env.FOUNDER_PRIVATE_KEY, env.RPC_URL);
  const result = await founder.callFunctionRaw({
    contractId: env.ESCROW_ACCOUNT,
    methodName: "reply",
    args: { thread_id: threadId, text },
    gas: teraToGas(80),
    deposit: 0n,
    waitUntil: "FINAL",
  });
  assertSuccess(result);
  const thread = await settledThread(env.RPC_URL, env.ESCROW_ACCOUNT, threadId, "Released");
  return { hash: txHash(result), thread };
}

export async function refundThread(env, threadId) {
  const relayer = signer(env.RELAYER_ACCOUNT, env.RELAYER_PRIVATE_KEY, env.RPC_URL);
  const result = await relayer.callFunctionRaw({
    contractId: env.ESCROW_ACCOUNT,
    methodName: "refund",
    args: { thread_id: threadId },
    gas: teraToGas(80),
    deposit: 0n,
    waitUntil: "FINAL",
  });
  assertSuccess(result);
  const thread = await settledThread(env.RPC_URL, env.ESCROW_ACCOUNT, threadId, "Refunded");
  return { hash: txHash(result), thread };
}
