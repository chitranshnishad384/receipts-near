import {
  account,
  loadEnv,
  outcomeLogs,
  send,
  threadIdFromLogs,
  transferCallAction,
  txHash,
  view,
} from "./chain.mjs";

export function actors() {
  const env = loadEnv();
  for (const name of ["TOKEN", "ESCROW", "RELAYER", "SENDER", "FOUNDER"]) {
    if (!env[`${name}_ACCOUNT`] || !env[`${name}_PRIVATE_KEY`]) {
      throw new Error(`Missing ${name}_ACCOUNT or ${name}_PRIVATE_KEY`);
    }
  }
  return {
    env,
    sender: account(env.SENDER_ACCOUNT, env.SENDER_PRIVATE_KEY),
    relayer: account(env.RELAYER_ACCOUNT, env.RELAYER_PRIVATE_KEY),
    founder: account(env.FOUNDER_ACCOUNT, env.FOUNDER_PRIVATE_KEY),
  };
}

export async function openWithMeta({ handle, message, amount, timeoutSeconds }) {
  const { env, sender, relayer } = actors();
  const { signedDelegate } = await sender.createSignedMetaTransaction({
    receiverId: env.TOKEN_ACCOUNT,
    actions: [
      transferCallAction({
        escrowId: env.ESCROW_ACCOUNT,
        founderId: env.FOUNDER_ACCOUNT,
        handle,
        message,
        amount,
        timeoutSeconds,
      }),
    ],
    blockHeightTtl: 200,
  });
  const result = await relayer.relayMetaTransaction(signedDelegate);
  const hash = txHash(result);
  let threadId = threadIdFromLogs(result);
  let thread = null;
  for (let attempt = 0; attempt < 20 && !thread; attempt += 1) {
    if (!threadId) {
      const listed = await view(env.ESCROW_ACCOUNT, "list_threads", { from_index: 0, limit: 20 });
      const match = listed.find((item) => item.sender === env.SENDER_ACCOUNT && item.message === message);
      threadId = match?.id ?? null;
    }
    if (threadId) {
      thread = await view(env.ESCROW_ACCOUNT, "get_thread", { thread_id: threadId });
    }
    if (!thread) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!threadId || !thread) {
    throw new Error(`meta-transaction ${hash} did not open a thread\n${outcomeLogs(result).join("\n")}`);
  }
  return { hash, threadId, thread, signer: env.RELAYER_ACCOUNT, sender: env.SENDER_ACCOUNT };
}

async function settledThread(escrowId, threadId, expected) {
  let thread = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    thread = await view(escrowId, "get_thread", { thread_id: threadId });
    if (thread?.status === expected || thread?.status === "Open") return thread;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return thread;
}

export async function replyToThread(threadId, text) {
  const { env, founder } = actors();
  const result = await send(founder, env.ESCROW_ACCOUNT, "reply", { thread_id: threadId, text }, { gas: 80 });
  const thread = await settledThread(env.ESCROW_ACCOUNT, threadId, "Released");
  return { hash: txHash(result), thread };
}

export async function refundThread(threadId) {
  const { env, relayer } = actors();
  const result = await send(relayer, env.ESCROW_ACCOUNT, "refund", { thread_id: threadId }, { gas: 80 });
  const thread = await settledThread(env.ESCROW_ACCOUNT, threadId, "Refunded");
  return { hash: txHash(result), thread };
}
