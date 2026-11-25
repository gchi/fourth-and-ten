import { env } from "cloudflare:workers";
import { currentTicket, selectionLink } from "@/lib/parlay-server";
import { ComboError, comboCredentials, prepareCombo } from "@/lib/kalshi-combo";
import type { PreparedCombo } from "@/lib/parlay-handoff";

// Coalesce simultaneous clicks in this isolate. Across isolates Kalshi returns
// the same market for the same legs; retries never submit a purchase.
const pending = new Map<string, Promise<PreparedCombo>>();
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  let stage: string = "ticket";
  try {
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
      throw new ComboError("invalid_origin", "Prepare the parlay from the group website.", 403);
    }
    // Verify identity even when the body is invalid or a request is in flight.
    const ticket = await currentTicket();
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ComboError("invalid_request", "Send a JSON ticket reference.", 400);
    const text = await request.text();
    if (text.length > 1024) throw new ComboError("invalid_request", "Only the ticket reference is accepted.", 400);
    let body: any;
    try { body = JSON.parse(text); } catch { throw new ComboError("invalid_request", "The ticket reference could not be read.", 400); }
    if (!body || typeof body !== "object" || Object.keys(body).length !== 1 || typeof body.version !== "string" || body.version !== ticket.version) {
      throw new ComboError("ticket_changed", "The group ticket changed. Refresh it before preparing the parlay.", 409);
    }
    let work = pending.get(ticket.version);
    if (!work) {
      if (pending.size >= 8) throw new ComboError("busy", "A combo is already being prepared. Try again shortly.", 429);
      work = prepareCombo({ version: body.version, getTicket: currentTicket, getCredentials: () => comboCredentials(env), getLink: selectionLink, onStage: next => { stage = next; } });
      pending.set(ticket.version, work);
      work.finally(() => { if (pending.get(ticket.version) === work) pending.delete(ticket.version); }).catch(() => {});
    }
    const result = await work;
    // Each caller rechecks against their own authenticated request context.
    if ((await currentTicket()).version !== result.version) throw new ComboError("ticket_changed", "The group ticket changed. Refresh before continuing.", 409);
    return Response.json(result, { headers });
  } catch (error) {
    // Operational diagnostics only: never log exception messages, request
    // headers/bodies, upstream responses, keys or signatures.
    if (!(error instanceof ComboError) || error.status >= 500) {
      console.error("parlay_combo_failed", { stage, code: error instanceof ComboError ? error.code : "unexpected_error",
        upstreamStatus: error instanceof ComboError ? error.upstreamStatus : undefined,
        kind: error instanceof TypeError ? "TypeError" : error instanceof Error && error.name === "TimeoutError" ? "TimeoutError" : "Error" });
    }
    if (error instanceof ComboError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers });
    if (error instanceof Error && error.message.startsWith("Sign in")) return Response.json({ error: error.message }, { status: 401, headers });
    return Response.json({ error: "The combo could not be verified. No purchase was made. Refresh the ticket and try again shortly.", code: "unavailable" }, { status: 502, headers });
  }
}
