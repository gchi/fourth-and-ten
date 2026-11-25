import type { Market } from "./domain";

export function americanToPrice(american: number): number | null {
  if (!Number.isFinite(american) || Math.abs(american) < 100) return null;
  return american < 0 ? -american / (-american + 100) : 100 / (american + 100);
}

export function explainPrice(price: number | null | undefined) {
  if (price == null || !Number.isFinite(price) || price <= 0 || price >= 1) return null;
  const american = price >= 0.5 ? -(100 * price) / (1 - price) : (100 * (1 - price)) / price;
  const rounded = Math.round(american);
  const position = price > 0.5 ? "Favored at this price" : price < 0.5 ? "Underdog at this price" : "Even money";
  return {
    price, american, americanText: price === 0.5 ? "+100" : `${rounded > 0 ? "+" : ""}${rounded.toLocaleString("en-US")}`,
    probability: price * 100,
    probabilityText: `${(price * 100).toFixed(1)}%`,
    position,
    riskFor100Profit: 100 * price / (1 - price),
    profitFor100Risk: 100 * (1 - price) / price,
    contractProfit: 1 - price,
  };
}

export function stakeExample(price: number | null | undefined, stake: number) {
  const quote = explainPrice(price);
  if (!quote || !Number.isFinite(stake) || stake <= 0) return null;
  const returned = stake / quote.price;
  return { stake, returned, profit: returned - stake, loss: stake };
}

export function formatDollars(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}
export function formatCents(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value < 0) return "Unavailable";
  return `${Number((value * 100).toFixed(2))}¢`;
}

// Only simplify well-understood titles. Preserve the exact proposition for all others.
// This describes a pick; the contract's official settlement rules remain authoritative.
export function explainSelection(market: Pick<Market, "title" | "category"> & Partial<Pick<Market, "rules" | "matchup">>, side: "yes" | "no") {
  const title = market.title.replace(/\?$/, "").trim();
  const spread = title.match(/^(.+) wins by (?:over|more than) (\d+(?:\.\d+)?) points$/i);
  if (market.category === "Spreads" && spread) {
    const margin = Math.floor(Number(spread[2])) + 1;
    return side === "yes" ? `${spread[1]} must win by at least ${margin} points.` : `${spread[1]} must not win by ${margin} or more points.`;
  }
  const total = title.match(/^(.+?): (over|under) (\d+(?:\.\d+)?) points scored$/i);
  if (market.category === "Totals" && total) {
    const threshold = Number(total[3]);
    const isOver = total[2].toLowerCase() === "over";
    const points = isOver ? Math.floor(threshold) + 1 : Math.ceil(threshold) - 1;
    const condition = side === "yes"
      ? `${isOver ? "at least" : "at most"} ${points}`
      : `${isOver ? "at most" : "at least"} ${isOver ? points - 1 : points + 1}`;
    const teams = market.matchup ? `${market.matchup}: ` : "";
    return `${teams}${total[1]} combined score must be ${condition} points.`;
  }
  const prop = title.match(/^(.+?): (\d+(?:\.\d+)?)\+ (.+)$/);
  if (market.category === "Player props" && prop) {
    return side === "yes" ? `${prop[1]} must record at least ${prop[2]} ${prop[3]}.` : `${prop[1]} must record fewer than ${prop[2]} ${prop[3]}.`;
  }
  const winner = title.match(/^(.+) wins$/i);
  if (market.category === "Moneyline" && winner) {
    return side === "yes" ? `You are backing ${winner[1]} to win the game.` : `You are backing ${winner[1]} not to win the game.`;
  }
  return side === "yes" ? `You are backing this statement to be true: “${title}”.` : `You are backing this statement to be false: “${title}”.`;
}
