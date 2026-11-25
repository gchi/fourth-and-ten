// Server-only: imported exclusively by API routes. Never import from a client component.
import { constants, createPrivateKey, sign, type KeyObject } from "node:crypto";
import type { ParlayTicket, PreparedCombo } from "./parlay-handoff";

const API = "https://external-api.kalshi.com/trade-api/v2";
const tickerPattern = /^[A-Z0-9_-]{1,160}$/;
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type RuntimeSecrets = { KALSHI_API_KEY_ID?: string; KALSHI_PRIVATE_KEY_PEM?: string };
type Credentials = { id: string; key: KeyObject };
type AssociatedEvent = { ticker: string; is_yes_only: boolean; size_min?: number | null; size_max?: number | null };
export type ComboCollection = {
  collection_ticker: string; open_date: string; close_date: string;
  is_ordered: boolean; size_min: number; size_max: number;
  associated_events: AssociatedEvent[];
};

export class ComboError extends Error {
  code: string;
  status: number;
  upstreamStatus?: number;
  constructor(code: string, message: string, status = 502) {
    super(message); this.code = code; this.status = status;
  }
}

export function comboCredentials(secrets: RuntimeSecrets): Credentials {
  const id = secrets.KALSHI_API_KEY_ID?.trim();
  const pem = secrets.KALSHI_PRIVATE_KEY_PEM?.trim().replaceAll("\\n", "\n");
  if (!id || !pem) throw new ComboError("setup_required", "The organizer needs to configure the Kalshi connection before the group can prepare a combo.", 503);
  try {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id)) throw new Error();
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== "ed25519" && key.asymmetricKeyType !== "rsa") throw new Error();
    if (key.asymmetricKeyType === "rsa" && (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error();
    return { id, key };
  } catch {
    throw new ComboError("invalid_configuration", "The Kalshi connection needs attention: check the key ID and Ed25519 or RSA private key in the Site’s runtime secrets.", 503);
  }
}

export function comboConnection(secrets: RuntimeSecrets) {
  try { comboCredentials(secrets); return { configured: true, code: "configured", message: "Connection configured. Kalshi will verify access when you prepare a combo." }; }
  catch (error) {
    const problem = error as ComboError;
    return { configured: false, code: problem.code, message: problem.message };
  }
}

export function signedHeaders(credentials: Credentials, method: string, path: string, timestamp = Date.now().toString()) {
  const text = Buffer.from(timestamp + method.toUpperCase() + path.split("?")[0]);
  const signature = credentials.key.asymmetricKeyType === "ed25519"
    ? sign(null, text, credentials.key)
    : sign("sha256", text, { key: credentials.key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 });
  return {
    "Content-Type": "application/json", "KALSHI-ACCESS-KEY": credentials.id,
    "KALSHI-ACCESS-TIMESTAMP": timestamp, "KALSHI-ACCESS-SIGNATURE": signature.toString("base64"),
  };
}

export function assertComboTicket(ticket: ParlayTicket, version: unknown) {
  if (typeof version !== "string" || version !== ticket.version) throw new ComboError("ticket_changed", "The group ticket changed. Refresh it before preparing the parlay.", 409);
  if (!ticket.locked) throw new ComboError("voting_open", "The organizer needs to lock voting before preparing the parlay.", 409);
  if (ticket.legs.length < 2 || ticket.legs.length > 20) throw new ComboError("invalid_ticket", "A group parlay needs between 2 and 20 selected picks.", 409);
  if (ticket.conflicts?.length) {
    const conflict = ticket.conflicts[0];
    throw new ComboError("overlapping_picks", `${conflict.labels.join(" + ")}: ${conflict.explanation}`, 409);
  }
  const seen = new Set<string>();
  for (const leg of ticket.legs) {
    if (!tickerPattern.test(leg.ticker) || !tickerPattern.test(leg.event) || !["yes", "no"].includes(leg.side) || seen.has(leg.ticker)) {
      throw new ComboError("invalid_ticket", "The group ticket contains an invalid or repeated market. Review the picks before continuing.", 409);
    }
    seen.add(leg.ticker);
  }
}

// Collections are discovered from Kalshi, not inferred from football ticker names.
// The live API uses size_max=0 for an unbounded collection; per-event null is unbounded.
export function collectionAllows(collection: ComboCollection, ticket: ParlayTicket, now = Date.now()): boolean {
  if (!tickerPattern.test(collection.collection_ticker) || collection.is_ordered !== false ||
    !(Date.parse(collection.open_date) <= now && now < Date.parse(collection.close_date)) ||
    !Number.isInteger(collection.size_min) || !Number.isInteger(collection.size_max) || collection.size_max < 0 ||
    ticket.legs.length < collection.size_min || (collection.size_max > 0 && ticket.legs.length > collection.size_max) ||
    !Array.isArray(collection.associated_events)) return false;
  const counts = new Map<string, number>();
  const events = new Map(collection.associated_events.map(event => [event.ticker, event]));
  for (const leg of ticket.legs) {
    const event = events.get(leg.event);
    if (!event || (event.is_yes_only && leg.side !== "yes")) return false;
    counts.set(leg.event, (counts.get(leg.event) ?? 0) + 1);
  }
  return collection.associated_events.every(event => {
    const count = counts.get(event.ticker) ?? 0;
    return count >= (event.size_min ?? 0) && (event.size_max == null || count <= event.size_max);
  });
}

