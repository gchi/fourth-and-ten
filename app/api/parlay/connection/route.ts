import { env } from "cloudflare:workers";
import { context, failure } from "@/lib/group";
import { comboConnection } from "@/lib/kalshi-combo";

export async function GET() {
  try {
    await context();
    return Response.json(comboConnection(env), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
