import type { PickConflict, VoterAttribution } from "./domain";

export type TicketLeg = {
  key: string;
  ticker: string;
  event: string;
  side: "yes" | "no";
  title: string;
  condition: string;
  voters?: VoterAttribution[];
};
export type ParlayTicket = {
  round: string;
  groupName: string;
  budget: number;
  targetLegs: number;
  locked: boolean;
  version: string;
  legs: TicketLeg[];
  conflicts?: PickConflict[];
};
export type PreparedCombo = {
  version: string;
  ticker: string;
  url: string;
  legCount: number;
  preparedAt: number;
  expiresAt: number;
};
export type ComboConnection = { configured: boolean; code: string; message: string };

// Deliberately excludes moving prices: this identifies the agreed ticket,
// never a price quote, an order, or a receipt.
export async function ticketVersion(ticket: Omit<ParlayTicket, "version">): Promise<string> {
  const canonical = JSON.stringify([ticket.round, ticket.budget, ticket.targetLegs, ticket.locked,
    ticket.legs.map(leg => [leg.ticker, leg.side])]);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function handoffBlocker(ticket: ParlayTicket): string | null {
  if (ticket.conflicts?.length) return "Review the overlapping picks below before preparing the parlay.";
  if (!ticket.locked) return "The organizer needs to lock voting before this becomes the final group ticket.";
  if (ticket.legs.length < 2) return "At least two eligible picks are needed for a parlay.";
  return null;
}

export function ticketText(ticket: ParlayTicket, combo?: PreparedCombo | null): string {
  const line = (value: string) => value.replace(/[\r\n\t]+/g, " ").trim();
  const prepared = combo?.version === ticket.version && combo.expiresAt > Date.now() ? combo : null;
  return [
    `${line(ticket.groupName)} — ${ticket.locked ? "FINAL SELECTIONS" : "DRAFT — VOTING STILL OPEN"}`,
    `Round: ${ticket.round}`,
    `Ticket reference: ${ticket.version.slice(0, 12)} (not a Kalshi order ID)`,
    `Total group stake: $${(ticket.budget / 100).toFixed(2)} for ONE combined parlay`,
    `Legs: ${ticket.legs.length} of ${ticket.targetLegs} target picks`,
    ...(ticket.conflicts?.length ? ["REVIEW REQUIRED — overlapping selections", ...ticket.conflicts.map(c => `${c.labels.join(" + ")}: ${c.explanation}`)] : []),
    "",
    ...ticket.legs.flatMap((leg, index) => [
      `${index + 1}. ${line(leg.title)} — ${leg.side.toUpperCase()}`,
      `   ${line(leg.condition)}`,
      `   Market: ${leg.ticker}`,
      `   Event: ${leg.event}`,
      "",
    ]),
    ...(prepared ? [`Whole combo: ${prepared.url}`, `Kalshi combo market: ${prepared.ticker}`, "Sign in to YOUR Kalshi account and review the combo. Enter the total stake there; it is not prefilled."]
      : ["Use Prepare our parlay in Fourth & Ten to create and verify the whole combo link.", "If combo preparation is unavailable, open https://kalshi.com/combos and rebuild these exact selections together. Individual market links open only one leg."]),
    "Confirm every side, eligible combination, actual payout, fees, and total debit on Kalshi before you submit.",
    "Coordinate who places the shared group ticket. Each additional account purchase is a separate bet.",
    "NO ORDER HAS BEEN PLACED BY FOURTH & TEN. This is a selection list, not a quote or receipt.",
  ].join("\n");
}

export function verifiedSelectionLink(data: Record<string, unknown>, ticker: string, side: "yes" | "no"): string {
  if (data.side !== side) throw new Error("Kalshi could not verify the selected side.");
  const url = verifiedKalshiUrl(data.buy_url);
  const query = new URL(url).searchParams;
  for (const [names, expected] of [[ ["marketTicker", "op_market_ticker"], ticker ], [ ["orderSide", "op_order_side"], side ]] as const) {
    const values = names.flatMap(name => query.getAll(name));
    if (!values.length || values.some(value => value !== expected)) throw new Error("Kalshi returned a link for a different selection.");
  }
  if (query.has("op_side") && query.getAll("op_side").some(value => value !== "BUY")) throw new Error("Kalshi did not return a buy link.");
  return url;
}

export function verifiedKalshiUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("Kalshi did not return a market link.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "kalshi.com" || url.port || url.username || url.password || !url.pathname.startsWith("/markets/")) {
    throw new Error("Kalshi returned an unexpected market link.");
  }
  return url.href;
}

// A confirmed, transient indexing miss from the public link service.
export class MarketLinkPending extends Error {
  readonly code = "link_pending";
  constructor() { super("Kalshi’s link is still becoming available. Please try again shortly."); }
}

export function waitForAvailability(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

// Retry only explicit availability delays for the same frozen ticket. The
// server resolves identical legs idempotently; this endpoint never buys a bet.
export async function requestPreparedCombo(version: string, options: {
  signal: AbortSignal;
  onWaiting: () => void;
  fetcher?: typeof fetch;
  wait?: typeof waitForAvailability;
}): Promise<PreparedCombo> {
  const fetcher = options.fetcher ?? fetch;
  for (let attempt = 0; attempt < 3; attempt++) {
    options.signal.throwIfAborted();
    const response = await fetcher("/api/parlay/combo", {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ version }), signal: options.signal,
    });
    const data = await response.json() as PreparedCombo & { error?: string; code?: string };
    if (response.ok) return data;
    if (response.status === 503 && ["link_pending", "combo_pending"].includes(data.code ?? "") && attempt < 2) {
      options.onWaiting();
      await (options.wait ?? waitForAvailability)(2000, options.signal);
      continue;
    }
    throw new Error(data.error || "The combo could not be prepared.");
  }
  throw new Error("Kalshi’s combo link is still becoming available. Please try again shortly.");
}

// The official public MCP endpoint may return JSON or a finite SSE response.
export function parseLinkResponse(text: string): Record<string, unknown> {
  let message: any;
  try { message = JSON.parse(text); }
  catch {
    const events = text.replaceAll("\r\n", "\n").split("\n\n");
    for (const event of events) {
      const data = event.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
      if (!data) continue;
      try { const candidate = JSON.parse(data); if (candidate.id === 1) message = candidate; } catch { /* Ignore keep-alives. */ }
    }
  }
  if (message?.id === 1 && message.result?.isError && Array.isArray(message.result.content) &&
    message.result.content.some((item: any) => item.type === "text" && item.text === "Kalshi API returned HTTP 404")) {
    throw new MarketLinkPending();
  }
  if (!message || message.id !== 1 || message.error || message.result?.isError) throw new Error("Kalshi could not prepare this market link. Try again shortly.");
  const result = message.result;
  if (result?.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  for (const content of result?.content ?? []) {
    if (content.type === "text") {
      try { const data = JSON.parse(content.text); if (data && typeof data === "object") return data; } catch { /* Not structured link data. */ }
    }
  }
  throw new Error("Kalshi did not return usable market links.");
}
