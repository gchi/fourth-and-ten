import { state } from "./group";
import { selectWinners, selectionConflicts } from "./domain";
import { explainSelection } from "./odds";
import { ticketVersion, type ParlayTicket } from "./parlay-handoff";

export async function currentTicket(): Promise<ParlayTicket> {
  // state() requires the current member's verified Site identity. No owner-only
  // restriction: every admitted league member can take the same ticket to Kalshi.
  const current = await state();
  const picks = selectWinners(current.scores, current.group.topN);
  const conflicts = selectionConflicts(picks);
  const legs = picks.map(pick => ({
    key: pick.key, ticker: pick.market.ticker, event: pick.market.event,
    side: pick.side, title: pick.market.title, condition: explainSelection(pick.market, pick.side),
    voters: pick.voters ?? [],
  }));
  const ticket = {
    round: current.group.round, groupName: current.group.name,
    budget: current.group.budget, targetLegs: current.group.topN,
    locked: current.locked, legs, conflicts,
  };
  return { ...ticket, version: await ticketVersion(ticket) };
}

export { selectionLink } from "./kalshi-links";
