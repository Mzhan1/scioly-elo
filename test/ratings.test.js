import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { RatingEngine } from "../src/ratings/model.js";
import { scoreSciolyff } from "../src/scoring/sciolyff.js";
import { ratingTournament, scoringFixture } from "./helpers.js";

const config = JSON.parse(
  fs.readFileSync(new URL("../config/model_v2.json", import.meta.url), "utf8"),
);

test("removing lower school squads leaves rank-only rating evidence unchanged", () => {
  const withLower = scoreSciolyff(scoringFixture(), "fixture.yaml");
  const withoutLower = scoreSciolyff(
    scoringFixture({ includeLowerSquad: false }),
    "fixture.yaml",
  );
  const rankOnlyConfig = { ...config, scoreMarginLogStrength: 0 };
  const first = new RatingEngine(rankOnlyConfig).rateTournament(withLower);
  const second = new RatingEngine(rankOnlyConfig).rateTournament(withoutLower);

  const compact = (snapshots) =>
    snapshots.map((snapshot) => ({
      schoolKey: snapshot.schoolKey,
      preRating: snapshot.preRating,
      postRating: snapshot.postRating,
      ratingChange: snapshot.ratingChange,
      expectedPerformance: snapshot.expectedPerformance,
      actualPerformance: snapshot.actualPerformance,
    }));
  assert.deepEqual(compact(first), compact(second));
});

test("a top-rated school can keep gaining after beating a strong field", () => {
  const tournament = ratingTournament({
    schools: [
      { name: "Top", rank: 1 },
      { name: "Strong", rank: 2 },
    ],
  });
  const engine = new RatingEngine(config);
  engine.states.set("school-Top", {
    ...engine.currentState(tournament.teamEntries[0]),
    rating: 1950,
    uncertainty: 50,
    appearances: 20,
    lastSeason: 2026,
    lastDate: "2026-01-01",
  });
  engine.states.set("school-Strong", {
    ...engine.currentState(tournament.teamEntries[1]),
    rating: 1900,
    uncertainty: 50,
    appearances: 20,
    lastSeason: 2026,
    lastDate: "2026-01-01",
  });
  const snapshot = engine.rateTournament(tournament).find((item) => item.canonicalName === "Top");
  assert.ok(snapshot.ratingChange > 0);
  assert.ok(snapshot.postRating > snapshot.preRating);
});

test("tournament information is capped regardless of field size", () => {
  const schools = Array.from({ length: 80 }, (_, index) => ({
    name: `School ${index + 1}`,
    rank: index + 1,
  }));
  const snapshots = new RatingEngine(config).rateTournament(ratingTournament({ schools }));
  const maximumChange = Math.max(...snapshots.map((snapshot) => Math.abs(snapshot.ratingChange)));
  assert.ok(Number.isFinite(maximumChange));
  assert.ok(snapshots.every(
    (snapshot) => snapshot.effectiveGames <= config.maximumEffectiveGames,
  ));
});

test("rating changes are not subject to a fixed 100-point cap", () => {
  const schools = Array.from({ length: 80 }, (_, index) => ({
    name: `School ${index + 1}`,
    rank: index + 1,
  }));
  const snapshots = new RatingEngine(config).rateTournament(ratingTournament({ schools }));
  assert.ok(Math.max(...snapshots.map((snapshot) => snapshot.ratingChange)) > 100);
});

test("an elite team receives negligible credit for beating a weak field", () => {
  const tournament = ratingTournament({
    schools: [
      { name: "Elite", rank: 1 },
      { name: "Weak", rank: 2 },
    ],
  });
  const engine = new RatingEngine(config);
  engine.states.set("school-Elite", {
    ...engine.currentState(tournament.teamEntries[0]),
    rating: 2800,
    uncertainty: 35,
    appearances: 20,
    lastSeason: 2026,
    lastDate: "2026-01-01",
  });
  engine.states.set("school-Weak", {
    ...engine.currentState(tournament.teamEntries[1]),
    rating: 1500,
    uncertainty: 35,
    appearances: 20,
    lastSeason: 2026,
    lastDate: "2026-01-01",
  });
  const elite = engine.rateTournament(tournament).find(
    (snapshot) => snapshot.canonicalName === "Elite",
  );
  assert.ok(elite.ratingChange > 0);
  assert.ok(elite.ratingChange < 0.1);
});

