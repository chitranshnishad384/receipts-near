import http from "node:http";
import { explain } from "./chain.mjs";
import { openWithMeta, refundThread, replyToThread } from "./flow.mjs";

const ALLOWED_AMOUNTS = new Set(["5000000", "8000000", "12000000", "20000000", "30000000"]);
const ALLOWED_TIMEOUTS = new Set([120, 259200]);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 20_000) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  try {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, { ok: true, network: "testnet" });
    }
    if (req.method !== "POST") return send(res, 404, { error: "not found" });
    const body = await readBody(req);
    if (url.pathname === "/open") {
      const handle = String(body.handle || "");
      const message = String(body.message || "").trim();
      const amount = String(body.amount || "");
      const timeoutSeconds = Number(body.timeoutSeconds);
      if (!/^[a-z0-9-]{1,32}$/.test(handle)) return send(res, 400, { error: "invalid handle" });
      if (!message || message.length > 500) return send(res, 400, { error: "invalid message" });
      if (!ALLOWED_AMOUNTS.has(amount)) return send(res, 400, { error: "amount is not a sample price" });
      if (!ALLOWED_TIMEOUTS.has(timeoutSeconds)) return send(res, 400, { error: "timeout must be 120 or 259200 seconds" });
      const opened = await openWithMeta({ handle, message, amount, timeoutSeconds });
      return send(res, 200, opened);
    }
    if (url.pathname === "/reply") {
      const threadId = Number(body.threadId);
      const text = String(body.text || "").trim();
      if (!Number.isInteger(threadId) || threadId < 1) return send(res, 400, { error: "invalid thread" });
      if (!text || text.length > 1000) return send(res, 400, { error: "invalid reply" });
      return send(res, 200, await replyToThread(threadId, text));
    }
    if (url.pathname === "/refund") {
      const threadId = Number(body.threadId);
      if (!Number.isInteger(threadId) || threadId < 1) return send(res, 400, { error: "invalid thread" });
      return send(res, 200, await refundThread(threadId));
    }
    return send(res, 404, { error: "not found" });
  } catch (error) {
    console.error(explain(error));
    return send(res, 500, { error: error.message || "relayer failed" });
  }
});

server.listen(8788, "127.0.0.1", () => {
  console.log("relayer on http://127.0.0.1:8788");
});
