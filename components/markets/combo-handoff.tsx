"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, CircleHelp, Loader2, RefreshCw, Ticket } from "lucide-react";
import { requestPreparedCombo, type ComboConnection, type ParlayTicket, type PreparedCombo } from "@/lib/parlay-handoff";
import { money } from "@/lib/domain";

export function ComboHandoff({ ticket, ready, isOwner, onPrepared }: {
  ticket: ParlayTicket; ready: boolean; isOwner: boolean; onPrepared: (combo: PreparedCombo | null) => void;
}) {
  const [connection, setConnection] = useState<ComboConnection | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [combo, setCombo] = useState<PreparedCombo | null>(null);
  const [pending, setPending] = useState(false);
  const [waitingForLink, setWaitingForLink] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const alive = useRef(true);
  const request = useRef<AbortController | null>(null);
  const connectionRequest = useRef<AbortController | null>(null);

  async function checkConnection() {
    connectionRequest.current?.abort();
    const controller = new AbortController(); connectionRequest.current = controller;
    try {
      const response = await fetch("/api/parlay/connection", { cache: "no-store", signal: controller.signal });
      const data = await response.json() as ComboConnection & { error?: string };
      if (!response.ok) throw new Error(data.error || "Connection status is unavailable.");
      if (!controller.signal.aborted && alive.current) { setConnection(data); setConnectionError(""); }
    } catch (cause) {
      if (!controller.signal.aborted && alive.current) { setConnection(null); setConnectionError((cause as Error).message); }
    }
  }

  useEffect(() => {
    alive.current = true; checkConnection();
    window.addEventListener("focus", checkConnection);
    return () => { alive.current = false; request.current?.abort(); connectionRequest.current?.abort(); window.removeEventListener("focus", checkConnection); };
  }, []);

  useEffect(() => {
    if (!combo) return;
    const timer = window.setTimeout(() => { setCombo(null); setExpired(true); onPrepared(null); }, Math.max(0, combo.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [combo, onPrepared]);

  async function prepare() {
    if (!ready || pending || !connection?.configured) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setPending(true); setWaitingForLink(false); setError(""); setExpired(false); setCombo(null); onPrepared(null);
    try {
      const data = await requestPreparedCombo(ticket.version, {
        signal: controller.signal,
        onWaiting: () => { if (alive.current && !controller.signal.aborted) setWaitingForLink(true); },
      });
      if (data.version !== ticket.version || data.expiresAt <= Date.now()) throw new Error("The ticket changed or its check expired. Refresh and try again.");
      if (alive.current && !controller.signal.aborted) { setCombo(data); onPrepared(data); }
    } catch (cause) {
      if (alive.current && !controller.signal.aborted) setError((cause as Error).message);
    } finally { if (alive.current && !controller.signal.aborted) setPending(false); }
  }

  const available = ready && !!connection?.configured;
  const currentCombo = available && combo?.version === ticket.version && combo.expiresAt > Date.now() ? combo : null;
  return <section className="handoff-destination combo-destination" aria-label="Whole parlay handoff">
    <div><Ticket size={21}/><strong>Open the whole parlay</strong></div>
    <p>We’ll combine all {ticket.legs.length} picks. On Kalshi, enter {money(ticket.budget)} and review the payout before buying.</p>
    {connectionError ? <div className="combo-status" role="alert"><CircleHelp size={15}/><span>{connectionError}</span></div>
      : !connection ? <div className="combo-status" role="status"><Loader2 size={15} className="spinning"/>Checking the Kalshi connection…</div>
      : !connection.configured ? <div className="combo-status" role="status"><CircleHelp size={15}/><span>{connection.message}</span></div>
      : <div className="combo-status configured"><Check size={15}/><span>Kalshi connection configured</span></div>}
    {currentCombo ? <>
      <div className="combo-verified" role="status"><Check size={16}/><span>All {currentCombo.legCount} picks verified in one Kalshi combo.</span></div>
      <a className="button primary full" href={currentCombo.url} target="_blank" rel="noreferrer" onClick={event => {
        if (currentCombo.expiresAt <= Date.now()) { event.preventDefault(); setCombo(null); setExpired(true); onPrepared(null); }
      }}>Open our parlay on Kalshi <ArrowUpRight size={17}/></a>
      <small>Stake is not prefilled. Review the live quote and fees on Kalshi.</small>
      <details className="combo-details"><summary>Verified combo details</summary><code>{currentCombo.ticker}</code><p>Checked {new Date(currentCombo.preparedAt).toLocaleTimeString()}. This check expires after two minutes or when the group ticket changes. YES on this combo represents every selected side listed below, including any NO picks.</p></details>
      <button className="text-button" onClick={prepare}><RefreshCw size={14}/>Recheck combo</button>
    </> : <>
      <button className="button primary full" disabled={!available || pending} onClick={prepare}>
        {pending ? <><Loader2 size={17} className="spinning"/>{waitingForLink ? "Waiting for Kalshi’s link…" : `Preparing all ${ticket.legs.length} picks…`}</>
          : !ready ? ticket.conflicts?.length ? "Resolve overlapping picks first" : "Waiting for the final group ticket" : connection && !connection.configured ? "Kalshi setup needed" : "Prepare our parlay"}
      </button>
      <small>{pending ? (waitingForLink ? "Your combo is ready. We’re automatically checking for its link; keep this window open." : "Checking your picks and waiting for Kalshi’s link. This may take a minute.") : "Prepares the combo. Does not place a bet."}</small>
    </>}
    {expired && <p className="combo-status" role="status">The previous check expired. Prepare the parlay again for a fresh link.</p>}
    {error && <p className="handoff-error" role="alert">{error}</p>}
    {isOwner && !connection?.configured && <details className="combo-setup"><summary>Organizer: set up the Kalshi connection</summary>
      <ol><li>In <a href="https://kalshi.com/account/profile" target="_blank" rel="noreferrer">Kalshi Profile → API Keys <ArrowUpRight size={12}/></a>, create a production Ed25519 or RSA key with <code>write::trade</code> permission.</li>
        <li>Add <code>KALSHI_API_KEY_ID</code> and <code>KALSHI_PRIVATE_KEY_PEM</code> as private runtime values in this Site’s configuration, then redeploy to apply them. Keep the PEM’s line breaks.</li>
        <li>Recheck the connection below, lock the group ticket, and choose “Prepare our parlay.”</li></ol>
      <p>One organizer connection prepares the shared combo. It does not authorize anyone’s purchase. Members sign in and buy on Kalshi using their own accounts. Private keys stay on the server; do not paste them into chat or the group ticket.</p>
      <a href="https://docs.kalshi.com/getting_started/api_keys" target="_blank" rel="noreferrer">Kalshi API key instructions <ArrowUpRight size={12}/></a>
    </details>}
    {(!connection?.configured || connectionError) && <button className="text-button" onClick={checkConnection}><RefreshCw size={14}/>Recheck connection</button>}
    <p className="combo-coordination">One designated buyer for the shared ticket. Extra copies are separate bets.</p>
  </section>;
}
