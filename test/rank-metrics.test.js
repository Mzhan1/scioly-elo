import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { RatingEngine } from "../src/ratings/model.js";
import { ratingTournament } from "./helpers.js";
import { rankMetrics } from "../src/analysis/rank-metrics.js";

const config = JSON.parse(fs.readFileSync(new URL("../config/model_v2.json", import.meta.url)));

test("rank evaluation removes squad-rank gaps and ignores evidence weights", () => {
  const snapshots = new RatingEngine(config).rateTournament(ratingTournament({
    schools: [
      { name: "Alpha", rank: 1 },
      { name: "Beta", rank: 5, evidenceCoverage: 0.8 },
      { name: "Gamma", rank: 9 },
    ],
  }));
  assert.deepEqual(snapshots.map(s => s.representativeOverallRank), [1, 2, 3]);
  assert.deepEqual(snapshots.map(s => s.expectedRank), [2, 2, 2]);
  const metrics = rankMetrics(snapshots);
  assert.equal(metrics.normalizedRankMeanAbsoluteError, 1 / 3);
  assert.equal(metrics.middleRankBaselineNormalizedMAE, 1 / 3);
});

test("tied eligible schools receive average ranks", () => {
  const snapshots = new RatingEngine(config).rateTournament(ratingTournament({
    schools: [{ name: "Alpha", rank: 2 }, { name: "Beta", rank: 2 }, { name: "Gamma", rank: 8 }],
  }));
  assert.deepEqual(snapshots.map(s => s.representativeOverallRank), [1.5, 1.5, 3]);
});
