import assert from "node:assert/strict";
import test from "node:test";
import { tournamentPosterior, combineTournamentPosteriors } from "../src/ratings/tournament-posterior.js";

const base = {
  rating: 1500, uncertainty: 220, initialUncertainty: 300, baseK: 235,
  divisor: 400, performanceUncertainty: 200, effectiveGames: 7,
  informationWeight: 1.2, evidenceWeight: 1,
  opponents: [{ rating: 1700, score: 0.8, weight: 1 }],
};

test("posterior moves toward a result without overshooting its implied performance", () => {
  const result = tournamentPosterior(base);
  const implied = 1700 + 400 * Math.log10(0.8/0.2);
  assert.ok(result.ratingChange > 0);
  assert.ok(base.rating + result.ratingChange < result.tournamentPerformanceEstimate);
  assert.ok(result.tournamentPerformanceEstimate < implied);
  const negative = tournamentPosterior({ ...base, rating: 2000, opponents: [{rating: 1600, score: 0.2, weight: 1}] });
  const lowImplied = 1600 + 400 * Math.log10(0.2/0.8);
  assert.ok(negative.ratingChange < 0);
  assert.ok(2000 + negative.ratingChange > lowImplied);
});

test("one shared tournament performance cannot remove all school uncertainty", () => {
  const result = tournamentPosterior({ ...base, effectiveGames: 1000000 });
  const floorVariance = base.uncertainty**2 * base.performanceUncertainty**2 /
    (base.uncertainty**2 + base.performanceUncertainty**2);
  assert.ok(result.postUncertainty**2 >= floorVariance - 1e-8);
});

test("certain schools move less without an arbitrary minimum learning-rate factor", () => {
  const certain = tournamentPosterior({ ...base, uncertainty: 35 });
  const uncertain = tournamentPosterior({ ...base, uncertainty: 300 });
  assert.ok(certain.ratingChange < uncertain.ratingChange / 10);
});

test("large justified updates remain possible; there is no fixed delta cap", () => {
  const result = tournamentPosterior({ ...base, uncertainty: 3000,
    opponents: [{rating:3500, score:0.5, weight:1}] });
  assert.ok(result.ratingChange > 1200);
});

test("duplicating the opponent list does not duplicate a tournament's evidence", () => {
  const first = tournamentPosterior(base);
  const duplicate = tournamentPosterior({ ...base, opponents: Array(100).fill(base.opponents[0]) });
  assert.ok(Math.abs(first.ratingChange-duplicate.ratingChange)<1e-9);
});

test("same-day posterior combination counts the shared prior once", () => {
  const first = tournamentPosterior(base);
  const prior = { rating: base.rating, uncertainty: base.uncertainty };
  const single = combineTournamentPosteriors(prior, [first]);
  assert.ok(Math.abs(single.rating-prior.rating-first.ratingChange)<1e-9);
  const combined = combineTournamentPosteriors(prior, [first,first]);
  assert.ok(combined.rating > single.rating);
  assert.ok(combined.rating < prior.rating + 2 * first.ratingChange);
  assert.ok(combined.uncertainty < single.uncertainty);
});
