import { catalog, kalshi, normalize } from "@/lib/kalshi";
export async function GET(request:Request) {
  try {
    const query = new URL(request.url).searchParams;
    const series = await catalog();
    const tickers = query.get("tickers");
    if (tickers) {
      const keys = tickers.split(",");
      if (keys.length>50 || keys.some(t=>!series.some(s=>t.startsWith(`${s.ticker}-`)))) return Response.json({error:"Invalid football market tickers"},{status:400});
      const data = await kalshi(`/markets?tickers=${encodeURIComponent(tickers)}&limit=100`);
      return Response.json({markets:(data.markets??[]).map((m:any)=>normalize(m,series.find(s=>m.ticker.startsWith(`${s.ticker}-`)))),at:new Date().toISOString()});
    }
    const selected = series.find(s=>s.ticker === query.get("series"));
    if (!selected) return Response.json({error:"Select a football market series"},{status:400});
    const data=await kalshi(`/markets?series_ticker=${encodeURIComponent(selected.ticker)}&status=open&limit=200${query.get("cursor")?`&cursor=${encodeURIComponent(query.get("cursor")!)}`:""}`);
    return Response.json({markets:(data.markets??[]).map((m:any)=>normalize(m,selected)),cursor:data.cursor || "",at:new Date().toISOString()});
  } catch(e) { return Response.json({error:(e as Error).message},{status:502}); }
}
