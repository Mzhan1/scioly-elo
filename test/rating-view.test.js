import assert from 'node:assert/strict';
import test from 'node:test';
import {schoolsForView,historyPointForView,historyRowsForView} from '../web/rating-view.js';

test('Nationals view changes rating, ordering, and both ranks without mutating General data',()=>{
  const schools=[
    {id:'a',name:'Alpha',state:'CA',active:true,rating:2000,nationalRank:1,stateRank:1,
      nationalsRating:1900,nationalsNationalRank:2,nationalsStateRank:2},
    {id:'b',name:'Beta',state:'CA',active:true,rating:1950,nationalRank:2,stateRank:2,
      nationalsRating:2050,nationalsNationalRank:1,nationalsStateRank:1},
  ];
  const original=structuredClone(schools);
  const nationals=schoolsForView(schools,'nationals');
  assert.equal(nationals[0].id,'b');assert.equal(nationals[0].rating,2050);
  assert.equal(nationals[0].nationalRank,1);assert.equal(nationals[0].stateRank,1);
  assert.deepEqual(schoolsForView(schools,'general'),original);
  assert.deepEqual(schools,original);
});
test('Nationals history and exports use adjusted ratings and changes from the same date',()=>{
  const point=['2026-05-01',2000,30,'Nationals',1,60,50,'Nationals',1,1,2040,60,40,5];
  const general=historyPointForView(point,'general'),nationals=historyPointForView(point,'nationals');
  assert.equal(general.rating,2000);assert.equal(general.change,50);
  assert.equal(nationals.rating,2040);assert.equal(nationals.change,60);
  assert.equal(nationals.nationalsAdjustment,40);assert.equal(nationals.priorNationalsAppearances,5);
  assert.equal(nationals.fullStrengthWeight,1);
});
test('adjustment-only appearances are visible in Nationals history without fabricating General evidence',()=>{
  const general=['2026-04-01',2000],extra=['2026-05-01',2000,null,'Nationals',50,60,0,'Nationals',1,1,1950,-50,-50,2,true];
  const data={history:{a:[general]},nationalsOnlyHistory:{a:[extra]}};
  assert.deepEqual(historyRowsForView(data,'a','general'),[general]);
  assert.deepEqual(historyRowsForView(data,'a','nationals'),[general,extra]);
  assert.equal(historyPointForView(extra,'nationals').nationalsAdjustmentOnly,true);
  assert.deepEqual(data.history.a,[general]);
});
