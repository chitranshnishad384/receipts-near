import type { Network, Thread } from "./types";

export async function loadNetwork(): Promise<Network> {
  const response = await fetch(`${import.meta.env.BASE_URL}network.json`);
  if (!response.ok) throw new Error("network.json is missing from this build");
  return response.json() as Promise<Network>;
}

export async function callView<T>(
  network: Network,
  contractId: string,
  method: string,
  args: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(network.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "receipts",
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
  const bytes = Uint8Array.from(json.result.result as number[]);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export function listThreads(network: Network): Promise<Thread[]> {
  return callView(network, network.escrow, "list_threads", { from_index: 0, limit: 50 });
}

export function getThread(network: Network, threadId: number): Promise<Thread | null> {
  return callView(network, network.escrow, "get_thread", { thread_id: threadId });
}

export function tokenBalance(network: Network, accountId: string): Promise<string> {
  return callView(network, network.token, "ft_balance_of", { account_id: accountId });
}

/** Build-time origin. Empty or unset means this build must not contact a relayer. */
export function relayerBase(): string | null {
  const value = import.meta.env.VITE_RELAYER_URL;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/$/, "");
}

export function relayerConfigured(): boolean {
  return relayerBase() !== null;
}

export async function relayerHealth(): Promise<boolean> {
  const base = relayerBase();
  if (!base) return false;
  try {
    const response = await fetch(`${base}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export async function relayerPost<T>(path: string, body: unknown): Promise<T> {
  const base = relayerBase();
  if (!base) {
    throw new Error("This build has no relayer URL");
  }
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "Relayer rejected the request");
  return json as T;
}
