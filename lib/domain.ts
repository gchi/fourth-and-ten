export type Market = {
  ticker: string; event: string; series: string; title: string; subtitle: string;
  category: string; league: string; yes: number | null; no: number | null;
  closes: string; occurs: string; status: string; volume: number; rules: string; rulesSecondary?: string; matchup?: string; fetchedAt: string;
};
export type Series = { ticker: string; title: string; category: string; league: string };
export type Vote = { ticker: string; side: "yes" | "no"; direction: 1 | -1; market: Market };
export type VoteAction = "add" | "remove";
export type VoterAttribution = { name: string; up: number; down: number };
export type Score = { voters?: VoterAttribution[]; key: string; market: Market; side: "yes" | "no"; up: number; down: number; net: number };
export type Group = { id: string; owner: string; name: string; budget: number; topN: number; round: string; locked: number };
export type BallotState = {
  user: { name: string; isOwner: boolean }; group: Group; votes: Vote[]; revision: number;
  scores: Score[]; members: { name: string; up: number; down: number }[]; locked: boolean;
};

export const DEFAULT_PARLAY_LEGS = 10;
export const UPVOTE_LIMIT = 10;
export const DOWNVOTE_LIMIT = 5;

export const categories = ["All markets", "Moneyline", "Spreads", "Totals", "Player props", "Futures & more"];
export function classify(ticker: string, title = "") {
  const value = `${ticker} ${title}`.toUpperCase();
  if (/SPREAD/.test(value)) return "Spreads";
  if (/TOTAL|TEAMTOTAL/.test(value)) return "Totals";
  if (/YDS|YARDS|PASS|RUSH|RECEPTION|RECEIVING|REC\b|TOUCHDOWN|[123]TD|ANYTD|SACK|INTERCEPTION|TACKLE|FIELD.?GOAL|LONGEST/.test(value)) return "Player props";
  if (/GAME$/.test(ticker) || /GAME WINNER|MONEYLINE|[1234]QWINNER/.test(value)) return "Moneyline";
  return "Futures & more";
}
export function leagueOf(ticker: string, title = "") {
  if (/NCAAF|COLLEGE|FCS/.test(`${ticker} ${title}`.toUpperCase())) return "College";
  if (/NFL|PRO FOOTBALL|PROFESSIONAL FOOTBALL/.test(`${ticker} ${title}`.toUpperCase())) return "NFL";
  return "Other";
}
export function changeVote(votes: Vote[], market: Market, side: "yes" | "no", direction: 1 | -1, action: VoteAction = "add"): Vote[] {
  const matches = (v: Vote) => v.ticker === market.ticker && v.side === side;
  let next: Vote[];
  if (action === "remove") {
    if (direction !== 1) throw new Error("Use the downvote button to undo a downvote.");
    const index = votes.findIndex(v => matches(v) && v.direction === 1);
    if (index === -1) throw new Error("There are no upvotes on this pick to remove.");
    // Each entry is one vote point. Existing single-vote ballots need no migration.
    next = votes.filter((_, i) => i !== index);
  } else if (direction === 1) {
    next = votes.filter(v => !(matches(v) && v.direction === -1));
    next.push({ ticker: market.ticker, side, direction, market });
  } else {
    const hadDownvote = votes.some(v => matches(v) && v.direction === -1);
    next = votes.filter(v => !matches(v));
    if (!hadDownvote) next.push({ ticker: market.ticker, side, direction, market });
  }
  if (next.filter(v => v.direction === 1).length > UPVOTE_LIMIT) throw new Error(`All ${UPVOTE_LIMIT} upvotes are used. Remove one to vote on another pick.`);
  if (next.filter(v => v.direction === -1).length > DOWNVOTE_LIMIT) throw new Error(`All ${DOWNVOTE_LIMIT} downvotes are used. Remove one to vote on another pick.`);
  return next;
}
export function rankBallots(ballots: Vote[][], voterNames: string[] = []): Score[] {
  const map = new Map<string, Score>();
  for (const [index, votes] of ballots.entries()) {
    // Keep each ballot separate even when two accounts have the same display name.
    const person = new Map<string, VoterAttribution>();
    for (const v of votes) {
      const key = `${v.ticker}:${v.side}`;
      const score = map.get(key) ?? { key, market: v.market, side: v.side, up: 0, down: 0, net: 0 };
      if (v.direction === 1) score.up++; else score.down++;
      score.net = score.up - score.down;
      map.set(key, score);
      if (voterNames[index]) {
        const attribution = person.get(key) ?? { name: voterNames[index], up: 0, down: 0 };
        if (v.direction === 1) attribution.up++; else attribution.down++;
        person.set(key, attribution);
      }
    }
    for (const [key, attribution] of person) (map.get(key)!.voters ??= []).push(attribution);
  }
  for (const score of map.values()) score.voters?.sort((a,b) => a.name.localeCompare(b.name));
  return [...map.values()].sort((a,b) => b.net - a.net || b.up - a.up || a.key.localeCompare(b.key));
}
export function selectWinners(scores: Score[], topN: number): Score[] {
  const winners: Score[] = [];
  for (const s of scores) {
    if (winners.length >= topN) break;
    if (s.net <= 0) continue;
    if (winners.some(w => w.market.ticker === s.market.ticker)) continue;
    // One game-winner leg per event avoids conflicting or duplicate team outcomes.
    if (s.market.category === "Moneyline" && winners.some(w => w.market.category === "Moneyline" && w.market.event === s.market.event)) continue;
    winners.push(s);
  }
  return winners;
}
export type PickConflict = {
  kind: "redundant" | "conflicting";
  keys: [string, string];
  labels: [string, string];
  explanation: string;
};
type PickForCheck = { key: string; side: "yes" | "no"; market: Pick<Market, "ticker" | "event" | "title"> };
type OutcomeRange = { group: string; low: number; high: number };

