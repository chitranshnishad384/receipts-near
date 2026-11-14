import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./chain.mjs";
import { openWithMeta, refundThread, replyToThread } from "./flow.mjs";

const releaseMessage =
  "June — we land about 300kg on Fridays and our card payout sits for a week. Are you taking new regional boats this quarter?";
const releaseReply =
  "Yes, under 400kg. Send the harbor and the landing day and I will hold a Friday slot.";
const refundMessage =
  "Nico, the group head on our Linea Mini failed mid-service. Do you still sell the gasket kit, or only the manual?";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const networkPath = path.join(REPO_ROOT, "web/public/network.json");
const network = JSON.parse(fs.readFileSync(networkPath, "utf8"));

const opened = await openWithMeta({
  handle: "june-okonkwo",
  message: releaseMessage,
  amount: "30000000",
  timeoutSeconds: 72 * 60 * 60,
});
console.log(`opened release thread ${opened.threadId} via meta-tx ${opened.hash}`);
console.log(`outer signer ${opened.signer}, token sender ${opened.sender}`);

const replied = await replyToThread(opened.threadId, releaseReply);
console.log(`reply ${replied.hash} status ${replied.thread.status}`);
if (replied.thread.status !== "Released") {
  throw new Error(`expected Released, got ${replied.thread.status}`);
}

const pending = await openWithMeta({
  handle: "nico-feld",
  message: refundMessage,
  amount: "5000000",
  timeoutSeconds: 120,
});
console.log(`opened refund thread ${pending.threadId} via meta-tx ${pending.hash}`);
console.log("waiting 130s for the 120s timeout");
await sleep(130_000);

const refunded = await refundThread(pending.threadId);
console.log(`refund ${refunded.hash} status ${refunded.thread.status}`);
if (refunded.thread.status !== "Refunded") {
  throw new Error(`expected Refunded, got ${refunded.thread.status}`);
}

network.demo = {
  releaseThreadId: opened.threadId,
  refundThreadId: pending.threadId,
  txs: {
    ...(network.txs || {}),
    openRelease: opened.hash,
    reply: replied.hash,
    openRefund: pending.hash,
    refund: refunded.hash,
  },
};
network.txs = network.demo.txs;
fs.writeFileSync(networkPath, `${JSON.stringify(network, null, 2)}\n`);
fs.mkdirSync(path.join(REPO_ROOT, "docs"), { recursive: true });
fs.writeFileSync(path.join(REPO_ROOT, "docs/tx-log.json"), `${JSON.stringify(network, null, 2)}\n`);
console.log("demo flow complete");
console.log(JSON.stringify(network.demo, null, 2));
