"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, CircleHelp, ChevronDown, Copy, Download, ExternalLink, Loader2, LockKeyhole, RefreshCw, Ticket, Wallet } from "lucide-react";
import { handoffBlocker, ticketText, type ParlayTicket, type PreparedCombo } from "@/lib/parlay-handoff";
import { money, type VoterAttribution } from "@/lib/domain";
import { ComboHandoff } from "./combo-handoff";

async function readJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { cache: "no-store", signal });
  const data = await response.json();
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "The ticket could not be loaded. Please try again.";
    throw new Error(message);
  }
  return data as T;
}

export function KalshiAccountInfo({ onReview }: { onReview: () => void }) {
  return <div className="kalshi-account-info">
    <div className="account-handoff-card"><Wallet size={24}/><div><span>USE YOUR OWN ACCOUNT</span><h3>Your Kalshi. Your final click.</h3><p>Any league member can take the group’s final picks to their own Kalshi account. Sign in and submit on Kalshi.</p></div></div>
    <ol className="handoff-steps"><li><b>Agree on the ticket.</b> Let the organizer lock the leg count, stake, and votes.</li><li><b>Prepare the whole parlay.</b> With the organizer’s Kalshi connection configured, we create and verify one combo containing the exact winning picks.</li><li><b>Open it on Kalshi.</b> Enter the group stake, check the live payout, fees, and total cost, then submit from your account.</li></ol>
    <p className="modal-intro">Choose who is placing the league’s one shared ticket. If another member buys a copy too, that is a separate bet paid from their own account.</p>
    <div className="modal-actions"><button className="button primary" onClick={onReview}><Ticket size={17}/>Review group ticket</button><a className="button white" href="https://kalshi.com/account/profile" target="_blank" rel="noreferrer">Sign in on Kalshi <ArrowUpRight size={16}/></a></div>
    <ConnectionNote/>
  </div>;
}

function ConnectionNote() {
  return <details className="connection-note"><summary><CircleHelp size={15}/>Can I link my account and submit here?</summary><p>The organizer’s server connection can prepare a shared combo, but personal account linking and direct checkout are not enabled here. Opening Kalshi does not connect your account here, and this site cannot see whether you signed in or placed a bet.</p><p>Kalshi’s current connector authorization supports portfolio access and alerts, but not order submission. Direct checkout needs a separate trading integration. <a href="https://docs.kalshi.com/getting_started/mcp" target="_blank" rel="noreferrer">Kalshi connection details <ArrowUpRight size={12}/></a></p></details>;
}

function TicketVoters({ voters = [] }: { voters?: VoterAttribution[] }) {
  if (!voters.length) return null;
  const up = voters.reduce((sum, voter) => sum + voter.up, 0);
  const down = voters.reduce((sum, voter) => sum + voter.down, 0);
  return <details className="ticket-voters">
    <summary>Who voted <span>{up} up · {down} down</span><ChevronDown size={14}/></summary>
    <ul>{voters.map((voter, index) => <li key={index}>
      <span className="ticket-voter-name">{voter.name}</span>
      <span className="ticket-voter-count">
        {voter.up > 0 && <span>{voter.up} {voter.up === 1 ? "upvote" : "upvotes"}</span>}
        {voter.down > 0 && <span>{voter.down} {voter.down === 1 ? "downvote" : "downvotes"}</span>}
      </span>
    </li>)}</ul>
  </details>;
}

