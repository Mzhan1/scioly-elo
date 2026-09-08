import assert from "node:assert/strict";
import test from "node:test";
import {
  bestSchoolEventEvidence,
  representativeEntries,
  scoreSciolyff,
} from "../src/scoring/sciolyff.js";
import { scoringFixture } from "./helpers.js";

test("official SciolyFF scoring handles drops, penalties, and medal tie-breaks", () => {
  const tournament = scoreSciolyff(scoringFixture(), "fixture.yaml");
  const byNumber = new Map(tournament.teamEntries.map((team) => [team.number, team]));

  assert.equal(byNumber.get(2).totalPoints, 3);
  assert.equal(byNumber.get(3).totalPoints, 3);
  assert.equal(byNumber.get(2).officialOverallRank, 1);
  assert.equal(byNumber.get(3).officialOverallRank, 2);
  assert.equal(byNumber.get(1).officialOverallRank, 3);
  assert.equal(byNumber.get(4).officialOverallRank, 4);
});

test("the best overall-finishing squad is the school's sole representative", () => {
  const tournament = scoreSciolyff(scoringFixture(), "fixture.yaml");
  const alphaTeams = tournament.teamEntries.filter(
    (team) => team.canonicalName === "Alpha High School",
  );
  assert.deepEqual(
    alphaTeams.map((team) => [team.number, team.representativeForSchool]),
    [
      [2, true],
      [1, false],
    ],
  );
  assert.equal(representativeEntries(tournament).length, 3);
});

test("event evidence selects the best school squad independently by event", () => {
  const tournament = scoreSciolyff(scoringFixture(), "fixture.yaml");
  const evidence = bestSchoolEventEvidence(tournament);
  const alphaResults = evidence.filter((result) =>
    result.teamEntryId.endsWith(":1") || result.teamEntryId.endsWith(":2"),
  );
  assert.deepEqual(
    alphaResults.map((result) => [result.eventInstanceId.split(":").at(-1), result.teamEntryId.split(":").at(-1)]),
    [["1", "2"], ["2", "2"], ["3", "1"]],
  );
});

test("unknown event results are stored but excluded from event evidence", () => {
  const tournament = scoreSciolyff(
    scoringFixture({ unknownRepresentativeEvent: true }),
    "fixture.yaml",
  );
  const unknown = tournament.eventResults.find(
    (result) => result.teamEntryId.endsWith(":2") && result.unknown,
  );
  assert.ok(unknown);
  assert.equal(bestSchoolEventEvidence(tournament).includes(unknown), false);
});

test("event participation coverage is normalized for rating evidence", () => {
  const yaml = scoringFixture({ includeLowerSquad: false })
    .replace("- { team: 2, event: Astronomy, place: 1 }", "- { team: 2, event: Astronomy, participated: false }")
    .replace("- { team: 2, event: Codebusters, place: 1 }", "- { team: 2, event: Codebusters, participated: false }")
    .replace("- { team: 2, event: Forensics, place: 4 }", "- { team: 2, event: Forensics, participated: false }");
  const tournament = scoreSciolyff(yaml, "no-show.yaml");
  const alpha = tournament.teamEntries.find(
    (entry) => entry.canonicalName === "Alpha High School",
  );
  assert.equal(alpha.evidenceCoverage, 0);
  assert.equal(representativeEntries(tournament, { rateableOnly: true }).includes(alpha), false);
});

test("online locations are normalized as satellite tournaments", () => {
  const tournament = scoreSciolyff(
    scoringFixture().replace("location: Alpha, CA", "location: Online"),
    "online-fixture.yaml",
  );
  assert.equal(tournament.format, "satellite");
});
