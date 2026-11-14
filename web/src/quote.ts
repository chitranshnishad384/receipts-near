import type { Quote } from "./types";

export type OriginChain = {
  id: string;
  label: string;
  assetId: string;
  refundTo: string;
};

/** Asset ids read from GET https://1click.chaindefuser.com/v0/tokens on 2026-11-14. */
export const originChains: OriginChain[] = [
  {
    id: "base",
    label: "Base",
    assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
    refundTo: "0x1111111111111111111111111111111111111111",
  },
  {
    id: "ethereum",
    label: "Ethereum",
    assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near",
    refundTo: "0x1111111111111111111111111111111111111111",
  },
  {
    id: "arbitrum",
    label: "Arbitrum",
    assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
    refundTo: "0x1111111111111111111111111111111111111111",
  },
  {
    id: "solana",
    label: "Solana",
    assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
    refundTo: "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK",
  },
];

const NEAR_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

export async function dryQuote(chain: OriginChain, amountOut: string): Promise<Quote> {
  const body = {
    dry: true,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: 100,
    originAsset: chain.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: NEAR_USDC,
    amount: amountOut,
    recipient: "intents.near",
    recipientType: "DESTINATION_CHAIN",
    refundTo: chain.refundTo,
    refundType: "ORIGIN_CHAIN",
    deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
  if (body.dry !== true) {
    throw new Error("Refusing to request a live 1Click quote");
  }
  const response = await fetch("https://1click.chaindefuser.com/v0/quote", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.message || "1Click quote failed");
  }
  const quote = (json.quote || {}) as Quote;
  if (quote.depositAddress) {
    throw new Error("Quote included a deposit address. This demo only accepts dry quotes.");
  }
  return quote;
}