export function KalshiHandoff({ isOwner, busy, onLock, onSettings, onReopen }: {
  isOwner: boolean; busy: boolean; onLock: () => void; onSettings: () => void; onReopen: (round: string) => void;
}) {
  const [ticket, setTicket] = useState<ParlayTicket | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [combo, setCombo] = useState<PreparedCombo | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [linkError, setLinkError] = useState("");
  const version = useRef("");
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    const attempt = ++sequence.current;
    try {
      const current = await readJson<ParlayTicket>("/api/parlay", abort.signal);
      if (attempt !== sequence.current) return;
      if (version.current !== current.version) {
        if (version.current) setMessage("The group ticket changed. The selections below are now up to date.");
        version.current = current.version; setLinks({}); setLinkError(""); setCombo(null);
      }
      setTicket(current); setError("");
    } catch (cause) {
      if (!abort.signal.aborted && attempt === sequence.current) setError((cause as Error).message);
    } finally { if (attempt === sequence.current && !abort.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    load(); const timer = window.setInterval(load, 15000);
    window.addEventListener("focus", load);
    return () => { controller.current?.abort(); ++sequence.current; window.clearInterval(timer); window.removeEventListener("focus", load); };
  }, [load]);

  async function prepareLink(key: string) {
    if (!ticket || pending) return;
    setPending(key); setLinkError("");
    const requestedVersion = ticket.version;
    try {
      const result = await readJson<{ url: string; version: string }>(`/api/parlay/link?version=${encodeURIComponent(requestedVersion)}&key=${encodeURIComponent(key)}`);
      if (version.current !== requestedVersion || result.version !== requestedVersion) return;
      setLinks(previous => ({ ...previous, [key]: result.url }));
    } catch (cause) { setLinkError((cause as Error).message); }
    finally { setPending(null); }
  }
  async function copyTicket() {
    if (!ticket) return;
    try { await navigator.clipboard.writeText(ticketText(ticket, combo)); setMessage("Selections copied. No order has been placed."); }
    catch { setMessage("Clipboard unavailable. Use Download or select the text under “View ticket text” below."); }
  }
  function download() {
    if (!ticket) return;
    const url = URL.createObjectURL(new Blob([ticketText(ticket, combo)], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `fourth-and-ten-${ticket.version.slice(0, 12)}.txt`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("Selection list downloaded. It is not a bet receipt.");
  }
  if (loading) return <div className="handoff-loading" role="status"><Loader2 size={22} className="spinning"/>Loading the group’s current ticket…</div>;
  if (!ticket) return <div className="notice amber" role="alert"><CircleHelp size={18}/><span>{error || "The group ticket is unavailable."}</span><button onClick={load}>Retry</button></div>;
  const blocker = handoffBlocker(ticket), ready = !blocker && !error;
  return <div className="kalshi-handoff">
    <p className="modal-intro">One group ticket. Final review and purchase on Kalshi.</p>
    {error && <div className="notice amber" role="alert"><CircleHelp size={18}/><span>{error} Refresh before taking this ticket to Kalshi.</span><button onClick={load}>Retry</button></div>}
    <div className="handoff-ticket-summary"><div><span>{ticket.locked ? "FINAL GROUP SELECTIONS" : "DRAFT · VOTING OPEN"}</span><strong>{money(ticket.budget)}</strong><p>One combined stake · {ticket.legs.length} of {ticket.targetLegs} target legs</p></div><Ticket size={30}/></div>
    <div className="handoff-reference"><span>{ticket.legs.length} selected picks</span><button onClick={load} className="text-button"><RefreshCw size={13}/>Refresh</button></div>
    {!!ticket.conflicts?.length && <section className="ticket-conflicts" aria-label="Picks to review">
      <strong>Choose one from each overlapping pair</strong>
      {ticket.conflicts.map(conflict => <div key={conflict.keys.join("|")}><ul>{conflict.labels.map((label, index) => <li key={conflict.keys[index]}>{label}</li>)}</ul><p>{conflict.explanation}</p></div>)}
      <small>All votes and selected picks are kept until the group changes them.</small>
    </section>}
    {blocker && !ticket.conflicts?.length && <div className="notice"><LockKeyhole size={17}/><span>{blocker}</span></div>}
    {ticket.legs.length < ticket.targetLegs && ticket.legs.length >= 2 && <p className="modal-small">{ticket.legs.length} picks qualified for the {ticket.targetLegs}-leg target.</p>}
    {isOwner && !ticket.locked && <button className="button primary full" disabled={busy || ticket.legs.length < 2 || !!error || !!ticket.conflicts?.length} onClick={onLock}><LockKeyhole size={16}/>{busy ? "Locking…" : "Lock voting & finalize picks"}</button>}
    {ticket.locked && !ticket.conflicts?.length && <ComboHandoff key={ticket.version} ticket={ticket} ready={ready} isOwner={isOwner} onPrepared={setCombo}/>}
    {ticket.locked && isOwner && <div className="ticket-reopen"><button className="button white full" disabled={busy || !!error} onClick={() => onReopen(ticket.round)}><RefreshCw size={16}/>{busy ? "Reopening…" : "Reopen voting to edit picks"}</button><small>Keeps everyone’s votes. Review My votes, then lock the ticket again.</small></div>}
    <div className="handoff-leg-list">{ticket.legs.map((leg, index) => <section className="handoff-leg" key={leg.key}><span className="pick-index">{index + 1}</span><div><div className="handoff-leg-title"><strong>{leg.title}</strong><b>{leg.side.toUpperCase()}</b></div><p>{leg.condition}</p><TicketVoters voters={leg.voters}/><details className="leg-market-details"><summary>Market details <ChevronDown size={12}/></summary><code>{leg.ticker}</code>{links[leg.key] && ready ? <a className="text-button" href={links[leg.key]} target="_blank" rel="noreferrer">Open {leg.side.toUpperCase()} on Kalshi <ExternalLink size={14}/></a> : <button className="text-button" disabled={!ready || !!pending} onClick={() => prepareLink(leg.key)}>{pending === leg.key ? <Loader2 size={14} className="spinning"/> : <ExternalLink size={14}/>}Get individual market link</button>}</details></div></section>)}</div>
    {linkError && <p className="handoff-error" role="alert">{linkError}</p>}
    <details className="handoff-export-details"><summary>Copy or download ticket <ChevronDown size={14}/></summary>
    <div className="modal-actions handoff-export"><button className="button white" disabled={!!error || !ticket.legs.length} onClick={copyTicket}><Copy size={16}/>{ticket.locked ? "Copy final picks" : "Copy draft picks"}</button><button className="button white" disabled={!!error || !ticket.legs.length} onClick={download}><Download size={16}/>Download ticket</button></div>
    <details className="ticket-copy-text"><summary>View ticket text</summary><textarea aria-label="Copyable parlay selection list" readOnly rows={8} value={ticketText(ticket, combo)}/></details>

    <p className="handoff-caption">Ticket {ticket.version.slice(0, 12)} · selection reference, not an order receipt.</p></details>

    <button className="text-button centered" onClick={onSettings}>Edit ticket settings</button>
    {message && <div className="handoff-message" role="status"><Check size={16}/>{message}</div>}
    <ConnectionNote/>
  </div>;
}