export function verifyComboMarket(market: any, ticker: string, event: string, ticket: ParlayTicket, now = Date.now()) {
  if (!market || market.ticker !== ticker || market.event_ticker !== event || market.market_type !== "binary" ||
    market.status !== "active" || !(Date.parse(market.close_time) > now) ||
    !Array.isArray(market.mve_selected_legs) || market.mve_selected_legs.length !== ticket.legs.length) {
    throw new ComboError("combo_unverified", "Kalshi did not return an open combo matching the group ticket. No purchase was made.");
  }
  const expected = ticket.legs.map(leg => JSON.stringify([leg.event, leg.ticker, leg.side])).sort();
  const actual = market.mve_selected_legs.map((leg: any) => JSON.stringify([leg.event_ticker, leg.market_ticker, leg.side])).sort();
  if (expected.some((value, index) => value !== actual[index])) {
    throw new ComboError("combo_mismatch", "Kalshi returned different combo legs. The link was withheld; none of your picks were substituted.");
  }
}

async function jsonResponse(response: Response): Promise<any> {
  try { return await response.json(); }
  catch { throw new ComboError("kalshi_unavailable", "Kalshi returned an unreadable response. Try preparing the combo again shortly."); }
}

function apiError(status: number, data: any): ComboError {
  const error = classifyApiError(status, data);
  error.upstreamStatus = status;
  return error;
}

function classifyApiError(status: number, data: any): ComboError {
  const code = data?.error?.code ?? data?.code;
  if (status === 401 || status === 403) return new ComboError("connection_rejected", "Kalshi rejected the connection. The organizer should check the production key and its write::trade permission.", 503);
  if (status === 429) return new ComboError("rate_limited", "Kalshi is limiting combo requests. Wait a minute before trying again.", 429);
  const messages: Record<string, string> = {
    conflicting_leg_outcomes: "Some winning picks cannot all happen together. Review the group’s selections; no picks were removed.",
    duplicated_legs: "Kalshi considers two or more picks redundant. Common examples are two yardage lines for one player, or a team win plus its winning spread. Reopen voting to keep one of the overlapping picks. Your votes are saved.",
    invalid_market_combination: "Kalshi does not currently allow these exact picks in one combo. Try again closer to the games or review the group’s selections.",
    invalid_parameters: "These picks do not meet Kalshi’s current combo rules, or a selected market has closed.",
  };
  if (status === 400 && typeof code === "string" && messages[code]) return new ComboError(code, messages[code], 422);
  // Never expose upstream response text, signatures or credential details.
  return new ComboError("kalshi_unavailable", "Kalshi could not prepare the combo. No purchase was made. Try again shortly.");
}

