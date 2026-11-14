import { useEffect, useState } from "react";
import { founderByHandle, founders } from "./data/founders";
import { accountUrl, formatAmount, formatNs, shortHash, txUrl } from "./format";
import {
  getThread,
  listThreads,
  loadNetwork,
  relayerBase,
  relayerConfigured,
  relayerHealth,
  relayerPost,
  tokenBalance,
} from "./near";
import { dryQuote, originChains, type OriginChain } from "./quote";
import type { Network, Quote, Thread } from "./types";

type Route =
  | { name: "home" }
  | { name: "founder"; handle: string }
  | { name: "checkout"; handle: string }
  | { name: "thread"; id: number }
  | { name: "desk" };

type Draft = { handle: string; message: string; timeoutSeconds: number };

function readRoute(): Route {
  const parts = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "f" && parts[1]) return { name: "founder", handle: parts[1] };
  if (parts[0] === "checkout" && parts[1]) return { name: "checkout", handle: parts[1] };
  if (parts[0] === "t" && parts[1]) return { name: "thread", id: Number(parts[1]) };
  if (parts[0] === "desk") return { name: "desk" };
  return { name: "home" };
}

function go(hash: string) {
  window.location.hash = hash;
}

function draftKey(handle: string) {
  return `receipts-draft:${handle}`;
}

function readDraft(handle: string): Draft {
  const fallback = { handle, message: "", timeoutSeconds: 259200 };
  const raw = sessionStorage.getItem(draftKey(handle));
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Draft;
    return { ...fallback, ...parsed, handle };
  } catch {
    return fallback;
  }
}

export function App() {
  const [network, setNetwork] = useState<Network | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(readRoute());

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    loadNetwork().then(setNetwork).catch((reason: Error) => setError(reason.message));
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div className="shell">
      <header className="top">
        <a className="brand" href="#/">
          <strong>Receipts</strong>
          <span>Pay-to-DM escrow on NEAR testnet</span>
        </a>
        <nav>
          <a href="#/">Founders</a>
          <a href="#/desk">Inbox</a>
          {network && (
            <a href={accountUrl(network.escrow)} target="_blank" rel="noreferrer">
              Escrow
            </a>
          )}
        </nav>
      </header>
      <p className="banner">
        NEAR testnet · dmUSD is a stand-in token, not Circle USDC · 1Click quotes are dry and move no funds
      </p>
      <main className="page">
        {error && <p className="error">{error}</p>}
        {!network && !error && <p>Reading the static config…</p>}
        {network && route.name === "home" && <Home />}
        {network && route.name === "founder" && (
          <FounderPage key={route.handle} network={network} handle={route.handle} />
        )}
        {network && route.name === "checkout" && (
          <Checkout key={route.handle} network={network} handle={route.handle} />
        )}
        {network && route.name === "thread" && (
          <ThreadPage key={route.id} network={network} id={route.id} />
        )}
        {network && route.name === "desk" && <Desk network={network} />}
      </main>
    </div>
  );
}

