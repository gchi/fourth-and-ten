import { currentTicket } from "@/lib/parlay-server";
import { failure } from "@/lib/group";

export async function GET() {
  try {
    return Response.json(await currentTicket(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
