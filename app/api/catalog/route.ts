import { catalog } from "@/lib/kalshi";
export async function GET() {
  try {return Response.json({series:await catalog()}, {headers:{"Cache-Control":"private, max-age=300"}});}
  catch(e) {return Response.json({error:(e as Error).message},{status:502});}
}
