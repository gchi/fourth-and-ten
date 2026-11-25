import test from 'node:test';
import assert from 'node:assert/strict';
import { changeVote, rankBallots, selectWinners, selectionConflicts, classify, leagueOf, money } from '../lib/domain.ts';
const market=(id,extras={})=>({ticker:`KXNFLGAME-E-${id}`,event:`E-${id}`,series:'KXNFLGAME',title:`Team ${id} wins`,category:'Moneyline',...extras});

test('ten up and five down are independent hard limits',()=>{
  let votes=[];
  for(let i=0;i<10;i++) votes=changeVote(votes,market(i),'yes',1);
  for(let i=10;i<15;i++) votes=changeVote(votes,market(i),'no',-1);
  assert.equal(votes.length,15);
  assert.throws(()=>changeVote(votes,market(16),'yes',1),/10 upvotes/);
  assert.throws(()=>changeVote(votes,market(16),'no',-1),/5 downvotes/);
});
test('explicit removal refunds one upvote and switching direction restores the previous budget',()=>{
  let votes=changeVote([],market(1),'no',1);
  assert.equal(changeVote(votes,market(1),'no',1,'remove').length,0);
  votes=changeVote(votes,market(1),'no',-1);
  assert.equal(votes.length,1);assert.equal(votes[0].direction,-1);
});
test('all ten upvotes can be spent on one outcome and each counts toward ranking',()=>{
  let votes=[];
  for(let i=0;i<10;i++) votes=changeVote(votes,market('A'),'yes',1);
  assert.equal(votes.length,10);
  assert.throws(()=>changeVote(votes,market('A'),'yes',1),/10 upvotes/);
  assert.throws(()=>changeVote(votes,market('B'),'yes',1),/10 upvotes/);
  const scores=rankBallots([votes,changeVote([],market('A'),'yes',-1)]);
  assert.equal(scores.length,1);assert.equal(scores[0].up,10);assert.equal(scores[0].down,1);assert.equal(scores[0].net,9);
  assert.equal(selectWinners(scores,3).length,1);
  votes=changeVote(votes,market('A'),'yes',1,'remove');
  assert.equal(votes.length,9);
  votes=changeVote(votes,market('B'),'yes',1);
  assert.equal(votes.length,10);assert.equal(votes.filter(v=>v.ticker===market('A').ticker).length,9);
});
test('removing one stacked point preserves other sides and never mutates the original ballot',()=>{
  const old=[...changeVote([],market('A'),'yes',1),...changeVote([],market('A'),'no',1)];
  const stacked=changeVote(old,market('A'),'yes',1);
  assert.equal(old.length,2);assert.equal(stacked.length,3);
  const next=changeVote(stacked,market('A'),'yes',1,'remove');
  assert.equal(next.length,2);assert.equal(next.filter(v=>v.side==='no').length,1);
  assert.throws(()=>changeVote([],market('A'),'yes',1,'remove'),/no upvotes/);
});
test('downvotes still toggle and switching returns all points on the previous direction',()=>{
  let votes=[];for(let i=0;i<10;i++)votes=changeVote(votes,market('A'),'yes',1);
  votes=changeVote(votes,market('A'),'yes',-1);
  assert.equal(votes.length,1);assert.equal(votes[0].direction,-1);
  assert.equal(changeVote(votes,market('A'),'yes',-1).length,0);
  votes=changeVote(votes,market('A'),'yes',1);
  assert.equal(votes.length,1);assert.equal(votes[0].direction,1);
});
test('yes and no outcomes have independent voting tallies',()=>{
  const a=changeVote([],market(1),'yes',1),b=changeVote([],market(1),'no',-1);
  const scores=rankBallots([a,b]);assert.equal(scores.length,2);assert.equal(scores[0].net,1);assert.equal(scores[1].net,-1);
});
test('rank uses net score, then upvotes, then deterministic ticker ordering',()=>{
  const ballots=[changeVote([],market('B'),'yes',1),changeVote([],market('A'),'yes',1),changeVote([],market('B'),'yes',1),changeVote([],market('B'),'yes',-1)];
  const scores=rankBallots(ballots);assert.equal(scores[0].market.ticker,'KXNFLGAME-E-B');assert.equal(scores[0].net,1);
  assert.equal(rankBallots(ballots.slice(0,2))[0].market.ticker,'KXNFLGAME-E-A');
});
test('winning selection uses top N positive scores and skips opposing or mutually exclusive legs',()=>{
  const a=market('A',{event:'GAME'}),b=market('B',{event:'GAME'}),c=market('C'),d=market('D');
  const vote=(m,side='yes',direction=1)=>({ticker:m.ticker,market:m,side,direction});
  const scores=rankBallots([[vote(a),vote(a,'no'),vote(b),vote(c),vote(d,'yes',-1)]]);
  const winners=selectWinners(scores,3);
  assert.equal(winners.length,2);assert.equal(winners.filter(s=>s.market.event==='GAME').length,1);
  assert.ok(winners.every(s=>s.net>0));assert.equal(selectWinners(scores,1).length,1);
});
test('changing the configured leg count selects more or fewer than three picks',()=>{
  const picks=Array.from({length:7},(_,i)=>market(`PICK-${i}`,{event:`GAME-${i}`}));
  const scores=rankBallots(picks.map(m=>[{ticker:m.ticker,market:m,side:'yes',direction:1}]));
  assert.equal(selectWinners(scores,2).length,2);
  assert.equal(selectWinners(scores,5).length,5);
  assert.deepEqual(selectWinners(scores,2),selectWinners(scores,5).slice(0,2));
  assert.equal(selectWinners(scores,20).length,7);
});
test('known series classify correctly and stake is total dollars',()=>{
  assert.equal(classify('KXNFLSPREAD'),'Spreads');assert.equal(classify('KXNFLPASSYDS'),'Player props');assert.equal(classify('KXNFLGAME'),'Moneyline');assert.equal(leagueOf('KXNCAAFGAME'),'College');assert.equal(money(1050),'$10.50');
});

