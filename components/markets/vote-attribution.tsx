import { ArrowDown, ArrowUp } from "lucide-react";
import type { VoterAttribution } from "@/lib/domain";

export function VoteAttribution({ voters = [] }: { voters?: VoterAttribution[] }) {
  if (!voters.length) return null;
  return <div className="vote-attribution" role="group" aria-label="Who voted">
    {(["up", "down"] as const).map(direction => {
      const people = voters.filter(voter => voter[direction] > 0);
      if (!people.length) return null;
      return <div className="vote-attribution-group" key={direction}>
        <span className="vote-direction">
          {direction === "up" ? <ArrowUp size={14} aria-hidden="true"/> : <ArrowDown size={14} aria-hidden="true"/>}
          {direction === "up" ? "Up" : "Down"}
        </span>
        <ul aria-label={direction === "up" ? "Upvotes" : "Downvotes"}>
          {people.map((voter, index) => <li key={index} aria-label={`${voter.name}: ${voter[direction]} ${direction}vote${voter[direction] === 1 ? "" : "s"}`}>
            <span className="vote-attribution-name">{voter.name}</span>
            <span className="vote-attribution-count">×{voter[direction]}</span>
          </li>)}
        </ul>
      </div>;
    })}
  </div>;
}
