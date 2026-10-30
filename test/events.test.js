import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { EventRatingEngine, canonicalEventKey } from "../src/ratings/events.js";
import { scoreSciolyff } from "../src/scoring/sciolyff.js";
import { scoringFixture } from "./helpers.js";

const config = JSON.parse(
  fs.readFileSync(new URL("../config/model_v2.json", import.meta.url), "utf8"),
);

test("skipping diagnostic performance ratings leaves predictions and updates unchanged", () => {
  const tournament = scoreSciolyff(scoringFixture(), "fixture.yaml");
  const full = new EventRatingEngine(config);
  const fast = new EventRatingEngine(config, { calculatePerformanceRatings: false });
  const expected = full.rateTournament(tournament);
  const actual = fast.rateTournament(tournament);
  assert.deepEqual(actual, expected.map(s => ({ ...s, performanceRating: undefined })));
  assert.deepEqual(fast.states, full.states);
});

test("event ratings may select different school squads for different events", () => {
  const tournament = scoreSciolyff(scoringFixture(), "fixture.yaml");
  const snapshots = new EventRatingEngine(config).rateTournament(tournament);
  const alpha = snapshots.filter(
    (snapshot) => snapshot.canonicalName === "Alpha High School",
  );
  assert.equal(alpha.find((snapshot) => snapshot.eventKey === "astronomy").eventTeamNumber, 2);
  assert.equal(alpha.find((snapshot) => snapshot.eventKey === "codebusters").eventTeamNumber, 2);
  assert.equal(alpha.find((snapshot) => snapshot.eventKey === "forensics").eventTeamNumber, 1);
});

test("unknown event results do not update that school-event rating", () => {
  const tournament = scoreSciolyff(
    scoringFixture({ includeLowerSquad: false, unknownRepresentativeEvent: true }),
    "unknown.yaml",
  );
  const snapshots = new EventRatingEngine(config).rateTournament(tournament);
  assert.equal(
    snapshots.some(
      (snapshot) =>
        snapshot.canonicalName === "Alpha High School" &&
        snapshot.eventKey === "forensics",
    ),
    false,
  );
});

test("a valid event result is rated even when the squad has low overall coverage", () => {
  const yaml = scoringFixture({ includeLowerSquad: false })
    .replace(
      "- { team: 2, event: Astronomy, place: 1 }",
      "- { team: 2, event: Astronomy, participated: false }",
    )
    .replace(
      "- { team: 2, event: Codebusters, place: 1 }",
      "- { team: 2, event: Codebusters, participated: false }",
    );
  const tournament = scoreSciolyff(yaml, "partial-event-team.yaml");
  const alpha = tournament.teamEntries.find(
    (entry) => entry.canonicalName === "Alpha High School",
  );
  assert.ok(alpha.evidenceCoverage < config.minimumOverallEvidenceCoverage);
  const snapshots = new EventRatingEngine(config).rateTournament(tournament);
  assert.ok(
    snapshots.some(
      (snapshot) =>
        snapshot.canonicalName === "Alpha High School" &&
        snapshot.eventKey === "forensics",
    ),
  );
});

test("event ratings remain independent by canonical event", () => {
  const tournament = scoreSciolyff(
    scoringFixture({ includeLowerSquad: false }),
    "independent.yaml",
  );
  const snapshots = new EventRatingEngine(config).rateTournament(tournament);
  const alphaAstronomy = snapshots.find(
    (snapshot) =>
      snapshot.canonicalName === "Alpha High School" && snapshot.eventKey === "astronomy",
  );
  const alphaForensics = snapshots.find(
    (snapshot) =>
      snapshot.canonicalName === "Alpha High School" && snapshot.eventKey === "forensics",
  );
  assert.ok(alphaAstronomy.ratingChange > 0);
  assert.ok(alphaForensics.ratingChange < 0);
  assert.notEqual(alphaAstronomy.postRating, alphaForensics.postRating);
});

test("event ratings apply their configured season carryover", () => {
  const engine = new EventRatingEngine(config);
  const entry = {
    schoolId: "school-alpha",
    schoolKey: "school-alpha",
    canonicalName: "Alpha",
    city: "Alpha",
    state: "CA",
    division: "C",
  };
  const event = { canonicalName: "Astronomy" };
  engine.states.set("school-alpha\u0000astronomy", {
    ...engine.currentState(entry, event),
    rating: 1900,
    uncertainty: 80,
    appearances: 5,
    lastSeason: 2025,
    lastDate: "2025-05-15",
  });
  const prepared = engine.prepareState(entry, event, {
    season: 2026,
    date: "2026-01-15",
  });
  assert.equal(prepared.rating, 1780);
  assert.ok(prepared.uncertainty > 80);
});