test("partial-team results contribute less evidence than complete results", () => {
  const complete = ratingTournament({
    id: "complete",
    schools: [
      { name: "Winner", rank: 1 },
      { name: "Loser", rank: 2 },
    ],
  });
  const partial = ratingTournament({
    id: "partial",
    schools: [
      { name: "Winner", rank: 1 },
      { name: "Loser", rank: 2, evidenceCoverage: 0.8 },
    ],
  });
  const completeLoss = new RatingEngine(config)
    .rateTournament(complete)
    .find((snapshot) => snapshot.canonicalName === "Loser");
  const partialLoss = new RatingEngine(config)
    .rateTournament(partial)
    .find((snapshot) => snapshot.canonicalName === "Loser");
  assert.ok(Math.abs(partialLoss.ratingChange) < Math.abs(completeLoss.ratingChange));
});

test("satellite tournaments carry less rating evidence than traditional tournaments", () => {
  const schools = [
    { name: "Winner", rank: 1 },
    { name: "Loser", rank: 2 },
  ];
  const traditional = new RatingEngine(config).rateTournament(
    ratingTournament({ id: "traditional", location: "Example High School", schools }),
  );
  const satellite = new RatingEngine(config).rateTournament(
    ratingTournament({ id: "satellite", location: "Online", schools }),
  );
  const traditionalLoss = traditional.find((item) => item.canonicalName === "Loser");
  const satelliteLoss = satellite.find((item) => item.canonicalName === "Loser");
  assert.equal(satelliteLoss.tournamentFormat, "satellite");
  assert.equal(satelliteLoss.formatPrior, 0.75);
  assert.ok(Math.abs(satelliteLoss.ratingChange) < Math.abs(traditionalLoss.ratingChange));
});

test("same-day split squads share an evidence budget and use the same entering rating", () => {
  const first = ratingTournament({
    id: "first",
    date: "2026-01-18",
    schools: [
      { name: "Split School", rank: 1 },
      { name: "First Opponent", rank: 2 },
    ],
  });
  const second = ratingTournament({
    id: "second",
    date: "2026-01-18",
    schools: [
      { name: "Second Opponent", rank: 1 },
      { name: "Split School", rank: 2 },
    ],
  });
  const splitSnapshots = new RatingEngine(config)
    .rebuild([second, first])
    .snapshots.filter((item) => item.canonicalName === "Split School");
  assert.equal(splitSnapshots.length, 2);
  assert.ok(splitSnapshots.every((item) => item.sameDayTournamentCount === 2));
  assert.ok(
    splitSnapshots.every(
      (item) => Math.abs(item.lineupReliabilityWeight - 1 / Math.sqrt(2)) < 1e-12,
    ),
  );
  assert.equal(splitSnapshots[0].preRating, splitSnapshots[1].preRating);
});

test("the stronger same-day field receives more lineup evidence", () => {
  const elite = ratingTournament({
    id: "elite-field",
    date: "2026-01-18",
    schools: [
      { name: "Split School", rank: 1 },
      { name: "Elite Opponent", rank: 2 },
    ],
  });
  const developmental = ratingTournament({
    id: "developmental-field",
    date: "2026-01-18",
    schools: [
      { name: "Split School", rank: 1 },
      { name: "Developing Opponent", rank: 2 },
    ],
  });
  const engine = new RatingEngine(config);
  engine.states.set("school-Elite Opponent", {
    ...engine.currentState(elite.teamEntries[1]),
    rating: 2200,
    appearances: 10,
  });
  engine.states.set("school-Developing Opponent", {
    ...engine.currentState(developmental.teamEntries[1]),
    rating: 1400,
    appearances: 10,
  });
  const splitSnapshots = engine
    .rebuild([developmental, elite])
    .snapshots.filter((item) => item.canonicalName === "Split School");
  const eliteSnapshot = splitSnapshots.find((item) => item.tournamentId === "elite-field");
  const developmentalSnapshot = splitSnapshots.find(
    (item) => item.tournamentId === "developmental-field",
  );
  assert.ok(eliteSnapshot.lineupReliabilityWeight > developmentalSnapshot.lineupReliabilityWeight);
  assert.ok(eliteSnapshot.lineupReliabilityWeight > 0.9);
});

test("a larger total-score margin produces a larger rating change", () => {
  const result = (margin) =>
    new RatingEngine(config).rateTournament(
      ratingTournament({
        id: `margin-${margin}`,
        schools: [
          { name: "Winner", rank: 1, totalPoints: 100, scoredEventCount: 23 },
          { name: "Loser", rank: 2, totalPoints: 100 + margin, scoredEventCount: 23 },
        ],
      }),
    );
  const narrow = result(1).find((item) => item.canonicalName === "Winner");
  const decisive = result(50).find((item) => item.canonicalName === "Winner");
  assert.ok(decisive.averageScoreMarginMultiplier > narrow.averageScoreMarginMultiplier);
  assert.ok(decisive.ratingChange > narrow.ratingChange);
});

