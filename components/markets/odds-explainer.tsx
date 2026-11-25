"use client";

import { useState } from "react";
import { CircleHelp, ArrowUpRight } from "lucide-react";
import { UPVOTE_LIMIT, type Market } from "@/lib/domain";
import { americanToPrice, explainPrice, explainSelection, formatCents, formatDollars, stakeExample } from "@/lib/odds";

export function OutcomeOdds({price}:{price:number|null}) {
  const q=explainPrice(price);
  return <span className="outcome-odds"><strong>{q?`≈ ${q.americanText}`:"No quote"}</strong><small>{q?`${formatCents(price)} · ${q.probabilityText} implied`:"Price unavailable"}</small></span>;
}

export function PickExplanation({market,side,onGuide,compact=false}:{market:Market;side:"yes"|"no";onGuide?:()=>void;compact?:boolean}) {
  const q=explainPrice(market[side]);
  if(compact) return <div className="compact-pick-explanation" aria-live="polite"><p>{explainSelection(market,side)}</p><div><span className={`odds-position ${q&&q.price>=.5?"favored":"underdog"}`}>{q?q.position:"No current quote"}</span>{onGuide&&<button className="text-button" onClick={onGuide}><CircleHelp size={14}/>Explain odds</button>}</div></div>;
  return <div className={`pick-explanation ${compact?"compact":""}`} aria-live="polite">
    <div className="pick-meaning"><span>YOU’RE VOTING ON · {side.toUpperCase()}</span><p>{explainSelection(market,side)}</p></div>
    {q?<><div className="chance-heading"><strong>{q.position}</strong><span>≈ {q.probabilityText} implied</span></div><div className="chance-bar" role="img" aria-label={`${q.probabilityText} probability implied by this asking price, before fees`}><span style={{width:`${q.probability}%`}}/><i/></div><p className="odds-definition">{q.price>0.5?<>At about <b>{q.americanText}</b>, risk <b>{formatDollars(q.riskFor100Profit)}</b> to make <b>$100 profit</b>.</>:q.price<0.5?<>At about <b>{q.americanText}</b>, risk <b>$100</b> to make <b>{formatDollars(q.profitFor100Risk)} profit</b>.</>:<>At <b>+100</b>, risk <b>$100</b> to make <b>$100 profit</b>.</>} Before fees.</p><div className="contract-example"><span>ONE CONTRACT, BEFORE FEES</span><p>Pay <b>{formatCents(q.price)}</b> → <b>$1 total return</b> on a full win (<b>{formatCents(q.contractProfit)} profit</b>). A full loss pays $0.</p></div><p className="odds-caveat">Implied chance comes from the asking price, not a prediction or a guarantee of good value.</p></>:<p className="odds-unavailable">No current asking price for {side.toUpperCase()}. Odds and payout estimates are unavailable; this is not a 0% chance.</p>}
    {onGuide&&<button className="odds-help" onClick={onGuide}><CircleHelp size={14}/>What do these odds mean?</button>}
  </div>;
}

export function MarketDetailOdds({market}:{market:Market}) {
  const [side,setSide]=useState<"yes"|"no">("yes");
  return <><div className="detail-outcome-tabs" role="group" aria-label="Explain a market outcome">{(["yes","no"] as const).map(s=><button key={s} aria-pressed={side===s} className={side===s?"selected":""} onClick={()=>setSide(s)}><span>{s.toUpperCase()}</span><OutcomeOdds price={market[s]}/></button>)}</div><PickExplanation market={market} side={side}/><p className="settlement-note">A full win means this side settles at $1; a full loss settles at $0. Ties, cancellations and other special outcomes follow the contract rules below.</p></>;
}