test("event ratings retain little pre-graduation strength after five seasons", () => {
  const engine = new EventRatingEngine(config);
  const entry = {
    schoolId: "school-alpha",
    schoolKey: "school-alpha",
    canonicalName: "Alpha",
    city: "Alpha",
    state: "CA",
    division: "C",
  };
  const event = { canonicalName: "Machines" };
  engine.states.set("school-alpha\u0000machines", {
    ...engine.currentState(entry, event),
    rating: 2500,
    uncertainty: 50,
    appearances: 10,
    lastSeason: 2021,
    lastDate: "2021-05-15",
  });

  const prepared = engine.prepareState(entry, event, {
    season: 2026,
    date: "2025-11-15",
  });

  assert.ok(Math.abs(prepared.rating - 1668.07) < 1e-9);
  assert.equal(prepared.uncertainty, config.eventModel.maximumUncertainty);
});

test("event names receive stable case-insensitive canonical keys", () => {
  assert.equal(canonicalEventKey("  Experimental   Design "), "experimental design");
  assert.equal(canonicalEventKey("CODEBUSTERS"), "codebusters");
});

test("event updates respect school uncertainty instead of a minimum K-factor", () => {
  const tournament = scoreSciolyff(scoringFixture({ includeLowerSquad:false }), "uncertainty.yaml");
  function update(uncertainty) {
    const engine = new EventRatingEngine(config);
    const entry = tournament.teamEntries.find(e=>e.canonicalName==="Alpha High School");
    const event = tournament.events.find(e=>e.canonicalName==="Astronomy");
    engine.states.set(`${entry.schoolKey}\u0000astronomy`, {
      ...engine.currentState(entry,event), rating:1400, uncertainty,
    });
    return engine.rateTournament(tournament).find(s=>s.schoolKey===entry.schoolKey && s.eventKey==="astronomy");
  }
  const certain=update(35), provisional=update(350);
  assert.ok(certain.ratingChange>0);
  assert.ok(certain.ratingChange<provisional.ratingChange/10);
  assert.ok(provisional.postRating<provisional.tournamentPerformanceEstimate);
});

test("event process variance is additive over elapsed time", () => {
  const tournament = scoreSciolyff(scoringFixture(), "time.yaml");
  const entry = tournament.teamEntries[0], event = tournament.events[0];
  const key = `${entry.schoolKey}\u0000${canonicalEventKey(event.canonicalName)}`;
  const engine = new EventRatingEngine(config);
  const initial = { ...engine.currentState(entry,event), uncertainty:80,
    lastSeason:2026, lastDate:"2026-01-01" };
  engine.states.set(key,initial);
  const direct = engine.prepareState(entry,event,{season:2026,date:"2026-01-29"});
  const middle = engine.prepareState(entry,event,{season:2026,date:"2026-01-15"});
  engine.states.set(key,{...middle,lastDate:"2026-01-15"});
  const split = engine.prepareState(entry,event,{season:2026,date:"2026-01-29"});
  assert.ok(Math.abs(direct.uncertainty-split.uncertainty)<1e-9);
});

test("same-day event tournaments combine evidence without summing posterior jumps", () => {
  const first = scoreSciolyff(scoringFixture({includeLowerSquad:false}), "first.yaml");
  const second = scoreSciolyff(scoringFixture({includeLowerSquad:false}), "second.yaml");
  const {snapshots} = new EventRatingEngine(config).rebuild([first,second]);
  const results = snapshots.filter(s=>s.canonicalName==="Alpha High School" && s.eventKey==="astronomy");
  assert.equal(results.length,2);
  assert.equal(results[0].preRating,results[1].preRating);
  assert.ok(results[0].combinedSameDayPostRating>results[0].postRating);
  assert.ok(results[0].combinedSameDayPostRating<results[0].preRating+results.reduce((sum,s)=>sum+s.ratingChange,0));
});

test("event rebuilds are deterministic", () => {
  const tournament = scoreSciolyff(
    scoringFixture({ includeLowerSquad: false }),
    "deterministic.yaml",
  );
  const first = new EventRatingEngine(config).rebuild([tournament]);
  const second = new EventRatingEngine(config).rebuild([tournament]);
  assert.deepEqual(first, second);
});