test("insufficient overall event coverage is stored but not rated", () => {
  const tournament = ratingTournament({
    schools: [
      { name: "Winner", rank: 1 },
      { name: "Partial", rank: 2, evidenceCoverage: 0.5 },
      { name: "Complete", rank: 3 },
    ],
  });
  const snapshots = new RatingEngine(config).rateTournament(tournament);
  assert.equal(snapshots.some((snapshot) => snapshot.canonicalName === "Partial"), false);
  assert.equal(snapshots.length, 2);
});

test("a season boundary preserves overall rating and increases uncertainty", () => {
  const tournament = ratingTournament({
    date: "2026-01-15",
    season: 2026,
    schools: [
      { name: "Alpha", rank: 1 },
      { name: "Beta", rank: 2 },
    ],
  });
  const entry = tournament.teamEntries[0];
  const engine = new RatingEngine(config);
  engine.states.set(entry.schoolKey, {
    ...engine.currentState(entry),
    rating: 1900,
    uncertainty: 80,
    appearances: 5,
    lastSeason: 2025,
    lastDate: "2025-05-15",
  });
  const prepared = engine.prepareState(entry, tournament);
  assert.equal(prepared.rating, 1900);
  assert.ok(prepared.uncertainty > 80);
});

test("multiple missed seasons preserve overall rating", () => {
  const tournament = ratingTournament({
    date: "2027-01-15",
    season: 2027,
    schools: [
      { name: "Alpha", rank: 1 },
      { name: "Beta", rank: 2 },
    ],
  });
  const entry = tournament.teamEntries[0];
  const engine = new RatingEngine(config);
  engine.states.set(entry.schoolKey, {
    ...engine.currentState(entry),
    rating: 1900,
    uncertainty: 80,
    appearances: 5,
    lastSeason: 2025,
    lastDate: "2025-05-15",
  });
  const prepared = engine.prepareState(entry, tournament);
  assert.equal(prepared.rating, 1900);
});

test("compressed rating units preserve predictions across seasons and split squads", () => {
  const reference = structuredClone(config);
  const factor = 400 / config.ratingDivisor;
  reference.ratingDivisor = 400;
  for (const key of ["baseK", "initialUncertainty", "minimumUncertainty", "maximumUncertainty",
    "seasonUncertaintyIncrease", "inactivityUncertaintyPerYear",
    "sameDayFieldStrengthTemperature", "fieldQualityRatingDivisor"]) {
    reference[key] *= factor;
  }
  const tournaments = [
    ratingTournament({ id: "early", date: "2024-01-01", season: 2024,
      schools: [{ name: "Alpha", rank: 1 }, { name: "Beta", rank: 2 }] }),
    ratingTournament({ id: "next", date: "2025-01-01", season: 2025,
      schools: [{ name: "Beta", rank: 1 }, { name: "Alpha", rank: 2 }] }),
    ratingTournament({ id: "split", date: "2025-01-01", season: 2025,
      schools: [{ name: "Alpha", rank: 1 }, { name: "Gamma", rank: 2 }] }),
  ];
  const compressed = new RatingEngine(config).rebuild(tournaments).snapshots;
  const original = new RatingEngine(reference).rebuild(tournaments).snapshots;
  compressed.forEach((s, index) => {
    const r = original[index];
    assert.ok(Math.abs(s.expectedPerformance - r.expectedPerformance) < 1e-12);
    assert.ok(Math.abs(s.lineupReliabilityWeight - r.lineupReliabilityWeight) < 1e-12);
    assert.ok(Math.abs((s.postRating - config.mean) * factor - (r.postRating - config.mean)) < 1e-9);
    assert.ok(Math.abs(s.postUncertainty * factor - r.postUncertainty) < 1e-9);
  });
});

test("rebuild is deterministic and processes tournaments chronologically", () => {
  const early = ratingTournament({
    id: "early",
    date: "2026-01-01",
    schools: [
      { name: "Alpha", rank: 1 },
      { name: "Beta", rank: 2 },
    ],
  });
  const late = ratingTournament({
    id: "late",
    date: "2026-02-01",
    schools: [
      { name: "Beta", rank: 1 },
      { name: "Alpha", rank: 2 },
    ],
  });
  const first = new RatingEngine(config).rebuild([late, early]).snapshots;
  const second = new RatingEngine(config).rebuild([late, early]).snapshots;
  assert.deepEqual(first, second);
  assert.deepEqual([...new Set(first.map((snapshot) => snapshot.date))], [
    "2026-01-01",
    "2026-02-01",
  ]);
});
