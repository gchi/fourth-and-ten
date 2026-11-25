import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { DEFAULT_PARLAY_LEGS, rankBallots, type Group, type Vote } from "./domain";
export function database() { if(!env.DB) throw new Error("The group database is not connected yet."); return env.DB; }
export async function context() {
  const user = await getChatGPTUser();
  if(!user) throw new Error("Sign in to join the group and save your votes.");
  const db=database();
  // The legacy deadline column is retained for storage compatibility and is no longer used.
  await db.prepare("INSERT OR IGNORE INTO groups (id,owner,name,budget,top_n,round,deadline,locked) VALUES ('club',?,'The Thursday Club',1000,?,?,'',0)").bind(user.userId,DEFAULT_PARLAY_LEGS,crypto.randomUUID()).run();
  const raw=await db.prepare("SELECT * FROM groups WHERE id='club'").first<any>();
  const group:Group={id:raw.id,owner:raw.owner,name:raw.name,budget:raw.budget,topN:raw.top_n,round:raw.round,locked:raw.locked};
  return {user,db,group};
}
export async function state(options: { includeVoters?: boolean } = {}) {
  const {user,db,group}=await context();
  const {results}=await db.prepare("SELECT * FROM ballots WHERE round=? ORDER BY updated").bind(group.round).all<any>();
  const mine=results.find(r=>r.user===user.userId);
  const parsed=results.map(r=>({...r,parsed:JSON.parse(r.votes) as Vote[]}));
  return {user:{name:user.displayName,isOwner:group.owner===user.userId},group:{...group,owner:""},votes:mine?JSON.parse(mine.votes):[],revision:mine?.revision??0,scores:rankBallots(parsed.map(r=>r.parsed),options.includeVoters?parsed.map(r=>r.name):[]),members:parsed.map(r=>({name:r.name,up:r.parsed.filter((v:Vote)=>v.direction===1).length,down:r.parsed.filter((v:Vote)=>v.direction===-1).length})),locked:!!group.locked};
}
export function failure(e:unknown) {
  const message=(e as Error).message;
  return Response.json({error:message},{status:message.startsWith("Sign in")?401:message.startsWith("Only")?403:400});
}
export function sameOrigin(request:Request) {
  const origin=request.headers.get("origin");
  if(origin && origin!==new URL(request.url).origin) throw new Error("This request must come from the group website.");
}