export async function prepareCombo(options: {
  version: unknown;
  getTicket: () => Promise<ParlayTicket>;
  getCredentials: () => Credentials;
  getLink: (ticker: string, side: "yes", signal?: AbortSignal) => Promise<string>;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  onStage?: (stage: "credentials" | "eligibility" | "creation" | "verification" | "link") => void;
}): Promise<PreparedCombo> {
  const fetcher = options.fetcher ?? fetch;
  const ticket = await options.getTicket(); // Authorization happens here, before using the shared key.
  assertComboTicket(ticket, options.version);
  options.onStage?.("credentials");
  const credentials = options.getCredentials();
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
  const request: Fetcher = async (url, init = {}) => {
    // Cloudflare Workers rejects redirect: "error" before sending the request.
    // Manual mode plus an explicit status check also prevents credentials from
    // being forwarded to any Location returned by an upstream server.
    const response = await fetcher(url, { ...init, redirect: "manual", signal });
    if (response.status >= 300 && response.status < 400) {
      throw new ComboError("unexpected_redirect", "Kalshi returned an unexpected response while preparing the combo. Please try again shortly.");
    }
    return response;
  };
  const unchanged = async () => assertComboTicket(await options.getTicket(), ticket.version);
  options.onStage?.("eligibility");
  const candidates: ComboCollection[] = [];
  const cursors = new Set<string>();
  let cursor = "";
  // A bounded, paginated discovery request, narrowed to one of our selected events.
  for (let page = 0; page < 5; page++) {
    const query = new URLSearchParams({ status: "open", associated_event_ticker: ticket.legs[0].event, limit: "200" });
    if (cursor) query.set("cursor", cursor);
    const response = await request(`${API}/multivariate_event_collections?${query}`);
    const data = await jsonResponse(response);
    if (!response.ok) throw apiError(response.status, data);
    if (!Array.isArray(data.multivariate_contracts)) throw new ComboError("kalshi_unavailable", "Kalshi’s eligible combo list is temporarily unavailable.");
    candidates.push(...data.multivariate_contracts.filter((c: ComboCollection) => collectionAllows(c, ticket)));
    cursor = data.cursor ?? "";
    if (!cursor || candidates.length) break;
    if (cursors.has(cursor)) throw new ComboError("kalshi_unavailable", "Kalshi’s combo list could not be fully checked. Try again shortly.");
    cursors.add(cursor);
  }
  if (!candidates.length) throw new ComboError(cursor ? "discovery_incomplete" : "ineligible_combo", cursor
    ? "Kalshi’s combo list is too large to check right now. Try again shortly."
    : "Kalshi does not currently offer one combo containing all these exact picks and sides. Eligibility can change closer to game time. No picks were removed.", 422);

  const selected_markets = ticket.legs.map(leg => ({ event_ticker: leg.event, market_ticker: leg.ticker, side: leg.side }));
  let lastError: ComboError | undefined;
  for (const collection of candidates.slice(0, 3)) {
    await unchanged();
    options.onStage?.("creation");
    const path = `/trade-api/v2/multivariate_event_collections/${encodeURIComponent(collection.collection_ticker)}`;
    // Creates/resolves the public combo market only. No RFQ, quote acceptance, order or transfer is sent.
    const response = await request(`https://external-api.kalshi.com${path}`, {
      method: "POST", headers: signedHeaders(credentials, "POST", path),
      body: JSON.stringify({ selected_markets, with_market_payload: true }),
    });
    const data = await jsonResponse(response);
    if (!response.ok) {
      const error = apiError(response.status, data);
      if (["invalid_market_combination", "invalid_parameters"].includes(error.code)) { lastError = error; continue; }
      throw error;
    }
    if (!tickerPattern.test(data.market_ticker ?? "") || !tickerPattern.test(data.event_ticker ?? "")) {
      throw new ComboError("combo_unverified", "Kalshi did not return a valid combo identifier.");
    }
    // The authenticated creation response is current and includes the complete
    // market when requested. A separate cached GET can return 404 immediately
    // after creation, so verify this payload instead of requiring read-after-write
    // consistency. A present but invalid payload must never be bypassed.
    options.onStage?.("verification");
    let comboMarket = data.market;
    if (comboMarket == null) {
      // Older/partial API responses may omit the optional payload. Retry only
      // the public read; never repeat creation, alter legs, or submit a trade.
      for (const delay of [0, 300, 900, 1800]) {
        if (delay) await new Promise<void>(resolve => setTimeout(resolve, delay));
        signal.throwIfAborted();
        const marketResponse = await request(`${API}/markets/${encodeURIComponent(data.market_ticker)}`);
        const marketData = await jsonResponse(marketResponse);
        if (marketResponse.status === 404) continue;
        if (!marketResponse.ok) throw apiError(marketResponse.status, marketData);
        comboMarket = marketData.market;
        if (comboMarket == null) throw new ComboError("combo_unverified", "Kalshi did not return a complete combo market. No purchase was made.");
        break;
      }
      if (comboMarket == null) {
        const error = new ComboError("combo_pending", "Kalshi prepared the combo, but it is still becoming available. Wait a few seconds, then try again. No purchase was made.", 503);
        error.upstreamStatus = 404;
        throw error;
      }
    }
    verifyComboMarket(comboMarket, data.market_ticker, data.event_ticker, ticket);
    await unchanged();
    // YES on the combo means all selected leg sides, including any NO legs.
    options.onStage?.("link");
    let url: string;
    try { url = await options.getLink(data.market_ticker, "yes", signal); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "link_pending") {
        const problem = new ComboError("link_pending", "Your combo is prepared, but Kalshi’s link is still becoming available. Please try again shortly. No purchase was made.", 503);
        problem.upstreamStatus = 404;
        throw problem;
      }
      throw new ComboError("link_unavailable", "The combo was prepared, but Kalshi’s market link could not be verified. Try preparing it again shortly. No purchase was made.");
    }
    await unchanged();
    const preparedAt = Date.now();
    return { version: ticket.version, ticker: data.market_ticker, url, legCount: ticket.legs.length,
      preparedAt, expiresAt: Math.min(preparedAt + 120_000, Date.parse(comboMarket.close_time)) };
  }
  throw lastError ?? new ComboError("ineligible_combo", "Kalshi could not combine the group’s exact selections.", 422);
}