// Check only recognized integer-stat conditions with matching event/participant
// identities. Correlation alone is not a conflict; Kalshi decides all other cases.
function outcomeRange(pick: PickForCheck): OutcomeRange | null {
  const { market: m, side } = pick;
  const prop = m.title.match(/^(.+): (\d+)\+ (passing yards|rushing yards|receiving yards|receptions|passing touchdowns|rushing touchdowns|touchdowns)$/i);
  if (prop && m.ticker.startsWith(`${m.event}-`)) {
    const suffix = m.ticker.slice(m.event.length + 1).match(/^([A-Z0-9]+)-(\d+)$/);
    if (!suffix || Number(suffix[2]) !== Number(prop[2])) return null;
    const threshold = Number(prop[2]);
    return { group: JSON.stringify([m.event, suffix[1], prop[1].toLowerCase(), prop[3].toLowerCase()]),
      low: side === "yes" ? threshold : -Infinity, high: side === "no" ? threshold - 1 : Infinity };
  }
  // Full-game winner and winning-spread conditions use the same team's margin.
  // Keep NO moneylines unknown because tie settlement need not be a full NO win.
  const game = m.event.match(/^KX(NFL|NCAAF)(GAME|SPREAD)-([A-Z0-9]+)$/);
  const win = m.title.match(/^(.+?) wins\??$/);
  const spread = m.title.match(/^(.+?) wins by over (\d+(?:\.\d+)?) points\??$/);
  if (game && ((game[2] === "GAME" && win && side === "yes") || (game[2] === "SPREAD" && spread))) {
    const team = (spread?.[1] ?? win![1]).toLowerCase();
    const threshold = spread ? Math.floor(Number(spread[2])) + 1 : 1;
    return { group: JSON.stringify([game[1], game[3], team, "winning margin"]),
      low: side === "yes" ? threshold : -Infinity, high: side === "no" ? threshold - 1 : Infinity };
  }
  const total = m.title.match(/^(.+?): (over|under) (\d+(?:\.\d+)?) points scored\??$/i);
  if (total && /^KX(?:NFL|NCAAF)TOTAL-/.test(m.event)) {
    const over = total[2].toLowerCase() === "over", value = Number(total[3]);
    const minimum = over ? Math.floor(value) + 1 : Math.ceil(value);
    const above = over ? side === "yes" : side === "no";
    return { group: JSON.stringify([m.event, total[1].toLowerCase(), "points"]), low: above ? minimum : -Infinity, high: above ? Infinity : minimum - 1 };
  }
  return null;
}

export function selectionConflicts(picks: PickForCheck[]): PickConflict[] {
  const conflicts: PickConflict[] = [];
  for (let i = 0; i < picks.length; i++) for (let j = i + 1; j < picks.length; j++) {
    const a = picks[i], b = picks[j], first = outcomeRange(a), second = outcomeRange(b);
    let kind: PickConflict["kind"] | undefined;
    if (a.market.ticker === b.market.ticker) kind = a.side === b.side ? "redundant" : "conflicting";
    else if (first && second && first.group === second.group) {
      if (Math.max(first.low, second.low) > Math.min(first.high, second.high)) kind = "conflicting";
      else if ((first.low >= second.low && first.high <= second.high) || (second.low >= first.low && second.high <= first.high)) kind = "redundant";
    }
    if (!kind) continue;
    conflicts.push({ kind, keys: [a.key, b.key], labels: [`${a.market.title} — ${a.side.toUpperCase()}`, `${b.market.title} — ${b.side.toUpperCase()}`],
      explanation: kind === "redundant" ? "One of these conditions already includes the other. Keep one of these picks in the parlay." : "These conditions cannot both win. Keep one of these picks in the parlay." });
  }
  return conflicts;
}

export function marketUrl(m: Market) { return `https://kalshi.com/markets/${m.series.toLowerCase()}/${m.series.toLowerCase()}/${m.event.toLowerCase()}`; }
export function money(cents: number) { return new Intl.NumberFormat("en-US", {style:"currency",currency:"USD",maximumFractionDigits:cents%100?2:0}).format(cents/100); }