const {americanToPrice,explainPrice,stakeExample,formatCents,explainSelection}=await import('../lib/odds.ts');
test('American -225 and +225 mean different probabilities and payout structures',()=>{
  const favorite=explainPrice(americanToPrice(-225));
  assert.equal(favorite.americanText,'-225');assert.equal(favorite.probabilityText,'69.2%');
  assert.ok(Math.abs(favorite.riskFor100Profit-225)<1e-10);
  const underdog=explainPrice(americanToPrice(225));
  assert.equal(underdog.americanText,'+225');assert.equal(underdog.probabilityText,'30.8%');
  assert.ok(Math.abs(underdog.profitFor100Risk-225)<1e-10);
});
test('50 cents means even money, with no favorite',()=>{
  const q=explainPrice(.5);assert.equal(q.americanText,'+100');assert.equal(q.position,'Even money');
  assert.equal(americanToPrice(-100),.5);assert.equal(americanToPrice(100),.5);
});
test('each side uses its own asking price without pretending the spread is probability',()=>{
  const yes=explainPrice(.7),no=explainPrice(.32);
  assert.equal(yes.probability,70);assert.equal(no.probability,32);
  assert.equal(yes.americanText,'-233');assert.equal(no.americanText,'+213');
  assert.ok(Math.abs(yes.contractProfit-.3)<1e-10);
});
test('missing and impossible quotes never become 0% odds',()=>{
  for(const v of [null,undefined,0,1,-.2,2,NaN,Infinity])assert.equal(explainPrice(v),null);
  for(const v of [0,99,-99,NaN,Infinity])assert.equal(americanToPrice(v),null);
  assert.equal(stakeExample(.5,0),null);assert.equal(stakeExample(.5,-1),null);
  assert.equal(formatCents(.6923),'69.23¢');
});
test('example return includes stake while profit does not',()=>{
  const ex=stakeExample(americanToPrice(-225),10);
  assert.equal(ex.stake,10);assert.ok(Math.abs(ex.profit-4.44444444)<1e-7);
  assert.ok(Math.abs(ex.returned-14.44444444)<1e-7);assert.equal(ex.loss,10);
  const plus=stakeExample(americanToPrice(225),10);
  assert.equal(plus.profit,22.5);assert.equal(plus.returned,32.5);
});
test('extreme odds stay finite and convert round trip before rounding',()=>{
  for(const p of [.01,.25,.49,.51,.9,.99]){
    const q=explainPrice(p);assert.ok(Number.isFinite(q.american));
    assert.ok(Math.abs(americanToPrice(q.american)-p)<1e-12);
  }
});
test('explanations flip with Yes/No and keep point spreads distinct from payout odds',()=>{
  const spread={title:'Indianapolis wins by over 7.5 points?',category:'Spreads'};
  assert.equal(explainSelection(spread,'yes'),'Indianapolis must win by at least 8 points.');
  assert.equal(explainSelection(spread,'no'),'Indianapolis must not win by 8 or more points.');
  const prop={title:'Justin Herbert: 325+ passing yards',category:'Player props'};
  assert.match(explainSelection(prop,'yes'),/at least 325 passing yards/);
  assert.match(explainSelection(prop,'no'),/fewer than 325 passing yards/);
  const total={title:'Full Game: over 65.5 points scored?',category:'Totals',matchup:'Indianapolis vs Houston'};
  assert.equal(explainSelection(total,'yes'),'Indianapolis vs Houston: Full Game combined score must be at least 66 points.');
  assert.match(explainSelection(total,'no'),/at most 65 points/);
  assert.match(explainSelection({title:'Full Game: under 65.5 points scored?',category:'Totals'},'yes'),/at most 65 points/);
  assert.match(explainSelection({title:'Unusual event?',category:'Futures & more'},'no'),/false: “Unusual event”/);
});


