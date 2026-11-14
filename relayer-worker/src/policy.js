export const ALLOWED_AMOUNTS = new Set(["5000000", "8000000", "12000000", "20000000", "30000000"]);
export const ALLOWED_TIMEOUTS = new Set([120, 259200]);

const ACCOUNT_KEYS = ["TOKEN_ACCOUNT", "ESCROW_ACCOUNT", "RELAYER_ACCOUNT", "SENDER_ACCOUNT", "FOUNDER_ACCOUNT"];

export function assertTestnetEnv(env) {
  const rpc = String(env.RPC_URL || "");
  if (rpc.includes("mainnet") || (!rpc.includes("testnet") && !rpc.includes("://test."))) {
    throw new Error("Refusing RPC that does not look like testnet");
  }
  for (const key of ACCOUNT_KEYS) {
    const id = String(env[key] || "");
    if (!id.endsWith(".testnet")) {
      throw new Error(`Refusing non-testnet account for ${key}`);
    }
  }
}

export function keysReady(env) {
  return ["SENDER_PRIVATE_KEY", "RELAYER_PRIVATE_KEY", "FOUNDER_PRIVATE_KEY"].every((key) =>
    String(env[key] || "").startsWith("ed25519:"),
  );
}

export function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function originDecision(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return { ok: true, origin: null };
  if (allowedOrigins(env).includes(origin)) return { ok: true, origin };
  return { ok: false, origin };
}

export function timingSafeEqual(left, right) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (a[i] || 0) ^ (b[i] || 0);
  }
  return diff === 0;
}

export function authorized(request, env) {
  const token = String(env.RELAYER_TOKEN || "").trim();
  if (!token) return true;
  const header = request.headers.get("Authorization") || "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  return timingSafeEqual(header.slice(prefix.length), token);
}

export function validateOpen(body) {
  const handle = String(body.handle || "");
  const message = String(body.message || "").trim();
  const amount = String(body.amount || "");
  const timeoutSeconds = Number(body.timeoutSeconds);
  if (!/^[a-z0-9-]{1,32}$/.test(handle)) return { ok: false, error: "invalid handle" };
  if (!message || message.length > 500) return { ok: false, error: "invalid message" };
  if (!ALLOWED_AMOUNTS.has(amount)) return { ok: false, error: "amount is not a sample price" };
  if (!ALLOWED_TIMEOUTS.has(timeoutSeconds)) return { ok: false, error: "timeout must be 120 or 259200 seconds" };
  return { ok: true, value: { handle, message, amount, timeoutSeconds } };
}

export function validateReply(body) {
  const threadId = Number(body.threadId);
  const text = String(body.text || "").trim();
  if (!Number.isInteger(threadId) || threadId < 1) return { ok: false, error: "invalid thread" };
  if (!text || text.length > 1000) return { ok: false, error: "invalid reply" };
  return { ok: true, value: { threadId, text } };
}

export function validateRefund(body) {
  const threadId = Number(body.threadId);
  if (!Number.isInteger(threadId) || threadId < 1) return { ok: false, error: "invalid thread" };
  return { ok: true, value: { threadId } };
}

export function publicError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/ed25519:[A-Za-z0-9]+/g, "ed25519:[redacted]").slice(0, 500);
}
