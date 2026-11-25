import { classify, leagueOf, type Market, type Series } from "./domain";
const BASE = "https://external-api.kalshi.com/trade-api/v2";
type Raw = Record<string, any>;
export async function kalshi(path: string) {
  const response = await fetch(`${BASE}${path}`, { headers: { Accept:"application/json" }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(response.status === 429 ? "Kalshi is rate limiting requests. Please try again shortly." : `Kalshi market data is unavailable (${response.status}).`);
  return response.json() as Promise<Raw>;
}
let catalogCache: { at:number; list:Series[] } | null = null;
export async function catalog(): Promise<Series[]> {
  if (catalogCache && Date.now()-catalogCache.at < 900000) return catalogCache.list;
  const data = await kalshi("/series?category=Sports");
  const priority = ["KXNFLGAME","KXNFLSPREAD","KXNFLTOTAL","KXNFLANYTD","KXNFLPASSYDS","KXNFLRUSHYDS","KXNFLRECYDS","KXNFLREC","KXNCAAFGAME","KXNCAAFSPREAD","KXNCAAFTOTAL"];
  const list = (data.series ?? []).filter((s:Raw) => (s.tags ?? []).includes("Football") || /^(KXNFL|KXNCAAF|KXCFL|KXUFL)/.test(s.ticker)).map((s:Raw) => ({ticker:s.ticker,title:s.title,category:classify(s.ticker,s.title),league:leagueOf(s.ticker,s.title)}));
  list.sort((a:Series,b:Series) => (priority.includes(a.ticker)?priority.indexOf(a.ticker):999)-(priority.includes(b.ticker)?priority.indexOf(b.ticker):999) || a.title.localeCompare(b.title));
  catalogCache={at:Date.now(),list};
  return list;
}
function price(value: unknown): number|null {
  const n = Number(value);
  return value != null && n>0 && n<1 ? n : null;
}
export function normalize(raw:Raw, series?:Series): Market {
  const ticker=String(raw.ticker), st=series?.ticker ?? ticker.split("-")[0];
  return {ticker,series:st,event:String(raw.event_ticker),title:raw.title || raw.yes_sub_title || ticker,subtitle:raw.subtitle || raw.yes_sub_title || "",category:series?.category ?? classify(st),league:series?.league ?? leagueOf(st),yes:price(raw.yes_ask_dollars ?? (raw.yes_ask != null ? raw.yes_ask/100:null)),no:price(raw.no_ask_dollars ?? (raw.no_ask != null ? raw.no_ask/100:null)),closes:raw.close_time,occurs:raw.occurrence_datetime || raw.expected_expiration_time || raw.close_time,status:raw.status,volume:Number(raw.volume_fp ?? raw.volume ?? 0),rules:raw.rules_primary || "See Kalshi for settlement rules.",rulesSecondary:raw.rules_secondary || "",matchup:raw.rules_primary?.match(/(?:in|wins) the (.+?) (?:Pro Football|College Football|Football) game/i)?.[1] || "",fetchedAt:new Date().toISOString()};
}