const propPick=(threshold,side='yes',extra={})=>{
  const event='KXNFLPASSYDS-26NOV15SEALV';
  const m={ticker:`${event}-LVFMENDOZA15-${threshold}`,event,title:`Fernando Mendoza: ${threshold}+ passing yards`,...extra};
  return {key:`${m.ticker}:${side}`,side,market:m};
};
test('overlapping player thresholds are named without mutating selections or votes',()=>{
  const picks=[propPick(175),propPick(225)];const before=JSON.stringify(picks);
  const conflicts=selectionConflicts(picks);assert.equal(conflicts.length,1);assert.equal(conflicts[0].kind,'redundant');
  assert.deepEqual(conflicts[0].keys,picks.map(p=>p.key));assert.match(conflicts[0].labels[0],/175.*YES/);
  assert.equal(JSON.stringify(picks),before);
  assert.equal(selectionConflicts([propPick(175,'no'),propPick(225,'no')])[0].kind,'redundant');
  assert.equal(selectionConflicts([propPick(225),propPick(175,'no')])[0].kind,'conflicting');
  assert.equal(selectionConflicts([propPick(175),propPick(225,'no')]).length,0); // valid bounded range
});
test('distinct players, games, statistics, and unknown conditions are not conflated',()=>{
  const a=propPick(175);
  const independent=[
    propPick(225,'yes',{ticker:'KXNFLPASSYDS-26NOV15SEALV-SEAQB1-225',title:'Other Player: 225+ passing yards'}),
    propPick(225,'yes',{event:'KXNFLPASSYDS-26NOV22SEALV',ticker:'KXNFLPASSYDS-26NOV22SEALV-LVFMENDOZA15-225'}),
    propPick(25,'yes',{event:'KXNFLRUSHYDS-26NOV15SEALV',ticker:'KXNFLRUSHYDS-26NOV15SEALV-LVFMENDOZA15-25',title:'Fernando Mendoza: 25+ rushing yards'}),
    propPick(225,'yes',{title:'An unfamiliar settlement condition'}),
    propPick(225,'yes',{ticker:'UNKNOWN-FORMAT'}),
  ];
  for(const b of independent)assert.deepEqual(selectionConflicts([a,b]),[]);
});
test('a team win plus its winning spread is redundant; compatible bands and other games remain available',()=>{
  const win={key:'win:yes',side:'yes',market:{ticker:'KXNFLGAME-26NOV15SFDAL-SF',event:'KXNFLGAME-26NOV15SFDAL',title:'San Francisco wins'}};
  const spread={key:'spread:yes',side:'yes',market:{ticker:'KXNFLSPREAD-26NOV15SFDAL-SF4',event:'KXNFLSPREAD-26NOV15SFDAL',title:'San Francisco wins by over 3.5 points?'}};
  assert.equal(selectionConflicts([win,spread])[0].kind,'redundant');
  assert.equal(selectionConflicts([win,{...spread,side:'no'}]).length,0);
  assert.equal(selectionConflicts([{...win,side:'no'},spread]).length,0); // leave tie settlement to Kalshi
  assert.equal(selectionConflicts([win,{...spread,market:{...spread.market,event:'KXNFLSPREAD-26NOV22SFDAL'}}]).length,0);
});
test('totals use exact integer bounds and preserve period distinctions',()=>{
  const total=(title,side='yes')=>({key:title+side,side,market:{ticker:title,event:'KXNFLTOTAL-26NOV15SFDAL',title}});
  assert.equal(selectionConflicts([total('Full Game: over 45.5 points scored?'),total('Full Game: over 50.5 points scored?')])[0].kind,'redundant');
  assert.equal(selectionConflicts([total('Full Game: over 50.5 points scored?'),total('Full Game: under 45.5 points scored?')])[0].kind,'conflicting');
  assert.equal(selectionConflicts([total('Full Game: over 45.5 points scored?'),total('Full Game: under 50.5 points scored?')]).length,0);
  assert.equal(selectionConflicts([total('Full Game: over 45.5 points scored?'),total('First Half: over 20.5 points scored?')]).length,0);
});


test('ticket attribution counts stacked votes per person and exact outcome without merging names',()=>{
  let alex=[];for(let i=0;i<4;i++)alex=changeVote(alex,market('A'),'yes',1);
  const email=changeVote([],market('A'),'yes',-1);
  const sameName=changeVote([],market('A'),'no',1);
  const names=['Alex','friend@example.test','Alex'];
  const scores=rankBallots([alex,email,sameName],names);
  assert.deepEqual(scores.find(s=>s.side==='yes').voters,[{name:'Alex',up:4,down:0},{name:'friend@example.test',up:0,down:1}]);
  assert.deepEqual(scores.find(s=>s.side==='no').voters,[{name:'Alex',up:1,down:0}]);
  const separate=rankBallots([alex,alex],['Alex','Alex'])[0];
  assert.equal(separate.voters.length,2);assert.equal(separate.up,8);
  assert.equal(rankBallots([alex])[0].voters,undefined);
});
