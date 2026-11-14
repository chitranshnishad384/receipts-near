import assert from "node:assert/strict";
import test from "node:test";
import { handle } from "../src/index.js";
import { publicError, timingSafeEqual } from "../src/policy.js";

const env = {
  RPC_URL: "https://test.rpc.fastnear.com",
  TOKEN_ACCOUNT: "dmusd.rcpt14c055.testnet",
  ESCROW_ACCOUNT: "escrow.rcpt14c055.testnet",
  RELAYER_ACCOUNT: "relayer.rcpt14c055.testnet",
  SENDER_ACCOUNT: "sender.rcpt14c055.testnet",
  FOUNDER_ACCOUNT: "founder.rcpt14c055.testnet",
  ALLOWED_ORIGINS: "https://receipts-near.pages.dev,http://127.0.0.1:5173",
};

function call(path, { method = "POST", body, headers = {} } = {}) {
  return handle(
    new Request(`https://relayer.test${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}

test("health does not claim it can sign when keys are absent", async () => {
  const response = await call("/health", { method: "GET" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, network: "testnet", signing: false });
});

test("a valid open without keys returns 503 and does not sign", async () => {
  const response = await call("/open", {
    body: { handle: "june-okonkwo", message: "hello", amount: "30000000", timeoutSeconds: 259200 },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "relayer keys are not configured");
});

test("rejects a price that is not one of the five samples", async () => {
  const response = await call("/open", {
    body: { handle: "june-okonkwo", message: "hello", amount: "1", timeoutSeconds: 120 },
  });
  assert.equal(response.status, 400);
});

test("rejects mainnet RPC and non-testnet accounts", async () => {
  const mainnet = await handle(new Request("https://relayer.test/health"), {
    ...env,
    RPC_URL: "https://rpc.mainnet.near.org",
  });
  assert.equal(mainnet.status, 500);
  const account = await handle(new Request("https://relayer.test/health"), {
    ...env,
    ESCROW_ACCOUNT: "escrow.near",
  });
  assert.equal(account.status, 500);
  assert.match((await account.json()).error, /non-testnet/);
});

test("browser origins outside the allowlist are refused", async () => {
  const response = await call("/health", {
    method: "GET",
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("the pages origin is echoed", async () => {
  const response = await call("/health", {
    method: "GET",
    headers: { Origin: "https://receipts-near.pages.dev" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://receipts-near.pages.dev");
});

test("a bearer token is required only when RELAYER_TOKEN is set", async () => {
  const locked = { ...env, RELAYER_TOKEN: "desk-token" };
  const missing = await handle(
    new Request("https://relayer.test/refund", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId: 2 }),
    }),
    locked,
  );
  assert.equal(missing.status, 401);
  const wrong = await handle(
    new Request("https://relayer.test/refund", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer other" },
      body: JSON.stringify({ threadId: 2 }),
    }),
    locked,
  );
  assert.equal(wrong.status, 401);
  const ok = await handle(
    new Request("https://relayer.test/refund", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer desk-token" },
      body: JSON.stringify({ threadId: 2 }),
    }),
    locked,
  );
  assert.equal(ok.status, 503);
});

test("timingSafeEqual does not treat different lengths as equal", () => {
  assert.equal(timingSafeEqual("desk-token", "desk-token"), true);
  assert.equal(timingSafeEqual("desk-token", "desk-tokex"), false);
  assert.equal(timingSafeEqual("short", "much-longer"), false);
});

test("public errors redact secrets", () => {
  assert.equal(publicError(new Error("bad ed25519:abcDEF123 key")), "bad ed25519:[redacted] key");
});
