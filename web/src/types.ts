export type Network = {
  network: "testnet";
  rpc: string;
  escrow: string;
  token: string;
  founder: string;
  sender: string;
  relayer: string;
  root: string;
  decimals: number;
  symbol: string;
  defaultTimeoutSeconds: number;
  disclaimer: string;
  txs: Record<string, string>;
  demo: {
    releaseThreadId: number;
    refundThreadId: number;
    txs: Record<string, string>;
  } | null;
};

export type Thread = {
  id: number;
  sender: string;
  founder: string;
  handle: string;
  amount: string;
  message: string;
  reply: string | null;
  opened_at_ns: string;
  timeout_ns: string;
  deadline_ns: string;
  status: string;
  resolved_at_ns: string | null;
};

export type Quote = {
  amountInFormatted?: string;
  amountOutFormatted?: string;
  amountInUsd?: string;
  amountOutUsd?: string;
  timeEstimate?: number;
  depositAddress?: string | null;
  minAmountOut?: string;
};
