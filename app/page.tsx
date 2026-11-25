"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUp, ArrowDown, ArrowUpRight, ArrowRight, Check, ChevronDown, ChevronRight, CircleHelp, Copy, ExternalLink, Flag, LayoutGrid, ListFilter, Loader2, LockKeyhole, Menu, Minus, Plus, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, Ticket, Trophy, Users, Vote as VoteIcon, X } from "lucide-react";
import { OutcomeOdds, PickExplanation, MarketDetailOdds, OddsGuide } from "@/components/markets/odds-explainer";
import { KalshiHandoff, KalshiAccountInfo } from "@/components/markets/kalshi-handoff";
import { DEFAULT_PARLAY_LEGS, UPVOTE_LIMIT, DOWNVOTE_LIMIT, categories, marketUrl, money, selectWinners, type BallotState, type VoteAction, type Market, type Score, type Series } from "@/lib/domain";

type Tab = "markets" | "votes" | "results";
type Modal = "settings" | "invite" | "rules" | "review" | "members" | "odds" | "kalshi" | null;
type Queue = { series:string; cursor:string };
const shortDate=(date:string)=>new Date(date).toLocaleDateString("en-US",{month:"short",day:"numeric"});
const odds=(n:number|null)=>n==null?"—":`${(n*100).toFixed(n*100%1?1:0)}¢`;
const initials=(name:string)=>name.split(/[ @._-]/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();
async function api(path:string, init?:RequestInit) {
  const r=await fetch(path,init); const data:any=await r.json();
  if(!r.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

export default function Home() {
  const [tab,setTab]=useState<Tab>("markets"), [modal,setModal]=useState<Modal>(null), [mobileNav,setMobileNav]=useState(false);
  const [isMobile,setIsMobile]=useState(false);
  const sidebarRef=useRef<HTMLElement>(null),menuButtonRef=useRef<HTMLButtonElement>(null);
  const [group,setGroup]=useState<BallotState|null>(null),[groupError,setGroupError]=useState("");
  const [series,setSeries]=useState<Series[]>([]),[catalogError,setCatalogError]=useState("");
  const [markets,setMarkets]=useState<Market[]>([]),[category,setCategory]=useState("All markets"),[league,setLeague]=useState("NFL"),[selectedSeries,setSelectedSeries]=useState("");
  const [query,setQuery]=useState(""),[windowFilter,setWindowFilter]=useState("upcoming"),[sort,setSort]=useState("popular");
  const [loading,setLoading]=useState(true),[feedError,setFeedError]=useState(""),[lastUpdated,setLastUpdated]=useState<string|null>(null),[refreshing,setRefreshing]=useState(false);
  const [toast,setToast]=useState(""),[busy,setBusy]=useState(false),[queueLeft,setQueueLeft]=useState(0),[showCount,setShowCount]=useState(16),[detail,setDetail]=useState<Market|null>(null);
  const queue=useRef<Queue[]>([]),generation=useRef(0),loadingRef=useRef(false),groupRef=useRef(group),marketsRef=useRef(markets),visibleRef=useRef<Market[]>([]);
  groupRef.current=group; marketsRef.current=markets;
  const openModal=(next:Exclude<Modal,null>)=>{setMobileNav(false);setModal(next);};
  useEffect(()=>{
    const media=window.matchMedia("(max-width: 820px)");
    const update=()=>{setIsMobile(media.matches);if(!media.matches)setMobileNav(false);};
    update();media.addEventListener("change",update);
    return()=>media.removeEventListener("change",update);
  },[]);
  useEffect(()=>{
    if(!(isMobile&&mobileNav)&&!modal&&!detail)return;
    const previous=document.body.style.overflow;
    document.body.style.overflow="hidden";
    return()=>{document.body.style.overflow=previous;};
  },[isMobile,mobileNav,modal,detail]);
  useEffect(()=>{
    if(!isMobile||!mobileNav)return;
    const panel=sidebarRef.current;
    const controls=()=>Array.from(panel?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')??[]).filter(el=>el.getClientRects().length>0);
    panel?.querySelector<HTMLElement>(".mobile-nav-close")?.focus();
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){event.preventDefault();setMobileNav(false);return;}
      if(event.key!=="Tab")return;
      const nodes=controls(),first=nodes[0],last=nodes.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    };
    document.addEventListener("keydown",onKey);
    return()=>{document.removeEventListener("keydown",onKey);menuButtonRef.current?.focus();};
  },[isMobile,mobileNav]);
  const mobileTab=(next:Tab)=>{
    setTab(next);setQuery("");setMobileNav(false);
    window.scrollTo({top:0,behavior:"instant"});
  };
  const jumpToParlay=()=>{
    document.getElementById("group-parlay")?.scrollIntoView({block:"start",behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"});
  };

  const flash=(message:string)=>setToast(message);
  useEffect(()=>{if(!toast)return; const id=setTimeout(()=>setToast(""),4500);return()=>clearTimeout(id);},[toast]);
  const loadGroup=useCallback(async()=>{try{setGroup(await api("/api/group"));setGroupError("");}catch(e){setGroupError((e as Error).message);}},[]);
  const loadCatalog=useCallback(async()=>{try{const data=await api("/api/catalog");setSeries(data.series);setCatalogError("");}catch(e){setCatalogError((e as Error).message);setLoading(false);}},[]);
  useEffect(()=>{loadGroup();loadCatalog();const timer=setInterval(loadGroup,15000);return()=>clearInterval(timer);},[loadGroup,loadCatalog]);
  const loadMore=useCallback(async(reset=false)=>{
    if(loadingRef.current&&!reset)return;
    const gen=generation.current; loadingRef.current=true; setLoading(true);setFeedError("");
    const batch=queue.current.splice(0,4);
    const results=await Promise.allSettled(batch.map(async task=>({task,data:await api(`/api/markets?series=${encodeURIComponent(task.series)}${task.cursor?`&cursor=${encodeURIComponent(task.cursor)}`:""}`)})));
    if(gen!==generation.current)return;
    const incoming:Market[]=[]; let error="";
    results.forEach((r,i)=>{if(r.status==="fulfilled"){incoming.push(...r.value.data.markets);if(r.value.data.cursor)queue.current.push({series:r.value.task.series,cursor:r.value.data.cursor});}else{error=r.reason.message;queue.current.push(batch[i]);}});
    setMarkets(previous=>{const map=new Map((reset?[]:previous).map(m=>[m.ticker,m]));incoming.forEach(m=>map.set(m.ticker,m));return [...map.values()];});
    if(incoming.length)setLastUpdated(new Date().toISOString());
    setFeedError(error);setQueueLeft(queue.current.length);setLoading(false);loadingRef.current=false;
  },[]);
  const seriesOptions=useMemo(()=>series.filter(s=>(league==="All football"||s.league===league)&&(category==="All markets"||s.category===category)),[series,league,category]);
  useEffect(()=>{
    if(!series.length)return;
    generation.current++;loadingRef.current=false;setMarkets([]);setShowCount(16);setLastUpdated(null);
    queue.current=seriesOptions.filter(s=>!selectedSeries||s.ticker===selectedSeries).map(s=>({series:s.ticker,cursor:""}));
    setQueueLeft(queue.current.length);loadMore(true);
  },[series,seriesOptions,selectedSeries,loadMore]);
  const votes=group?.votes??[],scores=group?.scores??[];
  const scoreMap=useMemo(()=>new Map(scores.map(s=>[s.key,s])),[scores]);
  const upUsed=votes.filter(v=>v.direction===1).length,downUsed=votes.filter(v=>v.direction===-1).length;
  const winners=selectWinners(scores,group?.group.topN??DEFAULT_PARLAY_LEGS);
  const refreshPrices=useCallback(async()=>{
    const tickers=[...new Set([...visibleRef.current.slice(0,30).map(m=>m.ticker),...(groupRef.current?.scores??[]).slice(0,20).map(s=>s.market.ticker)])].slice(0,50);
    if(!tickers.length)return;
    setRefreshing(true);
    try{
      const result=await api(`/api/markets?tickers=${encodeURIComponent(tickers.join(","))}`);
      const fresh=new Map<string,Market>(result.markets.map((m:Market)=>[m.ticker,m]));
      setMarkets(prev=>prev.map(m=>fresh.get(m.ticker)??m));
      setLastUpdated(result.at);setFeedError("");
    }catch(e){setFeedError((e as Error).message);}finally{setRefreshing(false);}
  },[]);
  useEffect(()=>{const timer=setInterval(refreshPrices,30000);return()=>clearInterval(timer);},[refreshPrices]);
  const filtered=useMemo(()=>{
    let list=tab==="votes" ? [...new Map(votes.map(v=>[v.ticker,markets.find(m=>m.ticker===v.ticker)??v.market])).values()] : markets;
    const now=Date.now();
    if(tab!=="votes") list=list.filter(m=>{
      if(!["active","open"].includes(m.status)||Date.parse(m.closes)<=now)return false;
      if(windowFilter==="week") {const end=new Date();end.setDate(end.getDate()+(8-end.getDay())%7);end.setHours(0,0,0,0);if(end.getTime()<=now)end.setDate(end.getDate()+7);return Date.parse(m.occurs)<end.getTime();}
      return true;
    });
    const q=query.toLowerCase().trim();
    list=list.filter(m=>!q||`${m.title} ${m.subtitle} ${m.ticker} ${m.rules}`.toLowerCase().includes(q));
    return [...list].sort((a,b)=>sort==="soonest"?Date.parse(a.occurs)-Date.parse(b.occurs):sort==="votes"?Math.max(scoreMap.get(`${b.ticker}:yes`)?.net??0,scoreMap.get(`${b.ticker}:no`)?.net??0)-Math.max(scoreMap.get(`${a.ticker}:yes`)?.net??0,scoreMap.get(`${a.ticker}:no`)?.net??0):b.volume-a.volume);
  },[tab,markets,votes,query,windowFilter,sort,scoreMap]);
  visibleRef.current=filtered.slice(0,showCount);
  async function cast(market:Market,side:"yes"|"no",direction:1|-1,action:VoteAction="add"){
    if(busy)return;
    if(!group){openModal("rules");flash("Sign in to save your group votes.");return;}
    if(group.locked){flash("This round is locked. Your votes are saved.");return;}
    setBusy(true);
    try{const result=await api("/api/vote",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticker:market.ticker,side,direction,action,revision:group.revision,round:group.group.round})});setGroup(result);const used=result.votes.filter((v: {direction:number})=>v.direction===1).length;flash(action==="remove"?`One upvote returned. ${UPVOTE_LIMIT-used} left to spend.`:direction===1?`Upvote added. ${UPVOTE_LIMIT-used} left to spend.`:"Ballot saved.");}
    catch(e){flash((e as Error).message);await loadGroup();}finally{setBusy(false);}
  }
  async function updateSettings(body:unknown,closeModal=true){setBusy(true);try{setGroup(await api("/api/group",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}));if(closeModal)setModal(null);flash("Group settings saved. The draft parlay is up to date.");}catch(e){flash((e as Error).message);}finally{setBusy(false);}}
  async function reopenVoting(round:string) {
    setBusy(true);
    try {
      setGroup(await api("/api/group",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"reopen",round})}));
      setModal(null);setTab("votes");setQuery("");flash("Voting reopened. Your votes are saved. Lock the round again when everyone is ready.");
    } catch(e) { flash((e as Error).message); } finally {setBusy(false);}
  }
  async function copy(text:string){try{await navigator.clipboard.writeText(text);flash("Copied to clipboard.");}catch{flash("Clipboard unavailable. You can select and copy the text below.");}}
  const groupName=group?.group.name??"The Thursday Club";


  return <div className="app-shell">
    <aside id="club-navigation" ref={sidebarRef} className={`sidebar ${mobileNav?"is-open":""}`} role={isMobile?"dialog":undefined} aria-modal={isMobile&&mobileNav?true:undefined} aria-label="Club navigation" aria-hidden={isMobile&&!mobileNav?true:undefined} inert={isMobile&&!mobileNav}><button className="mobile-nav-close icon-button" aria-label="Close navigation" onClick={()=>setMobileNav(false)}><X size={22}/></button>
      <a className="brand" href="/" aria-label="Fourth and Ten home"><span className="brand-icon"><Football/></span><span>fourth<span className="brand-amp">&</span>ten<span className="brand-dot">.</span></span></a>
      <div className="club-switch"><span className="club-icon">TC</span><div><strong>{groupName}</strong><span>DYNASTY FANTASY FOOTBALL</span></div><ChevronDown size={15}/></div>
      <p className="nav-label">THE CLUBHOUSE</p>
      <nav>{([{id:"markets",label:"Market board",icon:LayoutGrid},{id:"votes",label:"My votes",icon:VoteIcon},{id:"results",label:"Group picks",icon:Trophy}] as const).map(item=><button key={item.id} className={`nav-item ${tab===item.id?"active":""}`} onClick={()=>{setTab(item.id);setMobileNav(false);setQuery("");}}><item.icon size={19}/>{item.label}{item.id==="votes"&&votes.length>0&&<span className="nav-count">{votes.length}</span>}</button>)}<button className="nav-item" onClick={()=>openModal("members")}><Users size={19}/>The group<span className="nav-count subtle">{group?.members.length??0}</span></button></nav>
      <div className="sidebar-bottom"><button className="nav-item" onClick={()=>openModal("kalshi")}><ExternalLink size={18}/>My Kalshi account</button><button className="nav-item" onClick={()=>openModal("settings")}><Settings2 size={18}/>Group settings</button><button className="nav-item" onClick={()=>openModal("odds")}><CircleHelp size={18}/>Understand the odds</button><button className="nav-item" onClick={()=>openModal("rules")}><ShieldCheck size={18}/>How it works</button><div className="profile"><span className="avatar">{initials(group?.user.name??"You")}</span><div><strong>{group?.user.name?.split("@")[0]??"Your clubhouse"}</strong><span>{group?.user.isOwner?"Club organizer":"Club member"}</span></div><span className="online-dot"/></div></div>
    </aside>
    {mobileNav&&<button className="nav-scrim" aria-label="Close navigation" onClick={()=>setMobileNav(false)}/>}
    <div className="workspace" inert={isMobile&&mobileNav}>
      <header className="topbar"><div className="breadcrumb"><button ref={menuButtonRef} className="mobile-menu icon-button" aria-label="Open navigation" aria-controls="club-navigation" aria-expanded={mobileNav} onClick={()=>setMobileNav(true)}><Menu size={22}/></button><span>The clubhouse</span><ChevronRight size={14}/><strong>{tab==="markets"?"Market board":tab==="votes"?"My votes":"Group picks"}</strong></div><div className="topbar-right"><span className="round-pill"><span/>{group?.locked?"Round locked":"Voting is open"}</span><button className="button small white" onClick={()=>openModal("invite")}><Plus size={16}/>Invite the crew</button></div></header>
      <main>
        <section className="page-heading"><div><div className="eyebrow"><span className="tiny-football">✦</span> DYNASTY FOOTBALL · THURSDAY LUNCH</div><h1>{tab==="markets"?"This week’s football.":tab==="votes"?"My votes.":"Group picks."}</h1><p>{tab==="markets"?"Thursday lunch. Questionable takes. One shared ticket.":tab==="votes"?"Your ballot, your calls. Change your mind until the round locks.":"The crowd’s favorites, ranked by upvotes minus downvotes."}</p></div><button className="text-button rules-link" onClick={()=>openModal("rules")}><CircleHelp size={16}/>How it works</button></section>
        <div className="dashboard-grid">
          <div className="main-column">

            <ParlayControls group={group} onSettings={()=>openModal("settings")}/>
            <div className="ballot-strip" aria-label="Your remaining votes"><div><span className="remaining-up"><ArrowUp size={16}/><b>{UPVOTE_LIMIT-upUsed}</b> upvotes</span><span className="remaining-down"><ArrowDown size={16}/><b>{DOWNVOTE_LIMIT-downUsed}</b> downvotes</span><span className="remaining-label">left</span></div><span className="ballot-status"><LockKeyhole size={14}/>{group?.locked?"Voting closed":"Open until locked"}</span></div>
            {groupError&&<div className="notice amber"><CircleHelp size={17}/><span>{groupError}</span><a href="/signin-with-chatgpt?return_to=%2F" target="_top">Sign in <ArrowRight size={14}/></a></div>}
            {tab!=="results"?<section id="market-section" className="market-section"><div className="section-title"><h2>{tab==="votes"?"Your ballot":"The market board"}<span>{tab==="votes"?votes.length:filtered.length}</span></h2><button className={`feed-status ${feedError?"stale":""}`} onClick={refreshPrices} disabled={refreshing}><span className="status-dot"/>{refreshing?"Refreshing…":feedError?"Prices delayed":lastUpdated?"Kalshi prices":"Connecting to Kalshi"}<RefreshCw size={12} className={refreshing?"spinning":""}/></button></div>
              {tab==="markets"&&<><div className="category-tabs">{categories.map(c=><button key={c} className={category===c?"selected":""} onClick={()=>{setCategory(c);setSelectedSeries("");}}>{c}</button>)}</div><div className="filter-row"><label className="search-box"><Search size={17}/><input aria-label="Search loaded markets" value={query} onChange={e=>{setQuery(e.target.value);setShowCount(16);}} placeholder="Search teams or players…"/>{query&&<button aria-label="Clear search" onClick={()=>setQuery("")}><X size={14}/></button>}</label><label className="select-control"><Flag size={15}/><select aria-label="Football league" value={league} onChange={e=>{setLeague(e.target.value);setSelectedSeries("");}}>{["NFL","College","Other","All football"].map(l=><option key={l}>{l}</option>)}</select><ChevronDown size={13}/></label><label className="select-control"><SlidersHorizontal size={15}/><select aria-label="Sort markets" value={sort} onChange={e=>setSort(e.target.value)}><option value="popular">Popular</option><option value="soonest">Soonest</option><option value="votes">Top voted</option></select><ChevronDown size={13}/></label></div><details className="more-filters"><summary><ListFilter size={14}/>More filters{(selectedSeries||windowFilter!=="upcoming")&&<span className="filter-active-dot" aria-label="Additional filters active"/>}<ChevronDown size={13}/></summary><div className="explore-row"><label><ListFilter size={14}/><select aria-label="All football market types" value={selectedSeries} onChange={e=>setSelectedSeries(e.target.value)}><option value="">Explore all {seriesOptions.length} market types</option>{seriesOptions.map(s=><option key={s.ticker} value={s.ticker}>{s.title}</option>)}</select></label><select aria-label="Game window" value={windowFilter} onChange={e=>setWindowFilter(e.target.value)}><option value="upcoming">All upcoming</option><option value="week">This week</option></select></div></details></>}
              {(feedError||catalogError)&&<div className="notice amber"><CircleHelp size={17}/><span>{feedError||catalogError} Last successful prices stay visible with their timestamp.</span><button onClick={()=>series.length?loadMore():loadCatalog()}>Retry</button></div>}
              <div className="market-grid">{filtered.slice(0,showCount).map(m=><MarketCard key={m.ticker} market={m} votes={votes} scores={scoreMap} onVote={cast} disabled={busy||!!group?.locked} onDetail={()=>setDetail(m)} onGuide={()=>openModal("odds")}/>)}{loading&&markets.length===0&&Array.from({length:4},(_,i)=><div className="market-skeleton" key={i}><span/><span/><span/><span/></div>)}</div>
              {!loading&&filtered.length===0&&<div className="empty-state"><span><Search size={27}/></span><h3>{tab==="votes"?"Your ballot is a blank canvas.":"No picks in this view yet."}</h3><p>{tab==="votes"?"Head to the market board and give your first take.":query?"Try another search, choose a market type, or load more markets.":"Try another market type or load the next set of open markets."}</p><button className="button primary" onClick={()=>tab==="votes"?setTab("markets"):loadMore()} disabled={loading}>{tab==="votes"?"Explore the markets":"Explore more markets"}<ArrowRight size={16}/></button></div>}
              {filtered.length>showCount?<button className="load-more" onClick={()=>setShowCount(x=>x+16)}>Show more picks <ChevronDown size={16}/></button>:tab==="markets"&&queueLeft>0&&<button className="load-more" onClick={()=>loadMore()} disabled={loading}>{loading?<Loader2 size={16} className="spinning"/>:<Plus size={16}/>} {loading?"Finding more football markets…":"Load more football markets"}</button>}
              <p className="market-footnote"><ShieldCheck size={13}/> Odds from Kalshi asks · before fees · refreshes every 30s.{lastUpdated&&<span>Updated {new Date(lastUpdated).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",second:"2-digit"})}</span>}</p>
            </section>:<section className="results-section"><div className="section-title"><h2>Group leaderboard <span>{scores.length}</span></h2><span className="quiet">{group?.members.length??0} voters</span></div><div className="results-note"><Trophy size={18}/><p>Top {group?.group.topN??DEFAULT_PARLAY_LEGS} eligible picks · ranked by net votes.</p></div>{scores.length===0?<div className="empty-state"><span><Trophy size={27}/></span><h3>Every great parlay starts with a take.</h3><p>Once your crew votes, the leaderboard comes to life.</p><button className="button primary" onClick={()=>setTab("markets")}>Cast the first vote <ArrowRight size={16}/></button></div>:scores.map((s,i)=><div className="leaderboard-row" key={s.key}><span className={`rank ${winners.some(w=>w.key===s.key)?"leading":""}`}>{String(i+1).padStart(2,"0")}</span><div><span className="mini-label">{s.market.category} · {s.side.toUpperCase()}</span><strong>{s.market.title}</strong>{winners.some(w=>w.key===s.key)&&<span className="in-ticket"><Check size={12}/>{group?.locked?"In final ticket":"In draft ticket"}</span>}</div><div className="leaderboard-tally"><span><ArrowUp size={13}/>{s.up}</span><span><ArrowDown size={13}/>{s.down}</span><b className={s.net>0?"positive":""}>{s.net>0?"+":""}{s.net}</b></div></div>)}</section>}
          </div>
          <aside className="right-column"><section className="slip" id="group-parlay" aria-label="Group parlay"><div className="slip-header"><div><span className="eyebrow">THE GROUP TICKET</span><h2>This week’s parlay<Ticket size={22}/></h2><p>{group?.locked?"Final group picks.":"Live draft · updates as the group votes."}</p></div><div className="slip-summary"><div><span>Total stake</span><strong>{`$${Math.floor((group?.group.budget??1000)/100)}`}<small>.{String((group?.group.budget??1000)%100).padStart(2,"0")}</small></strong></div><div><span>Legs / target</span><strong>{winners.length}<small> / {group?.group.topN??DEFAULT_PARLAY_LEGS}</small></strong></div></div><button className="slip-configure" onClick={()=>openModal("settings")}><Settings2 size={15}/>Edit ticket <ArrowUpRight size={14}/></button></div><div className="ticket-divider"><span/><i/><span/></div><div className="slip-body"><div className="slip-label">{group?.locked?"FINAL PICKS":"CURRENT FRONTRUNNERS"}<span>{group?.locked?<LockKeyhole size={12}/>:<span className="status-dot"/>}{group?.locked?"LOCKED":"VOTING"}</span></div>{winners.length?winners.map((s,i)=><div className="slip-pick" key={s.key}><span className="pick-index">{i+1}</span><div><strong>{s.market.title}</strong><span>{s.side.toUpperCase()} · {s.market.category}</span></div><b>+{s.net}</b></div>):<div className="empty-slip"><div className="empty-ticket"><Ticket size={29}/><span><Plus size={12}/></span></div><h3>A ticket waiting to happen.</h3><p>Upvote a pick to start the group ticket.</p></div>}<div className="slip-total"><span>Combined payout</span><strong>Quote on Kalshi <CircleHelp size={13}/></strong></div><p className="slip-disclaimer">Final price and eligibility confirmed on Kalshi.</p><button className="button primary full" onClick={()=>openModal("review")} disabled={winners.length<2}>Review parlay <ArrowRight size={16}/></button><div className="slip-footer"><LockKeyhole size={12}/>{group?.locked?"Voting is closed":"Draft until voting closes"}</div></div></section>
            <button className="crew-summary" onClick={()=>openModal("members")}><Users size={17}/><span>{group?.members.length??0} members voting</span><ChevronRight size={16}/></button>
          </aside>
        </div>
        <footer className="page-footer"><span>Built for dynasty. Funded by lunch money.</span><span>Football markets powered by <a href="https://kalshi.com" target="_blank" rel="noreferrer">Kalshi <ArrowUpRight size={11}/></a></span></footer>
      </main>
    </div>
    {!mobileNav&&<nav className="mobile-bottom-nav" aria-label="Mobile navigation"><button className={tab==="markets"?"selected":""} aria-current={tab==="markets"?"page":undefined} onClick={()=>mobileTab("markets")}><LayoutGrid size={20}/><span>Markets</span></button><button className={tab==="votes"?"selected":""} aria-current={tab==="votes"?"page":undefined} onClick={()=>mobileTab("votes")}><VoteIcon size={20}/><span>My votes {votes.length>0&&<b>{votes.length}</b>}</span></button><button className={tab==="results"?"selected":""} aria-current={tab==="results"?"page":undefined} onClick={()=>mobileTab("results")}><Trophy size={20}/><span>Group picks</span></button><button onClick={jumpToParlay} aria-label={`Jump to parlay, ${winners.length} winning picks`}><Ticket size={20}/><span>Parlay <b>{winners.length}</b></span></button></nav>}
    {toast&&!modal&&!detail&&<div className="toast" role="status"><Check size={17}/>{toast}<button aria-label="Dismiss notification" onClick={()=>setToast("")}><X size={14}/></button></div>}
    {(modal||detail)&&<ModalFrame title={detail?"Market details":modal==="settings"?"Make it your Thursday.":modal==="invite"?"Bring the group chat here.":modal==="review"?"The group ticket.":modal==="kalshi"?"Your account. Your ticket.":modal==="members"?"The Thursday crew":modal==="odds"?"Odds, without the guesswork.":"How Thursday lunch works."} onClose={()=>{setModal(null);setDetail(null);}}>
      {detail?<><span className="category-badge">{detail.league} · {detail.category}</span><h3 className="detail-title">{detail.title}</h3><MarketDetailOdds market={detail}/><h3 className="official-rules-label">Official Kalshi settlement rules</h3><p className="rules-text">{detail.rules}</p>{detail.rulesSecondary&&<p className="rules-text secondary-rules">{detail.rulesSecondary}</p>}<dl className="detail-list"><dt>Market ticker</dt><dd>{detail.ticker}</dd><dt>Yes asking price</dt><dd>{odds(detail.yes)}</dd><dt>No asking price</dt><dd>{odds(detail.no)}</dd><dt>Last retrieved</dt><dd>{new Date(detail.fetchedAt).toLocaleString()}</dd><dt>Market closes</dt><dd>{new Date(detail.closes).toLocaleString()}</dd></dl><a className="button primary full" href={marketUrl(detail)} target="_blank" rel="noreferrer">View market on Kalshi <ExternalLink size={16}/></a></>:modal==="odds"?<OddsGuide/>:modal==="settings"?<SettingsForm group={group} busy={busy} onSave={updateSettings}/>:modal==="invite"?<><p className="modal-intro">Share your clubhouse with your fantasy group. Each signed-in member gets their own {UPVOTE_LIMIT} upvotes and {DOWNVOTE_LIMIT} downvotes.</p><div className="notice"><ShieldCheck size={20}/><span>Anyone with this link can open the clubhouse. Sign in with ChatGPT to join the group and vote.</span></div><label className="form-label">YOUR CLUBHOUSE LINK<input readOnly value={typeof window!=="undefined"?window.location.origin:""}/></label><button className="button primary full" onClick={()=>copy(window.location.origin)}><Copy size={16}/>Copy invite link</button><p className="modal-small">Each friend should sign in with their own account to get a separate ballot.</p></>:modal==="review"?<KalshiHandoff key={`${group?.group.round}:${group?.locked}:${group?.group.topN}:${group?.group.budget}`} isOwner={!!group?.user.isOwner} busy={busy} onLock={()=>updateSettings({action:"lock"},false)} onSettings={()=>openModal("settings")} onReopen={reopenVoting}/>:modal==="kalshi"?<KalshiAccountInfo onReview={()=>openModal("review")}/>:modal==="members"?<><p className="modal-intro">Everyone gets {UPVOTE_LIMIT} upvotes and {DOWNVOTE_LIMIT} downvotes. Here’s who has joined this round.</p>{group?.members.length?group.members.map((m,i)=><div className="member-row" key={i}><span className={`avatar color-${i%4}`}>{initials(m.name)}</span><strong>{m.name}</strong><span><ArrowUp size={13}/>{m.up}/{UPVOTE_LIMIT}</span><span><ArrowDown size={13}/>{m.down}/{DOWNVOTE_LIMIT}</span></div>):<div className="empty-state"><Users size={32}/><p>The first voter starts the crew.</p></div>}<button className="button primary full" onClick={()=>openModal("invite")}>Invite a groupmate <Plus size={16}/></button></>:<><p className="modal-intro">Every Thursday at lunch, our Dynasty Fantasy Football League assembles to turn a little lunch money into a lot of opinions. The spreadsheet served with honor. This is its unnecessarily ambitious successor.</p>{[{n:"01",title:"Scout the board. Interrupt lunch.",text:"Browse Kalshi’s football catalog: game winners, spreads, totals, player props, and more. Choose Yes or No on any open market."},{n:"02",title:"Ten up. Five down.",text:"You have 10 upvotes and 5 downvotes per round. Each upvote tap adds one: spread them out or put all 10 on the same outcome. Use the minus button to take one back. Downvotes stay one per outcome; tap again to undo. Switching direction refunds your votes in the previous direction on that outcome. Every vote saves automatically."},{n:"03",title:"Choose this week’s leg count.",text:`The organizer sets the target leg count using Edit ticket above the markets, and can change it before the round locks. It is currently ${group?.group.topN??DEFAULT_PARLAY_LEGS}. Upvotes minus downvotes rank the shortlist; up to that many positive-score, non-conflicting picks enter the draft. Ties use upvote count, then ticker order.`},{n:"04",title:"One ticket. Someone still has to click submit.",text:`Our lunch-money tradition starts at $10, and the stake is configurable too—currently ${money(group?.group.budget??1000)} for the whole parlay. Agree on the settings and lock voting. With the organizer’s Kalshi connection configured, choose Prepare our parlay to create one verified combo, then have the designated bettor open it on Kalshi, enter the stake, and submit. Any member can also place a separate personal copy. Kalshi confirms eligibility, price, fees, and actual payout. This site does not place bets.`},{n:"05",title:"Retire as dynasty legends. Allegedly.",text:"The group-chat goal is $20 million. The realistic deliverable is fewer spreadsheet tabs and a permanent record of whose idea this was. The $20M is a joke, not an estimated return."}].map(r=><div className="rule" key={r.n}><span>{r.n}</span><div><h3>{r.title}</h3><p>{r.text}</p></div></div>)}<div className="notice"><LockKeyhole size={17}/><span>No voting deadline. The organizer locks the round when everyone is ready. Starting a new round gives everyone a fresh ballot.</span></div></>}
      {toast&&<div className="modal-toast" role="status"><Check size={17}/><span>{toast}</span><button aria-label="Dismiss notification" onClick={()=>setToast("")}><X size={18}/></button></div>}
    </ModalFrame>}
  </div>;
}

function MarketCard({market:m,votes,scores,onVote,disabled,onDetail,onGuide}:{market:Market;votes:BallotState["votes"];scores:Map<string,Score>;onVote:(m:Market,s:"yes"|"no",d:1|-1,a?:VoteAction)=>void;disabled:boolean;onDetail:()=>void;onGuide:()=>void}) {
  const [side,setSide]=useState<"yes"|"no">(votes.find(v=>v.ticker===m.ticker)?.side??"yes");
  const vote=votes.find(v=>v.ticker===m.ticker&&v.side===side),score=scores.get(`${m.ticker}:${side}`);
  const myUpvotes=votes.filter(v=>v.ticker===m.ticker&&v.side===side&&v.direction===1).length;
  const upvotesLeft=UPVOTE_LIMIT-votes.filter(v=>v.direction===1).length;
  const voted=!!vote;
  const old=Date.now()-Date.parse(m.fetchedAt)>90000;
  const subtitle=m.event.replace(m.series+"-","").replace(/^\d{2}[A-Z]{3}\d{2}/,"");
  return <article className={`market-card ${voted?"has-vote":""}`}><div className="card-top"><span className={`category-badge ${m.category==="Player props"?"purple":m.category==="Spreads"?"blue":""}`}>{m.category}</span><span className="card-date">{m.league} <span>·</span> {shortDate(m.occurs)}</span><button className="icon-button" onClick={onDetail} aria-label={`Details for ${m.title}`}><ArrowUpRight size={15}/></button></div><div className="market-title"><span className={`market-symbol ${m.category==="Player props"?"purple":m.category==="Spreads"?"blue":""}`}>{m.category==="Player props"?<Users size={22}/>:m.category==="Totals"?<span>O/U</span>:m.category==="Spreads"?<span>±</span>:<Football/>}</span><div><h3>{m.title}</h3><span>{m.matchup||(m.subtitle&&m.subtitle!==m.title?m.subtitle:subtitle||"Football")} <span>·</span> {m.category==="Moneyline"?"Game winner":"Kalshi football"}</span></div></div><div className="outcomes explained-outcomes" role="group" aria-label={`Choose an outcome for ${m.title}`}>{(["yes","no"] as const).map(s=><button key={s} className={side===s?`chosen ${s}`:""} aria-pressed={side===s} onClick={()=>setSide(s)}><span className="outcome-name">{side===s?<Check size={14}/>:<i/>}{s==="yes"?"Yes":"No"}</span><OutcomeOdds price={m[s]}/></button>)}</div><PickExplanation market={m} side={side} onGuide={onGuide} compact/><div className="card-voting stacked-voting"><div className="vote-buttons"><button aria-label={`Remove one upvote from ${side}: ${m.title}`} title="Take one upvote back" disabled={disabled||myUpvotes===0} className="remove-upvote" onClick={()=>onVote(m,side,1,"remove")}><Minus size={15}/></button><button aria-label={`Add one upvote to ${side}: ${m.title}`} title={upvotesLeft?"Each click adds one upvote to this pick":`All ${UPVOTE_LIMIT} upvotes are used. Take one back to move it.`} disabled={disabled||upvotesLeft===0} className={myUpvotes?"up chosen":"up"} onClick={()=>onVote(m,side,1,"add")}><ArrowUp size={16}/><span>Back {side.toUpperCase()}</span>{myUpvotes>0&&<b className="my-vote-count">{myUpvotes}</b>}<Plus size={12}/></button><button aria-label={`Downvote ${side}: ${m.title}`} title={myUpvotes?`Replace your ${myUpvotes} upvotes with one downvote; your upvotes are returned`:vote?.direction===-1?"Remove your downvote":"Use one downvote"} aria-pressed={vote?.direction===-1} disabled={disabled} className={vote?.direction===-1?"down chosen":"down"} onClick={()=>onVote(m,side,-1)}><ArrowDown size={16}/><span>Pass</span></button></div><span className={`net-score ${(score?.net??0)>0?"positive":""}`} title={`${score?.up??0} group upvotes and ${score?.down??0} group downvotes`}>{`Group ${(score?.net??0)>0?"+":""}${score?.net??0}`}</span></div>{old&&<span className="stale-label">Price from {new Date(m.fetchedAt).toLocaleTimeString()} · refresh to update</span>}</article>;
}


function ParlayControls({group,onSettings}:{group:BallotState|null;onSettings:()=>void}) {
  return <section className="round-summary" aria-label="Parlay settings">
    <div className="round-summary-label"><Ticket size={18}/><span>This week’s ticket</span></div>
    <div className="round-summary-values"><strong>{money(group?.group.budget??1000)}<small> stake</small></strong><span aria-hidden="true">·</span><strong>{group?.group.topN??DEFAULT_PARLAY_LEGS}<small> legs</small></strong></div>
    <button className="text-button" onClick={onSettings}><Settings2 size={15}/>{group?.locked?"Settings":group?.user.isOwner?"Edit ticket":"View settings"}</button>
  </section>;
}

function SettingsForm({group,busy,onSave}:{group:BallotState|null;busy:boolean;onSave:(b:unknown)=>void}) {
  const [name,setName]=useState(group?.group.name??"The Thursday Club"),[budget,setBudget]=useState(String((group?.group.budget??1000)/100)),[topN,setTopN]=useState(group?.group.topN??DEFAULT_PARLAY_LEGS);
  return <form onSubmit={e=>{e.preventDefault();onSave({name,budget:Math.round(Number(budget)*100),topN:Number(topN)});}}><p className="modal-intro">Set the stake and leg count. Voting stays open until you lock the round.</p>{!group?.user.isOwner&&<div className="notice"><LockKeyhole size={18}/><span>Only the club organizer can change these settings.</span></div>}<fieldset disabled={!group?.user.isOwner||busy||group.locked}><label className="form-label">CLUB NAME<input required maxLength={60} value={name} onChange={e=>setName(e.target.value)}/></label><div className="form-columns"><label className="form-label">TOTAL PARLAY STAKE ($)<input type="number" min="1" max="1000" step="0.01" required value={budget} onChange={e=>setBudget(e.target.value)}/></label><label className="form-label">PARLAY LEGS · 2–20<input type="number" min="2" max="20" required value={topN} onChange={e=>setTopN(Number(e.target.value))}/></label></div><p className="modal-small">One stake for the whole parlay. Up to this many eligible, positive-score picks qualify.</p><button className="button primary full" disabled={busy} type="submit">{busy?"Saving…":"Save group settings"}<Check size={16}/></button></fieldset>{group?.user.isOwner&&<div className="round-controls"><strong>{group.locked?"Ready for next Thursday?":"Ready to call it?"}</strong><p>{group.locked?`Start a fresh round with the same stake and a ${DEFAULT_PARLAY_LEGS}-pick target. Everyone gets a fresh ballot; previous votes stay archived.`:"Locking ends voting immediately and freezes this round’s results."}</p><button type="button" className="button white full" disabled={busy} onClick={()=>onSave({action:group.locked?"new-round":"lock"})}>{group.locked?<RefreshCw size={16}/>:<LockKeyhole size={16}/>} {group.locked?"Start a new round":"Lock this round"}</button></div>}</form>;
}

function ModalFrame({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null),titleId=useId();
  useEffect(()=>{const dialog=ref.current;dialog?.showModal();return()=>{dialog?.close();};},[]);
  return <dialog ref={ref} className="modal" aria-labelledby={titleId} onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><div className="modal-content"><div className="modal-header"><div><span className="eyebrow">FOURTH & TEN</span><h2 id={titleId}>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={21}/></button></div>{children}</div></dialog>;
}
function Football(){return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M6 25C1 10 10 1 26 6c5 15-4 24-20 19Z" stroke="currentColor" strokeWidth="2"/><path d="m10 22 12-12m-10 5 5 5m-2-8 5 5m-2-8 5 5M4 17l11 11M17 4l11 11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>}
