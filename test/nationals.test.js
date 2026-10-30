import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {NationalsAdjustment} from '../src/ratings/nationals.js';
import {RatingEngine} from '../src/ratings/model.js';
import {spearman} from '../src/analysis/nationals-metrics.js';
import {ratingTournament} from './helpers.js';

const base=JSON.parse(fs.readFileSync(new URL('../config/model_v2.7.json',import.meta.url)));
const settings={enabled:true,strength:1,priorAppearances:5};
const config={...base,nationalsAdjustment:settings};
function tournament(id,date,season,reverse=false){return ratingTournament({id,date,season,level:'Nationals',schools:[
  {name:'Alpha',rank:reverse?2:1},{name:'Beta',rank:reverse?1:2},
]});}

test('Nationals adjustments are shrunk and only use strictly earlier dates',()=>{
  const model=new NationalsAdjustment(settings);
  assert.equal(model.summary('Alpha','2026-05-01').adjustment,0);
  model.observeField([{schoolId:'Alpha',tournamentId:'prior',date:'2025-05-01',nationalsResidual:60,evidenceCoverage:1}]);
  assert.equal(model.summary('Alpha','2025-05-01').adjustment,0);
  assert.equal(model.summary('Alpha','2026-05-01').adjustment,10);
  assert.equal(model.summary('Alpha','2026-05-01').appearances,1);
  model.observeField([{schoolId:'Alpha',tournamentId:'future',date:'2027-05-01',nationalsResidual:900,evidenceCoverage:1}]);
  assert.equal(model.summary('Alpha','2026-05-01').adjustment,10);
});
test('unused registrations do not become Nationals history and duplicates cannot be counted twice',()=>{
  const model=new NationalsAdjustment(settings);
  const row={schoolId:'Alpha',tournamentId:'prior',date:'2025-05-01',nationalsResidual:60,evidenceCoverage:0};
  model.observeField([row]);assert.equal(model.summary('Alpha').appearances,0);
  model.observeField([{...row,evidenceCoverage:1}]);
  assert.throws(()=>model.observeField([{...row,evidenceCoverage:1}]),/Duplicate/);
});
test('finite performance targets cannot reverse the sign of Nationals evidence at the tails',()=>{
  const model=new NationalsAdjustment(settings);
  const rows=model.evaluateField({id:'extreme',date:'2026-05-01',season:2026},[
    {schoolId:'Favorite',preRating:4000,officialOverallRank:1,evidenceCoverage:1},
    {schoolId:'Underdog',preRating:1500,officialOverallRank:2,evidenceCoverage:1},
  ]);
  assert.ok(rows[0].nationalsResidual>=0);
  assert.ok(rows[1].nationalsResidual<=0);
});
test('the prediction layer leaves general ratings and learning inputs unchanged',()=>{
  const tournaments=[tournament('first','2025-05-01',2025),tournament('next','2026-05-01',2026)];
  const original=new RatingEngine(base).rebuild(tournaments);
  const engine=new RatingEngine(config);const changed=engine.rebuild(tournaments);
  assert.deepEqual(changed.states,original.states);
  for(let i=0;i<changed.snapshots.length;i++){
    for(const key of ['preRating','postRating','ratingChange','expectedRank','fullStrengthWeight','postUncertainty']) {
      assert.equal(changed.snapshots[i][key],original.snapshots[i][key]);
    }
  }
  const first=engine.nationalsPredictions.find(s=>s.tournamentId==='first'&&s.canonicalName==='Alpha');
  const next=engine.nationalsPredictions.find(s=>s.tournamentId==='next'&&s.canonicalName==='Alpha');
  assert.equal(first.nationalsAdjustment,0);assert.equal(first.priorNationalsAppearances,0);
  assert.ok(next.nationalsAdjustment>0);assert.equal(next.priorNationalsAppearances,1);
  assert.ok(next.nationalsExpectedRank<next.generalExpectedRank);
});
test('changing the predicted Nationals outcome cannot change that tournament prediction',()=>{
  const earlier=tournament('first','2025-05-01',2025);
  const engines=[false,true].map(reverse=>{
    const engine=new RatingEngine(config);
    engine.rebuild([earlier,tournament('next','2026-05-01',2026,reverse)]);
    return engine;
  });
  for(const key of ['preRating','nationalsAdjustment','priorNationalsAppearances','nationalsPreRating','nationalsExpectedRank']){
    assert.deepEqual(engines[0].nationalsPredictions.filter(s=>s.tournamentId==='next').map(s=>s[key]),
      engines[1].nationalsPredictions.filter(s=>s.tournamentId==='next').map(s=>s[key]));
  }
});
test('same-day Nationals share the entering history and commit their residuals together',()=>{
  const engine=new RatingEngine(config);
  engine.rebuild([tournament('second','2026-05-01',2026,true),tournament('first','2026-05-01',2026)]);
  assert.ok(engine.nationalsPredictions.every(s=>s.priorNationalsAppearances===0&&s.nationalsAdjustment===0));
  assert.ok(engine.nationalsPredictions.every(s=>s.postNationalsAppearances===2));
});
test('future results leave earlier exported histories unchanged',()=>{
  const first=tournament('first','2025-05-01',2025),next=tournament('next','2026-05-01',2026);
  const a=new RatingEngine(config);a.rebuild([first]);
  const b=new RatingEngine(config);b.rebuild([next,first]);
  assert.deepEqual(b.snapshots.filter(s=>s.tournamentId==='first'),a.snapshots);
  assert.deepEqual(b.nationalsPredictions.filter(s=>s.tournamentId==='first'),a.nationalsPredictions);
});
test('Spearman handles tied ratings and undefined constant predictions',()=>{
  assert.equal(spearman([1,2,3],[3,2,1]),-1);
  assert.equal(spearman([1,1,2],[1,1,2]),1);
  assert.equal(spearman([1,1,1],[1,2,3]),null);
});
