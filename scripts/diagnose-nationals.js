// Diagnostic ablations only: never changes production config or ratings.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadArchive } from '../src/ingest/archive.js';
import { RatingEngine } from '../src/ratings/model.js';
import { rankMetrics } from '../src/analysis/rank-metrics.js';

const config = JSON.parse(fs.readFileSync('config/model_v2.6.json'));
const archivePath = process.argv[2];
const { tournaments, errors } = loadArchive(archivePath);
if (!tournaments.length || errors.length) throw new Error(JSON.stringify(errors));
const archive = tournaments.filter(t => t.season <= 2026);
const output = 'output/nationals_diagnosis.json';
function ranks(values) {
  const order = values.map((value, i) => ({ value, i })).sort((a,b) => a.value-b.value);
  const result = Array(values.length);
  for (let i=0;i<order.length;) {
    let j=i+1;
    while (j<order.length && order[j].value===order[i].value) j++;
    for (let k=i;k<j;k++) result[order[k].i]=(i+j+1)/2;
    i=j;
  }
  return result;
}
function correlation(a,b) {
  const x=ranks(a), y=ranks(b), n=x.length, m=(n+1)/2;
  const denominator=Math.sqrt(x.reduce((s,v)=>s+(v-m)**2,0)*y.reduce((s,v)=>s+(v-m)**2,0));
  return denominator ? x.reduce((s,v,i)=>s+(v-m)*(y[i]-m),0)/denominator : null;
}
function metrics(rows) {
  const actual=rows.map(r=>r.representativeOverallRank);
  const predicted=ranks(rows.map(r=>-r.preRating));
  const top=rows.filter(r=>r.representativeOverallRank<=25);
  return { n: rows.length, spearman: correlation(rows.map(r=>-r.preRating),actual),
    top25Spearman: correlation(top.map(r=>-r.preRating),top.map(r=>r.representativeOverallRank)),
    rankMAE: predicted.reduce((s,v,i)=>s+Math.abs(v-actual[i]),0)/rows.length,
    top10Hits: rows.filter((r,i)=>predicted[i]<=10 && actual[i]<=10).length };
}
const average = values => values.reduce((s,v)=>s+v,0)/values.length;
function summarize(items) {
  return Object.fromEntries(['spearman','top25Spearman','rankMAE','top10Hits'].map(k=>[k,average(items.map(i=>i[k]))]));
}
class DiagnosticEngine extends RatingEngine {
  performanceRating() { return 0; } // Unused diagnostic; avoids expensive bisection.
}
const report = { archiveCommit: execFileSync('git',['-C',archivePath,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  protocol: 'Retrospective fixed one-factor ablations, chronological full-archive replay. No hyperparameter selection claim or untouched holdout. Nationals correlations averaged equally per tournament. Production unchanged.',
  config, candidates: [], nationalsFields: [] };
report.lineupExamples=archive.filter(t=>['2026-02-21_triton_invitational_c','2026-01-20_official_california_invitational_c','2025-10-11_georgia_scrimmage_c'].includes(t.id)).map(t=>({
  id:t.id,date:t.date,format:t.format,school:'Monta Vista High School',
  squads:t.teamEntries.filter(e=>e.canonicalName==='Monta Vista High School').map(e=>({
    number:e.number,suffix:e.suffix,rank:e.officialOverallRank,coverage:e.evidenceCoverage,selected:e.representativeForSchool,
  })),
}));
for (const t of archive.filter(t=>t.level.toLowerCase()==='nationals' && t.season>=2015)) {
  report.nationalsFields.push({ id:t.id, season:t.season, entries:t.teamEntries.map(e=>({
    schoolId:e.schoolId, name:e.canonicalName, city:e.city, state:e.state,
    rank:e.officialOverallRank, coverage:e.evidenceCoverage, exhibition:e.exhibition,
    disqualified:e.disqualified, representative:e.representativeForSchool,
  })), events:t.events.filter(e=>e.official).map(e=>e.canonicalName) });
}
const candidates=[
  ['baseline',{}],
  ...[0.7,0.9,0.98].map(c=>[`carry=${c}`,{divisionCarryover:{C:c,default:c}}]),
  ...[45,135,180].map(k=>[`K=${k}`,{baseK:k}]),
  ['no-margin',{scoreMarginLogStrength:0}],
  ['equal-formats',{formatPrior:{traditional:1,hybrid:1,satellite:1}}],
  ['equal-levels',{levelPrior:Object.fromEntries(Object.keys(config.levelPrior).map(k=>[k,1]))}],
  ['nationals-weight=3.1',{levelPrior:{...config.levelPrior,nationals:3.1},maximumInformationWeight:5}],
  ['correct-field-clamp',{},'clamp'],
  ['no-field-quality',{},'no-field'],
  ['invitationals-ignore-negative',{},'ignore-negative'],
  ['invitationals-negative=0.25',{},'negative=0.25'],
  ['invitationals-negative=0.5',{},'negative=0.5'],
  ['invitationals-negative=0.75',{},'negative=0.75'],
  ['all-levels-ignore-negative',{},'all-ignore-negative'],
  ['invitational-learning=0.5',{},'invite-learning=0.5'],
  ['ignore-negative-incomplete-invitational',{},'incomplete'],
  ['ignore-negative-satellite-invitational',{},'satellite'],
  ['ignore-negative-autumn-invitational',{},'autumn'],
  ['ignore-negative-traditional-invitational',{},'traditional'],
  ['incomplete-invitational-learning=0.25',{},'incomplete-learning'],
  ['satellite-invitational-learning=0.25',{},'satellite-learning'],
  ['identity-without-city',{},'no-city'],
];
for (const [name,patch,mode] of candidates) {
  const start=Date.now();
  const keys=mode==='no-city'?archive.flatMap(t=>t.teamEntries.map(e=>[e,e.schoolKey])):[];
  for(const [entry] of keys) entry.schoolKey=entry.schoolKey.split('|').filter((_,i)=>i!==1).join('|');
  const engine = new DiagnosticEngine({...structuredClone(config),...patch});
  if (mode==='clamp' || mode==='no-field') {
    const original=engine.tournamentInformationWeight.bind(engine);
    engine.tournamentInformationWeight=(prepared,tournament)=>{
      const r=original(prepared,tournament);
      const total=prepared.reduce((s,i)=>s+i.evidenceWeight,0);
      const established=prepared.reduce((s,i)=>s+(i.state.appearances>=3?i.evidenceWeight:0),0)/total;
      r.fieldQuality=mode==='no-field'?1:Math.max(config.minimumFieldQuality,Math.min(config.maximumFieldQuality,
        1+(r.fieldStrength-config.mean)/config.fieldQualityRatingDivisor+config.establishedFieldQualityWeight*(established-0.5)));
      const level=config.levelPrior[String(tournament.level).toLowerCase()]??config.levelPrior.default;
      r.informationWeight=Math.max(config.minimumInformationWeight,Math.min(config.maximumInformationWeight,level*r.fieldQuality*r.formatPrior));
      return r;
    };
  }
  if (mode==='ignore-negative' || mode?.startsWith('negative=') || mode==='all-ignore-negative' || mode==='invite-learning=0.5' || ['incomplete','satellite','autumn','traditional','incomplete-learning','satellite-learning'].includes(mode)) {
    const original=engine.rateTournament.bind(engine);
    engine.rateTournament=(t,o)=>original(t,o).map(s=>{
      let applies=mode==='all-ignore-negative' || String(t.level).toLowerCase()==='invitational';
      if(mode==='incomplete' || mode==='incomplete-learning') applies=applies && s.evidenceCoverage<.95;
      if(mode==='satellite' || mode==='satellite-learning') applies=applies && t.format==='satellite';
      if(mode==='traditional') applies=applies && t.format==='traditional';
      if(mode==='autumn') applies=applies && Number(t.date.slice(5,7))>=9;
      const learning=['incomplete-learning','satellite-learning'].includes(mode);
      const factor=mode==='invite-learning=0.5'?0.5:learning?0.25:mode?.startsWith('negative=')?Number(mode.split('=')[1]):0;
      if(applies && (s.ratingChange<0 || mode==='invite-learning=0.5' || learning)) return {...s,
        ratingChange:s.ratingChange*factor,postRating:s.preRating+s.ratingChange*factor};
      return s;
    });
  }
  const allSchoolNationals=[];
  const rate=engine.rateTournament.bind(engine);
  engine.rateTournament=(t,o)=>{
    if(t.level.toLowerCase()==='nationals') {
      const entries=t.teamEntries.filter(e=>e.representativeForSchool && !e.exhibition && !e.disqualified && Number.isFinite(e.officialOverallRank));
      for(const e of entries) {
        const state=o?.stateOverrides?.get(e.schoolKey)??engine.prepareState(e,t);
        allSchoolNationals.push({schoolId:e.schoolId,canonicalName:e.canonicalName,state:e.state,
          tournamentId:t.id,date:t.date,season:t.season,preRating:state.rating,
          representativeOverallRank:1+entries.reduce((sum,other)=>sum+(other===e?0:other.officialOverallRank<e.officialOverallRank?1:other.officialOverallRank===e.officialOverallRank?0.5:0),0)});
      }
    }
    return rate(t,o);
  };
  const {snapshots}=engine.rebuild(archive);
  const groups=new Map();
  for (const s of snapshots.filter(s=>s.season>=2015 && s.level.toLowerCase()==='nationals')) {
    if (!groups.has(s.tournamentId)) groups.set(s.tournamentId,[]);
    groups.get(s.tournamentId).push(s);
  }
  const perSeason=[...groups].map(([id,rows])=>({id,season:rows[0].season,...metrics(rows)}));
  const windows=Object.fromEntries([[2015,2026],[2015,2021],[2022,2024],[2025,2026]].map(([a,b])=>[
    `${a}-${b}`,summarize(perSeason.filter(s=>s.season>=a && s.season<=b))]));
  const result={name,patch,mode,seconds:(Date.now()-start)/1000,windows,perSeason};
  result.allTournamentRankMetrics2022Plus=rankMetrics(snapshots.filter(s=>s.season>=2022));
  const allGroups=new Map();
  for(const s of allSchoolNationals.filter(s=>s.season>=2015)) {
    if(!allGroups.has(s.tournamentId)) allGroups.set(s.tournamentId,[]);
    allGroups.get(s.tournamentId).push(s);
  }
  result.fullFieldPerSeason=[...allGroups.values()].map(rows=>({season:rows[0].season,...metrics(rows)}));
  result.fullFieldAverage=summarize(result.fullFieldPerSeason);
  result.predictions2026=allSchoolNationals.filter(s=>s.season===2026).sort((a,b)=>b.preRating-a.preRating).map((s,i)=>({...s,predictedRank:i+1}));
  if(['baseline','invitationals-ignore-negative','invitationals-negative=0.5'].includes(name)) result.nationalsPredictions=allSchoolNationals;
  if(name==='baseline') {
    report.baselineNationals=[...groups.values()].flat();
    report.allNationals=snapshots.filter(s=>s.level.toLowerCase()==='nationals').map(s=>({
      schoolId:s.schoolId,season:s.season,date:s.date,tournamentId:s.tournamentId,
      preRating:s.preRating,actualRank:s.representativeOverallRank,
    }));
    report.fullFieldNationals=allSchoolNationals;
    report.baselineReplayCheck={snapshots:snapshots.length,first:snapshots[0].preRating,last:snapshots.at(-1).preRating};
    // Covariates and exact past updates for diagnosing the largest misses.
    report.recentHistories=snapshots.filter(s=>s.season>=2022).map(s=>({
      schoolId:s.schoolId,canonicalName:s.canonicalName,season:s.season,date:s.date,tournamentId:s.tournamentId,
      level:s.level,rank:s.representativeOverallRank,preRating:s.preRating,postRating:s.combinedSameDayPostRating,
      delta:s.ratingChange,coverage:s.evidenceCoverage,fieldSize:s.fieldSize,
    }));
  }
  report.candidates.push(result);
  for(const [entry,key] of keys) entry.schoolKey=key;
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({name,seconds:result.seconds,all:windows['2015-2026'],recent:windows['2025-2026']}));
}
