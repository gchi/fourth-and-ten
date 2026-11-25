import { context, failure, sameOrigin, state } from "@/lib/group";
import { DEFAULT_PARLAY_LEGS } from "@/lib/domain";
export async function GET(){try{return Response.json(await state(),{headers:{"Cache-Control":"no-store"}});}catch(e){return failure(e);}}
export async function PATCH(request:Request){
  try {
    sameOrigin(request);
    const {user,db,group}=await context();
    if(group.owner!==user.userId) throw new Error("Only the organizer can change group settings.");
    const body=await request.json() as Record<string, any>;
    if(body.action==="new-round") {
      if(!group.locked) throw new Error("Lock the current round before starting a new one.");
      await db.prepare("UPDATE groups SET round=?,top_n=?,locked=0 WHERE id='club' AND round=?").bind(crypto.randomUUID(),DEFAULT_PARLAY_LEGS,group.round).run();
    } else if(body.action==="reopen") {
      if(body.round!==group.round) return Response.json({error:"The round changed. Refresh before reopening voting."},{status:409});
      const result=await db.prepare("UPDATE groups SET locked=0 WHERE id='club' AND round=? AND locked=1").bind(group.round).run();
      if(result.meta.changes!==1) return Response.json({error:"Voting is already open or the round changed. Refresh the group."},{status:409});
    } else if(body.action==="lock") {
      await db.prepare("UPDATE groups SET locked=1 WHERE id='club'").run();
    } else {
      if(group.locked) throw new Error("This round is locked. Start a new round to change its settings.");
      const {name,budget,topN}=body;
      if(typeof name!=="string"||name.trim().length<1||name.trim().length>60) throw new Error("Use a group name between 1 and 60 characters.");
      if(!Number.isInteger(budget)||budget<100||budget>100000) throw new Error("Choose a total stake between $1 and $1,000.");
      if(!Number.isInteger(topN)||topN<2||topN>20) throw new Error("Choose between 2 and 20 winning picks.");
      await db.prepare("UPDATE groups SET name=?,budget=?,top_n=? WHERE id='club' AND round=? AND locked=0").bind(name.trim(),budget,topN,group.round).run();
    }
    return Response.json(await state());
  }catch(e){return failure(e);}
}
