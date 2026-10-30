import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {loadArchive} from '../src/ingest/archive.js';
import {RatingEngine} from '../src/ratings/model.js';
import {rankMetrics} from '../src/analysis/rank-metrics.js';

const archivePath=process.argv[2];
const base=JSON.parse(fs.readFileSync('config/model_v2.6.json'));
const {tournaments,errors}=loadArchive(archivePath);
if(!tournaments.length || errors.length) throw new Error(JSON.stringify(errors));
const archive=tournaments.filter(t=>t.season<=2026);
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
function ranks(xs){
  const order=xs.map((value,i)=>({value,i})).sort((a,b)=>a.value-b.value),out=[];
  for(let i=0;i<order.length;){let j=i+1;while(j<order.length&&order[j].value===order[i].value)j++;
    for(let k=i;k<j;k++)out[order[k].i]=(i+j+1)/2;i=j;}
  return out;
}
function rho(a,b){
  const x=ranks(a),y=ranks(b),m=(x.length+1)/2;
  return x.reduce((s,v,i)=>s+(v-m)*(y[i]-m),0)/Math.sqrt(x.reduce((s,v)=>s+(v-m)**2,0)*y.reduce((s,v)=>s+(v-m)**2,0));
}
function nationalsMetrics(rows){
  const top=rows.filter(r=>r.rank<=25);
  return {n:rows.length,spearman:rho(rows.map(r=>-r.rating),rows.map(r=>r.rank)),
    top25Spearman:rho(top.map(r=>-r.rating),top.map(r=>r.rank))};
}
const lineup={enabled:true,secondaryPrior:0.05,secondaryPerformanceDrop:350,performanceNoise:175,
  minimumWeight:0.05,minimumHistory:3,nearbyDays:2,nearbyOddsMultiplier:32,
  partialCoverageThreshold:0.85,partialOddsMultiplier:4,singleSquadOddsMultiplier:2.5,autumnOddsMultiplier:1.5};
const grid=[['baseline',null],['blanket-half-losses',null]];
for(const noise of [140,175,210])for(const drop of [250,350,450])grid.push([
  `mixture-noise=${noise}-drop=${drop}`,{...lineup,performanceNoise:noise,secondaryPerformanceDrop:drop}]);
const report={archiveCommit:execFileSync('git',['-C',archivePath,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  protocol:'Retrospective chronological replays. Fixed 3x3 grid. Select maximum mean 2022-2024 Nationals Spearman among candidates that also improve 2022-2024 all-tournament NMAE; inspect 2025 and 2026 without reselection. Previously inspected years are not pristine holdouts. No Nationals-specific correction is added.',
  baselineConfig:base,candidates:[]};
for(const [name,lineupModel] of grid){
  const start=Date.now();
  const engine=new RatingEngine({...structuredClone(base),lineupModel});
  const fields=[];
  const original=engine.rateTournament.bind(engine);
  engine.rateTournament=(t,o)=>{
    if(t.level.toLowerCase()==='nationals' && t.season>=2015){
      const entries=t.teamEntries.filter(e=>e.representativeForSchool&&!e.exhibition&&!e.disqualified&&Number.isFinite(e.officialOverallRank));
      fields.push({season:t.season,...nationalsMetrics(entries.map(e=>({
        rating:(o?.stateOverrides?.get(e.schoolKey)??engine.prepareState(e,t)).rating,
        rank:1+entries.reduce((sum,other)=>sum+(other===e?0:other.officialOverallRank<e.officialOverallRank?1:other.officialOverallRank===e.officialOverallRank?0.5:0),0),
      })))});
    }
    const rows=original(t,o);
    return name==='blanket-half-losses'&&t.level.toLowerCase()==='invitational'?rows.map(s=>s.ratingChange<0?
      {...s,ratingChange:s.ratingChange/2,postRating:s.preRating+s.ratingChange/2}:s):rows;
  };
  const {snapshots}=engine.rebuild(archive);
  const windows=Object.fromEntries([[2015,2021],[2022,2024],[2025,2025],[2026,2026],[2015,2026]].map(([a,b])=>{
    const selected=snapshots.filter(s=>s.season>=a&&s.season<=b),ns=fields.filter(t=>t.season>=a&&t.season<=b);
    return [`${a}-${b}`,{...rankMetrics(selected),nationalsSpearman:mean(ns.map(t=>t.spearman)),
      nationalsTop25Spearman:mean(ns.map(t=>t.top25Spearman)),
      discounted:selected.filter(s=>s.fullStrengthProbability<.5).length,
      minimallyCounted:selected.filter(s=>s.fullStrengthWeight<=.05).length}];
  }));
  const examples=snapshots.filter(s=>s.canonicalName==='Monta Vista High School'&&s.season===2026).map(s=>({
    tournament:s.tournamentId,preRating:s.preRating,performanceDeficit:s.performanceDeficit,
    prior:s.fullStrengthPrior,probability:s.fullStrengthProbability,weight:s.fullStrengthWeight,delta:s.ratingChange,rank:s.representativeOverallRank,
  }));
  const result={name,lineupModel,seconds:(Date.now()-start)/1000,windows,perNationals:fields,examples};
  report.candidates.push(result);
  const baseline=report.candidates[0].windows['2022-2024'];
  const eligible=report.candidates.filter(c=>c.lineupModel&&c.windows['2022-2024'].normalizedRankMeanAbsoluteError<baseline.normalizedRankMeanAbsoluteError);
  report.selected=eligible.sort((a,b)=>b.windows['2022-2024'].nationalsSpearman-a.windows['2022-2024'].nationalsSpearman)[0]?.name??'baseline';
  fs.writeFileSync('output/lineup_model_study.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({name,seconds:result.seconds,train:windows['2022-2024'],comparison2026:windows['2026-2026'],selected:report.selected}));
}