function Home() {
  return (
    <section data-testid="directory">
      <p className="kicker">Sample directory</p>
      <h1>Message a founder. The fee waits.</h1>
      <p className="lede">
        Cold notes are free, so they get ignored. Receipts holds the fee until the founder replies.
        Silence returns it. Everyone below is fictional, including the revenue figure.
      </p>
      <div className="grid" data-testid="founder-grid">
        {founders.map((founder) => (
          <a className="card" key={founder.handle} href={`#/f/${founder.handle}`}>
            <p className="kicker">{founder.city}</p>
            <h2 className="company">{founder.company}</h2>
            <p className="meta">
              {founder.name} · {founder.blurb}
            </p>
            <div className="arr">
              <span>
                <strong>{founder.sampleArr}</strong>
                <span className="fiction"> fictional sample ARR</span>
              </span>
              <span className="price">{formatAmount(founder.priceRaw)} dmUSD</span>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

function FounderPage({ network, handle }: { network: Network; handle: string }) {
  const founder = founderByHandle(handle);
  const [draft, setDraft] = useState<Draft>(() => readDraft(handle));
  if (!founder) return <p className="error">No sample founder named {handle}.</p>;
  return (
    <section className="split">
      <div className="profile">
        <p className="kicker">{founder.city} · fictional sample</p>
        <h1>{founder.company}</h1>
        <p className="lede">
          {founder.name}. {founder.blurb} The {founder.sampleArr} figure is made up for this demo.
          It is not self-reported revenue and it is not verified on chain.
        </p>
        <p className="fine">
          Replies on this demo are signed by one shared inbox,{" "}
          <a href={accountUrl(network.founder)}>{network.founder}</a>, so a judge can answer without
          five keys. The handle is stored with the thread.
        </p>
      </div>
      <form
        className="receipt"
        onSubmit={(event) => {
          event.preventDefault();
          sessionStorage.setItem(draftKey(handle), JSON.stringify(draft));
          go(`#/checkout/${handle}`);
        }}
      >
        <header>
          <h2>New message</h2>
          <span className="price">{formatAmount(founder.priceRaw)} dmUSD</span>
        </header>
        <label htmlFor="message">What do you want to ask?</label>
        <textarea
          id="message"
          required
          maxLength={500}
          value={draft.message}
          onChange={(event) => setDraft({ ...draft, message: event.target.value })}
        />
        <div className="choices">
          <label>
            <input
              type="radio"
              name="timeout"
              checked={draft.timeoutSeconds === 259200}
              onChange={() => setDraft({ ...draft, timeoutSeconds: 259200 })}
            />
            72 hours
          </label>
          <label>
            <input
              type="radio"
              name="timeout"
              checked={draft.timeoutSeconds === 120}
              onChange={() => setDraft({ ...draft, timeoutSeconds: 120 })}
            />
            2 minutes, for the refund demo
          </label>
        </div>
        <button className="button" type="submit" disabled={draft.message.trim().length === 0}>
          Continue to dry quote
        </button>
      </form>
    </section>
  );
}

function Checkout({ network, handle }: { network: Network; handle: string }) {
  const founder = founderByHandle(handle);
  const draft = readDraft(handle);
  const [chain, setChain] = useState<OriginChain>(originChains[0]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const configured = relayerConfigured();
  const [relayerUp, setRelayerUp] = useState<boolean | null>(configured ? null : false);
  const [pending, setPending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setQuote(null);
    setQuoteError(null);
    if (!founder) return;
    dryQuote(chain, founder.priceRaw)
      .then((next) => {
        if (!cancelled) setQuote(next);
      })
      .catch((reason: Error) => {
        if (!cancelled) setQuoteError(reason.message);
      });
    if (!configured) {
      return () => {
        cancelled = true;
      };
    }
    relayerHealth().then((ok) => {
      if (!cancelled) setRelayerUp(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [chain, founder, configured]);

  if (!founder) return <p className="error">No sample founder named {handle}.</p>;
  if (!draft.message.trim()) {
    return (
      <p>
        Write the message first. <a href={`#/f/${handle}`}>Back to {founder.name}</a>
      </p>
    );
  }

  async function deposit() {
    if (!founder || !relayerConfigured()) return;
    setPending(true);
    setSendError(null);
    try {
      const opened = await relayerPost<{ threadId: number; hash: string }>("/open", {
        handle: founder.handle,
        message: draft.message.trim(),
        amount: founder.priceRaw,
        timeoutSeconds: draft.timeoutSeconds,
      });
      sessionStorage.setItem(`receipts-tx:${opened.threadId}`, opened.hash);
      go(`#/t/${opened.threadId}`);
    } catch (reason) {
      setSendError(reason instanceof Error ? reason.message : "Deposit failed");
      setPending(false);
    }
  }

  return (
    <section className="split" data-testid="checkout">
      <article className="receipt">
        <p className="kicker">Message fee</p>
        <h2>{founder.company}</h2>
        <p className="message">{draft.message}</p>
        <hr className="dash" />
        <div className="row">
          <span>Locked until reply</span>
          <strong>{formatAmount(founder.priceRaw)} dmUSD</strong>
        </div>
        <div className="row">
          <span>Refund if no reply</span>
          <span>{draft.timeoutSeconds === 120 ? "2 minutes" : "72 hours"}</span>
        </div>
        <p className="fine">
          The lock is {network.symbol} on {network.escrow}. {network.disclaimer}
        </p>
      </article>
      <aside className="panel" style={{ padding: 22 }} data-testid="quote-panel">
        <p className="kicker">Replaces a card checkout</p>
        <h2 style={{ fontFamily: "Fraunces, Georgia, serif", margin: "0 0 8px" }}>Pay from any chain</h2>
        <p className="fine">
          A live NEAR Intents 1Click quote with <span className="mono">dry: true</span>. No deposit
          address is created and nothing is swapped. The placeholder recipient is intents.near.
        </p>
        <div className="chains">
          {originChains.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === chain.id}
              onClick={() => setChain(item)}
            >
              {item.label} USDC
            </button>
          ))}
        </div>
        {quoteError && <p className="error">{quoteError}</p>}
        {!quote && !quoteError && <p>Asking 1Click for a dry quote…</p>}
        {quote && (
          <div data-testid="quote-result">
            <p className="quote-figure">
              {quote.amountInFormatted} <span style={{ fontSize: 22 }}>USDC</span>
            </p>
            <p>
              on {chain.label} delivers about {quote.amountOutFormatted} USDC on NEAR
              {quote.timeEstimate ? ` · ~${quote.timeEstimate}s` : ""}.
            </p>
            <p className="fine">No deposit address on this quote. The testnet lock is separate.</p>
          </div>
        )}
        <div className="actions" style={{ marginTop: 16 }}>
          <button
            className="button"
            type="button"
            disabled={!configured || relayerUp !== true || pending}
            onClick={deposit}
          >
            {pending ? "Signing meta-transaction…" : "Lock dmUSD, relayer pays gas"}
          </button>
        </div>
        {sendError && <p className="error">{sendError}</p>}
        {!configured && <DemoLockNote network={network} />}
        {configured && relayerUp === false && (
          <p className="fine">
            The relayer at <span className="mono">{relayerBase()}</span> is not responding, so the lock
            stays off. Threads already on testnet can still be read.
          </p>
        )}
      </aside>
    </section>
  );
}

function ThreadPage({ network, id }: { network: Network; id: number }) {
  const [thread, setThread] = useState<Thread | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => BigInt(Date.now()) * 1_000_000n);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getThread(network, id)
      .then((next) => {
        if (!cancelled) setThread(next);
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      });
    Promise.all([
      tokenBalance(network, network.sender),
      tokenBalance(network, network.escrow),
      tokenBalance(network, network.founder),
    ])
      .then(([sender, escrow, founder]) => {
        if (!cancelled) setBalances({ sender, escrow, founder });
      })
      .catch(() => undefined);
    const timer = window.setInterval(() => setNow(BigInt(Date.now()) * 1_000_000n), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [network, id]);

  if (error) return <p className="error">{error}</p>;
  if (thread === undefined) return <p>Reading thread {id} from testnet…</p>;
  if (!thread) return <p className="error">Thread {id} is not on the escrow.</p>;

  const founder = founderByHandle(thread.handle);
  const status = String(thread.status).toLowerCase();
  const due = BigInt(thread.deadline_ns) <= now && status === "open";
  const demoTx = demoTxFor(network, thread.id);
  const sessionTx = sessionStorage.getItem(`receipts-tx:${thread.id}`);

  async function refund() {
    if (!relayerConfigured()) return;
    setPending(true);
    setError(null);
    try {
      const result = await relayerPost<{ hash: string }>("/refund", { threadId: thread!.id });
      sessionStorage.setItem(`receipts-refund:${thread!.id}`, result.hash);
      const next = await getThread(network, thread!.id);
      setThread(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Refund failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="receipt" data-testid="thread">
      <header>
        <div>
          <p className="kicker">Thread {thread.id}</p>
          <h2>{founder?.company || thread.handle}</h2>
        </div>
        <span className={`stamp ${status}`} data-testid="thread-status">
          {status}
        </span>
      </header>
      <p className="message">{thread.message}</p>
      {thread.reply && (
        <>
          <hr className="dash" />
          <p className="kicker">Reply</p>
          <p className="message">{thread.reply}</p>
        </>
      )}
      <hr className="dash" />
      <div className="row">
        <span>Amount</span>
        <strong>
          {formatAmount(thread.amount)} {network.symbol}
        </strong>
      </div>
      <div className="row">
        <span>Reply deadline</span>
        <span>{formatNs(thread.deadline_ns)}</span>
      </div>
      <div className="row">
        <span>From</span>
        <a className="mono" href={accountUrl(thread.sender)}>
          {thread.sender}
        </a>
      </div>
      <TxLinks demoTx={demoTx} sessionTx={sessionTx} refundTx={sessionStorage.getItem(`receipts-refund:${thread.id}`)} />
      {due && (
        <div className="actions" style={{ marginTop: 14 }}>
          <button className="button" type="button" disabled={!relayerConfigured() || pending} onClick={refund}>
            {pending ? "Refunding…" : "Refund to sender"}
          </button>
        </div>
      )}
      {due && !relayerConfigured() && <DemoLockNote network={network} />}
      <BalanceRow network={network} balances={balances} />
    </article>
  );
}

function TxLinks({
  demoTx,
  sessionTx,
  refundTx,
}: {
  demoTx: { open?: string; settle?: string } | null;
  sessionTx: string | null;
  refundTx: string | null;
}) {
  const links = [
    ["Opened", demoTx?.open || sessionTx],
    ["Settled", demoTx?.settle || refundTx],
  ].filter((item): item is [string, string] => Boolean(item[1]));
  if (!links.length) return null;
  return (
    <p className="mono">
      {links.map(([label, hash]) => (
        <a key={label} href={txUrl(hash)} target="_blank" rel="noreferrer" style={{ marginRight: 16 }}>
          {label} {shortHash(hash)}
        </a>
      ))}
    </p>
  );
}

function DemoLockNote({ network }: { network: Network }) {
  const demo = network.demo;
  if (!demo?.txs.reply || !demo.txs.refund) {
    return (
      <p className="fine" data-testid="demo-mode">
        Demo mode. This build has no relayer URL, so a new fee cannot be locked from the browser.
      </p>
    );
  }
  return (
    <p className="fine" data-testid="demo-mode">
      Demo mode. This build has no relayer URL, so a new fee cannot be locked from the browser and
      this page does not contact a relayer.{" "}
      <a href={`#/t/${demo.releaseThreadId}`}>Thread {demo.releaseThreadId}</a> was{" "}
      <a href={txUrl(demo.txs.reply)} target="_blank" rel="noreferrer">
        Released
      </a>{" "}
      and <a href={`#/t/${demo.refundThreadId}`}>thread {demo.refundThreadId}</a> was{" "}
      <a href={txUrl(demo.txs.refund)} target="_blank" rel="noreferrer">
        Refunded
      </a>{" "}
      on NEAR testnet.
    </p>
  );
}

function demoTxFor(network: Network, threadId: number): { open?: string; settle?: string } | null {
  const demo = network.demo;
  if (!demo) return null;
  if (threadId === demo.releaseThreadId) {
    return { open: demo.txs.openRelease, settle: demo.txs.reply };
  }
  if (threadId === demo.refundThreadId) {
    return { open: demo.txs.openRefund, settle: demo.txs.refund };
  }
  return null;
}

function BalanceRow({ network, balances }: { network: Network; balances: Record<string, string> }) {
  if (!balances.sender) return null;
  const rows = [
    ["Sender", balances.sender],
    ["Escrow", balances.escrow],
    ["Founder", balances.founder],
  ];
  return (
    <div className="balances">
      {rows.map(([label, raw]) => (
        <div key={label}>
          <div className="fine">{label}</div>
          <strong>
            {formatAmount(raw || "0")} {network.symbol}
          </strong>
        </div>
      ))}
    </div>
  );
}

function Desk({ network }: { network: Network }) {
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("Yes — send the harbor and the day you land.");
  const [pending, setPending] = useState<number | null>(null);

  async function refresh() {
    setThreads(await listThreads(network));
  }

  useEffect(() => {
    refresh().catch((reason: Error) => setError(reason.message));
  }, [network]);

  async function reply(threadId: number) {
    if (!relayerConfigured()) return;
    setPending(threadId);
    setError(null);
    try {
      await relayerPost("/reply", { threadId, text });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Reply failed");
    } finally {
      setPending(null);
    }
  }

  const visible = (threads || []).filter((thread) => thread.founder === network.founder);
  return (
    <section>
      <p className="kicker">Founder inbox</p>
      <h1>Reply, and the fee is yours.</h1>
      <p className="lede">
        This desk signs as <a href={accountUrl(network.founder)}>{network.founder}</a>
        {relayerConfigured() ? (
          <>
            {" "}
            through the relayer. A reply calls <span className="mono">reply</span> and the escrow pays
            that account in dmUSD.
          </>
        ) : (
          <>
            . This build has no relayer URL, so a reply cannot be signed here.
          </>
        )}
      </p>
      {!relayerConfigured() && <DemoLockNote network={network} />}
      {error && <p className="error">{error}</p>}
      {!threads && !error && <p>Reading threads…</p>}
      <div className="thread-list">
        {visible.map((thread) => {
          const status = String(thread.status).toLowerCase();
          const founder = founderByHandle(thread.handle);
          return (
            <div className="card" key={thread.id} style={{ minHeight: 0 }}>
              <div className="row">
                <a href={`#/t/${thread.id}`}>
                  <strong>{founder?.name || thread.handle}</strong> · thread {thread.id}
                </a>
                <span className={`stamp ${status}`}>{status}</span>
              </div>
              <p className="message">{thread.message}</p>
              {status === "open" && (
                <div className="actions">
                  <input
                    aria-label="Reply"
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    style={{ flex: 1, padding: 10, border: "1px solid var(--line)" }}
                  />
                  <button
                    className="button"
                    type="button"
                    disabled={!relayerConfigured() || pending === thread.id || text.trim().length === 0}
                    onClick={() => reply(thread.id)}
                  >
                    {pending === thread.id ? "Releasing…" : "Reply and release"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {threads && visible.length === 0 && <p>No threads for this inbox yet.</p>}
      </div>
    </section>
  );
}