export function OddsGuide() {
  const [line,setLine]=useState("-225"),[stake,setStake]=useState("10");
  const price=americanToPrice(line.trim()?Number(line.replaceAll(",","")):NaN);
  const q=explainPrice(price),example=stakeExample(price,Number(stake));
  return <div className="odds-guide"><p className="modal-intro">The sign tells you the payout structure. The implied probability tells you how likely that outcome is priced to be.</p>
    <div className="odds-lesson"><div><span>MINUS · FAVORED</span><strong>−225</strong><p>Risk $225 to profit $100.<br/>About <b>69.2% implied probability</b>.</p></div><div><span>PLUS · UNDERDOG</span><strong>+225</strong><p>Risk $100 to profit $225.<br/>About <b>30.8% implied probability</b>.</p></div></div>
    <p className="odds-guide-note">Before fees. At ±100, the implied probability is 50%: even money. A larger negative number means a higher implied chance and less profit per dollar risked. A larger positive number means a lower implied chance and more potential profit.</p>
    <section className="odds-calculator" aria-label="American odds learning calculator"><div className="calculator-heading"><h3>Try the numbers</h3><span>EXAMPLE ONLY</span></div><div className="form-columns"><label className="form-label">AMERICAN ODDS<input inputMode="decimal" aria-describedby="odds-input-help" value={line} onChange={e=>setLine(e.target.value)} placeholder="-225"/></label><label className="form-label">EXAMPLE STAKE ($)<input type="number" min="0.01" step="0.01" value={stake} onChange={e=>setStake(e.target.value)}/></label></div><p id="odds-input-help" className="calculator-hint">Use −100 or lower, or +100 or higher.</p><div className="calculator-presets">{["-225","+225","+100"].map(n=><button key={n} onClick={()=>setLine(n)} aria-pressed={line===n}>{n}</button>)}</div>
      {q&&example?<div className="calculated-example" aria-live="polite"><div className="chance-heading"><strong>{q.position}</strong><span>{q.probabilityText} implied</span></div><div className="chance-bar" role="img" aria-label={`${q.probabilityText} implied probability`}><span style={{width:`${q.probability}%`}}/><i/></div><dl><dt>Profit on a full win</dt><dd>{formatDollars(example.profit)}</dd><dt>Total return, including stake</dt><dd>{formatDollars(example.returned)}</dd><dt>Amount lost on a full loss</dt><dd>{formatDollars(example.loss)}</dd></dl><p>Illustration only, before fees. Actual contracts, fill prices and settlement rules determine the final result. This is not your group’s parlay quote.</p></div>:<p role="status" className="odds-unavailable">Enter valid American odds and a stake above $0 to see the example.</p>}
    </section>
    <details className="odds-faq" open><summary>Does “favored” mean it’s a good bet?</summary><p>No. It describes the outcome’s implied likelihood, not whether you have an advantage. At −225, the break-even probability is about 69.2% before fees. Good value would require the true chance to exceed the price’s break-even probability after fees; this app does not estimate the true chance.</p></details>
    <details className="odds-faq"><summary>Why does Kalshi show cents?</summary><p>A standard contract pays $1 on a full win. Paying 70¢ therefore implies 70% before fees and converts to approximately −233 in American odds. We calculate that equivalent from each side’s own asking price. The “≈” means rounded; these are not separately quoted sportsbook odds. Buying both sides can cost more than $1 because of the bid–ask spread, so the two displayed percentages need not add to 100%.</p><p>Fees reduce profit and raise the probability needed to break even. Market-implied probabilities are estimates, not reliable forecasts of any one outcome.</p><a href="https://kalshi.com/prediction-markets" target="_blank" rel="noreferrer">Kalshi’s explanation of prices and payouts <ArrowUpRight size={13}/></a></details>
    <details className="odds-faq"><summary>Is −3.5 the same thing as −225?</summary><p>No. A −3.5-point spread is the condition: that team needs to win by at least 4 points. The American odds, such as −225, describe how much you risk and how much you could profit on that condition. A team can be favored to win the game yet be an underdog to cover a large spread.</p></details>
    <details className="odds-faq"><summary>What are the different football bets?</summary><p><b>Moneyline:</b> who wins the game. <b>Spread:</b> the winning margin. <b>Total:</b> whether points are above or below a threshold. <b>Player prop:</b> an individual stat, such as 250+ passing yards (250 or more). <b>Futures:</b> a later outcome, such as a season champion. The title, selected Yes/No side, and official rules define the exact pick.</p><p>Each upvote supports the selected side; you can put all {UPVOTE_LIMIT} on one outcome. The minus button returns one upvote. Downvoting opposes adding that side to the group parlay. A downvote on Yes does not buy No.</p></details>
    <details className="odds-faq"><summary>How do these odds apply to our parlay?</summary><p>These are individual leg prices. The group places one combined stake, and every leg must win for the combo to win in full. Kalshi supplies the actual combo quote and determines which legs can be combined. We do not multiply individual probabilities or payouts: legs can be related, and combo pricing can differ.</p></details>
  </div>;
}
