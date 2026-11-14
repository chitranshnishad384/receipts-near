export function formatAmount(raw: string, decimals = 6): string {
  const value = BigInt(raw);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let fraction = (abs % base).toString().padStart(decimals, "0");
  fraction = fraction.replace(/0+$/, "");
  if (fraction.length < 2) fraction = fraction.padEnd(2, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}

export function formatNs(ns: string): string {
  const millis = Number(BigInt(ns) / 1_000_000n);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(millis));
}

export function accountUrl(accountId: string): string {
  return `https://explorer.testnet.near.org/accounts/${accountId}`;
}

export function txUrl(hash: string): string {
  return `https://explorer.testnet.near.org/transactions/${hash}`;
}

export function shortHash(hash: string): string {
  return hash.length < 14 ? hash : `${hash.slice(0, 6)}…${hash.slice(-6)}`;
}
