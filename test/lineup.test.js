import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {fullStrengthAssessment} from '../src/ratings/lineup.js';
import {RatingEngine} from '../src/ratings/model.js';
import {ratingTournament} from './helpers.js';

const base=JSON.parse(fs.readFileSync(new URL('../config/model_v2.6.json',import.meta.url)));
const lineup={enabled:true,secondaryPrior:.05,secondaryPerformanceDrop:350,performanceNoise:175,
  minimumWeight:.05,minimumHistory:3,nearbyDays:2,nearbyOddsMultiplier:32,
  partialCoverageThreshold:.85,partialOddsMultiplier:4,singleSquadOddsMultiplier:2.5,autumnOddsMultiplier:1.5};
const evidence={level:'Invitational',performanceDeficit:200,uncertainty:30,appearances:20,
  evidenceCoverage:1,sameDayTournamentCount:1,daysSincePreviousAppearance:30,
  squadCount:2,usualSquadCount:2,month:2};
const assess=patch=>fullStrengthAssessment({...evidence,...patch},lineup);

test('lineup inference distinguishes an ordinary bad day from a severe surprise',()=>{
  assert.ok(assess({performanceDeficit:250}).probability>.8);
  assert.ok(assess({performanceDeficit:800}).probability<=.1);
  assert.equal(assess({performanceDeficit:-200}).probability,1);
});
test('championship results and schools without sufficient history are fully counted',()=>{
  for(const level of ['States','State','Regional','Regionals','Nationals']) {
    assert.equal(assess({level,performanceDeficit:2000}).probability,1);
  }
  assert.equal(assess({appearances:2,performanceDeficit:2000}).probability,1);
});
test('lineup context strengthens evidence while uncertainty weakens the inference',()=>{
  const normal=assess({}).probability;
  for(const patch of [{sameDayTournamentCount:2},{daysSincePreviousAppearance:1},
    {evidenceCoverage:.8},{squadCount:1},{month:10}]) assert.ok(assess(patch).probability<normal);
  assert.ok(assess({performanceDeficit:500,uncertainty:190}).probability>
    assess({performanceDeficit:500,uncertainty:20}).probability);
  assert.equal(assess({daysSincePreviousAppearance:-1}).probability,normal);
});
test('even extreme poor results retain a finite nonzero evidence floor',()=>{
  assert.equal(assess({performanceDeficit:1e9}).weight,lineup.minimumWeight);
  assert.ok(assess({performanceDeficit:1e9}).probability<lineup.minimumWeight);
  assert.equal(fullStrengthAssessment(evidence,{...lineup,enabled:false}).probability,1);
});

function seededEngine(config,tournament) {
  const engine=new RatingEngine(config);
  for(const entry of tournament.teamEntries) engine.states.set(entry.schoolKey,{
    ...engine.currentState(entry),rating:entry.canonicalName==='Favorite'?2500:1500,
    uncertainty:35,appearances:20,lastSeason:2026,lastDate:'2026-01-01',recentSquadCounts:[2,2,2],
  });
  return engine;
}
const upset=()=>ratingTournament({id:'upset',date:'2026-02-01',schools:[
  {name:'Favorite',rank:2},{name:'Underdog',rank:1},
]});
test('a likely secondary lineup reduces both its loss and the opponent credit in a dual',()=>{
  const t=upset();
  const original=seededEngine(base,t).rateTournament(t);
  const changed=seededEngine({...base,lineupModel:lineup},t).rateTournament(t);
  for(const name of ['Favorite','Underdog']) {
    const a=original.find(s=>s.canonicalName===name),b=changed.find(s=>s.canonicalName===name);
    assert.ok(Math.abs(b.ratingChange)<Math.abs(a.ratingChange));
    assert.ok(b.postUncertainty>=a.postUncertainty);
    assert.equal(b.expectedRank,a.expectedRank);
    assert.equal(b.expectedPerformance,a.expectedPerformance);
    assert.equal(b.actualPerformance,a.actualPerformance);
  }
  assert.ok(changed.find(s=>s.canonicalName==='Favorite').ratingChange<0);
});
test('future appearances do not change an earlier lineup assessment',()=>{
  const first=upset();
  const future=ratingTournament({id:'future',date:'2026-02-02',schools:[
    {name:'Favorite',rank:1},{name:'Underdog',rank:2},
  ]});
  const config={...base,lineupModel:lineup};
  const prefix=seededEngine(config,first).rebuild([first]).snapshots;
  const extended=seededEngine(config,first).rebuild([future,first]).snapshots.filter(s=>s.tournamentId==='upset');
  assert.deepEqual(extended,prefix);
});
test('a perfect win is never discounted by the finite performance-rating clamp',()=>{
  const t=ratingTournament({schools:[{name:'Favorite',rank:1},{name:'Underdog',rank:2}]});
  const favorite=seededEngine({...base,lineupModel:lineup},t).rateTournament(t).find(s=>s.canonicalName==='Favorite');
  assert.equal(favorite.fullStrengthWeight,1);
  assert.equal(favorite.fullStrengthProbability,1);
  assert.equal(favorite.performanceDeficit,0);
});
test('assessments are independent of participant processing order',()=>{
  const t=ratingTournament({schools:[{name:'Favorite',rank:3},{name:'Second',rank:2},{name:'Winner',rank:1}]});
  const config={...base,lineupModel:lineup};
  const original=seededEngine(config,t).rateTournament(t);
  const reversed=structuredClone(t);reversed.teamEntries.reverse();
  const other=seededEngine(config,t).rateTournament(reversed);
  for(const a of original){
    const b=other.find(s=>s.schoolId===a.schoolId);
    assert.ok(Math.abs(a.fullStrengthProbability-b.fullStrengthProbability)<1e-12);
    assert.ok(Math.abs(a.ratingChange-b.ratingChange)<1e-10);
  }
});
