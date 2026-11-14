import {
  assertTestnetEnv,
  authorized,
  keysReady,
  originDecision,
  publicError,
  validateOpen,
  validateRefund,
  validateReply,
} from "./policy.js";

const MAX_BODY = 20_000;

function json(status, body, origin) {
  const headers = {
    "content-type": "application/json",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    vary: "Origin",
  };
  if (origin) headers["access-control-allow-origin"] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}

async function readJson(request) {
  const declared = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > MAX_BODY) {
    const error = new Error("body too large");
    error.status = 400;
    throw error;
  }
  const text = await request.text();
  if (text.length > MAX_BODY) {
    const error = new Error("body too large");
    error.status = 400;
    throw error;
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("invalid json");
    error.status = 400;
    throw error;
  }
}

async function actionFor(pathname, body, env, origin) {
  if (pathname === "/open") {
    const parsed = validateOpen(body);
    if (!parsed.ok) return json(400, { error: parsed.error }, origin);
    return async () => {
      const { openWithMeta } = await import("./chain.js");
      const opened = await openWithMeta(env, parsed.value);
      console.log(JSON.stringify({ message: "opened thread", threadId: opened.threadId, hash: opened.hash }));
      return opened;
    };
  }
  if (pathname === "/reply") {
    const parsed = validateReply(body);
    if (!parsed.ok) return json(400, { error: parsed.error }, origin);
    return async () => {
      const { replyToThread } = await import("./chain.js");
      const replied = await replyToThread(env, parsed.value.threadId, parsed.value.text);
      console.log(JSON.stringify({ message: "replied", threadId: parsed.value.threadId, hash: replied.hash }));
      return replied;
    };
  }
  if (pathname === "/refund") {
    const parsed = validateRefund(body);
    if (!parsed.ok) return json(400, { error: parsed.error }, origin);
    return async () => {
      const { refundThread } = await import("./chain.js");
      const refunded = await refundThread(env, parsed.value.threadId);
      console.log(JSON.stringify({ message: "refunded", threadId: parsed.value.threadId, hash: refunded.hash }));
      return refunded;
    };
  }
  return json(404, { error: "not found" }, origin);
}

export async function handle(request, env) {
  const decision = originDecision(request, env);
  if (!decision.ok) return json(403, { error: "origin not allowed" }, null);
  if (request.method === "OPTIONS") return json(204, {}, decision.origin);
  try {
    assertTestnetEnv(env);
  } catch (error) {
    console.error(JSON.stringify({ message: "refusing non-testnet config", error: publicError(error) }));
    return json(500, { error: publicError(error) }, decision.origin);
  }

  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return json(200, { ok: true, network: "testnet", signing: keysReady(env) }, decision.origin);
  }
  if (request.method !== "POST") return json(404, { error: "not found" }, decision.origin);
  if (!authorized(request, env)) return json(401, { error: "unauthorized" }, decision.origin);

  try {
    const body = await readJson(request);
    const action = await actionFor(url.pathname, body, env, decision.origin);
    if (action instanceof Response) return action;
    if (!keysReady(env)) {
      return json(503, { error: "relayer keys are not configured" }, decision.origin);
    }
    const result = await action();
    return json(200, result, decision.origin);
  } catch (error) {
    const status = error.status || 500;
    console.error(JSON.stringify({ message: "relayer request failed", error: publicError(error) }));
    return json(status, { error: publicError(error) }, decision.origin);
  }
}

export default {
  fetch(request, env) {
    return handle(request, env);
  },
};
