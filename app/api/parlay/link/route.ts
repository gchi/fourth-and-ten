import { currentTicket, selectionLink } from "@/lib/parlay-server";
import { handoffBlocker } from "@/lib/parlay-handoff";
import { failure } from "@/lib/group";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const ticket = await currentTicket();
    if (params.get("version") !== ticket.version) return Response.json({ error: "The group ticket changed. Refresh it before continuing." }, { status: 409 });
    const blocked = handoffBlocker(ticket);
    if (blocked) return Response.json({ error: blocked }, { status: 409 });
    const leg = ticket.legs.find(item => item.key === params.get("key"));
    if (!leg) return Response.json({ error: "This selection is not part of the final group ticket." }, { status: 400 });
    const url = await selectionLink(leg.ticker, leg.side);
    if ((await currentTicket()).version !== ticket.version) return Response.json({ error: "The group started a new ticket. Refresh before continuing." }, { status: 409 });
    return Response.json({ url, side: leg.side, ticker: leg.ticker, version: ticket.version }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
