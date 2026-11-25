// Server-only public market links; no account credentials are sent.
import { MarketLinkPending, parseLinkResponse, verifiedSelectionLink, waitForAvailability } from "./parlay-handoff";

const cache = new Map<string, { at: number; url: string }>();
export async function selectionLink(ticker: string, side: "yes" | "no", callerSignal?: AbortSignal): Promise<string> {
  const key = `${ticker}:${side}`, existing = cache.get(key);
  if (existing && Date.now() - existing.at < 60_000) return existing.url;
  const signal = AbortSignal.any([AbortSignal.timeout(20_000), ...(callerSignal ? [callerSignal] : [])]);
  let pending: MarketLinkPending | undefined;
  // New combos can exist before the public MCP service can look them up.
  // Retry that specific 404 only; malformed/wrong-side links and redirects fail.
  for (const delay of [0, 500, 1500, 3000, 5000]) {
    try {
      if (delay) await waitForAvailability(delay, signal);
      signal.throwIfAborted();
      const response = await fetch("https://api.elections.kalshi.com/mcp", {
        method: "POST", redirect: "manual",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {
          name: "get_market_links", arguments: { market_ticker: ticker, side },
        } }), signal,
      });
      if (response.status >= 300 && response.status < 400) throw new Error("Kalshi returned an unexpected redirect while preparing the market link.");
      if (response.status === 404) throw new MarketLinkPending();
      if (!response.ok) throw new Error("Kalshi market links are unavailable. You can still copy the ticket and search the market ticker on Kalshi.");
      const url = verifiedSelectionLink(parseLinkResponse(await response.text()), ticker, side);
      if (cache.size >= 256) cache.delete(cache.keys().next().value!);
      cache.set(key, { at: Date.now(), url });
      return url;
    } catch (error) {
      if (error instanceof MarketLinkPending) { pending = error; continue; }
      if (signal.aborted && pending && !callerSignal?.aborted) throw pending;
      throw error;
    }
  }
  throw pending ?? new Error("Kalshi did not return a verified market link.");
}
