import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {scoringFixture} from './helpers.js';

test('the real rebuild writes one rating column in each view-specific rankings file',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'scioly-ranking-exports-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const results=path.join(root,'results'),output=path.join(root,'output');
  fs.mkdirSync(results);
  fs.writeFileSync(path.join(results,'2026-02-01_fixture_c.yaml'),scoringFixture());
  execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/rebuild-ratings.js',import.meta.url)),results,output,'2026']);
  for(const name of ['general_rankings.csv','nationals_rankings.csv']) {
    const columns=fs.readFileSync(path.join(output,name),'utf8').split('\n')[0].split(',');
    assert.equal(columns.filter(column=>column==='rating').length,1);
    assert.ok(!columns.includes('nationalsRating'),`${name} must not repeat its rating`);
    assert.ok(!columns.includes('generalRating'),`${name} must contain only its own view's rating`);
  }
});
