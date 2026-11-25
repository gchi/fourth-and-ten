import { context, failure, sameOrigin, state } from "@/lib/group";
import { changeVote, type Vote } from "@/lib/domain";
import { catalog, kalshi, normalize } from "@/lib/kalshi";
export async function POST(request:Request){
  try {
    sameOrigin(request);
    const {user,db,group}=await context();
    if(group.locked) throw new Error("Voting is closed for this round.");
    const {ticker,side,direction,revision,round,action="add"}=await request.json() as Record<string, any>;
    if(round!==group.round) throw new Error("A new round has started. Refresh your ballot.");
    if(typeof ticker!=="string"||ticker.length>200||!["yes","no"].includes(side)||![1,-1].includes(direction)||!Number.isInteger(revision)||!["add","remove"].includes(action)||(action==="remove"&&direction!==1)) throw new Error("Invalid vote.");
    const current=await db.prepare("SELECT votes, revision FROM ballots WHERE user=? AND round=?").bind(user.userId,group.round).first<any>();
    if((current?.revision??0)!==revision) return Response.json({error:"Your ballot changed in another tab. Refreshing your votes."},{status:409});
    const votes:Vote[]=current?JSON.parse(current.votes):[];
    const existing=votes.find(v=>v.ticker===ticker&&v.side===side);
    let market=existing?.market;
    const removing=action==="remove"||(direction===-1&&existing?.direction===-1);
    if(removing&&!existing) throw new Error("There are no votes on this pick to remove.");
    if(!removing) {
      const series=(await catalog()).find(s=>ticker.startsWith(`${s.ticker}-`));
      if(!series) throw new Error("Only Kalshi football markets can be added.");
      market=normalize((await kalshi(`/markets/${encodeURIComponent(ticker)}`)).market,series);
      if(!["active","open"].includes(market.status)||Date.parse(market.closes)<=Date.now()) throw new Error("This market is no longer open for voting.");
    }
    const next=changeVote(votes,market!,side,direction,action);
    const now=new Date().toISOString();
    // One conditional write is the concurrency boundary; recheck round and manual lock in the same SQL statement.
    const write=current
      ? db.prepare("UPDATE ballots SET votes=?,revision=revision+1,name=?,updated=? WHERE user=? AND round=? AND revision=? AND EXISTS (SELECT 1 FROM groups WHERE id='club' AND round=? AND locked=0)").bind(JSON.stringify(next),user.displayName,now,user.userId,group.round,revision,group.round)
      : db.prepare("INSERT OR IGNORE INTO ballots (votes,revision,name,updated,user,round) SELECT ?,1,?,?,?,? WHERE EXISTS (SELECT 1 FROM groups WHERE id='club' AND round=? AND locked=0)").bind(JSON.stringify(next),user.displayName,now,user.userId,group.round,group.round);
    const result=await write.run();
    if(result.meta.changes!==1) return Response.json({error:"The round or your ballot changed. Refresh and try again."},{status:409});
    return Response.json(await state());
  }catch(e){return failure(e);}
}
