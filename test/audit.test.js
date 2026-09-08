import assert from "node:assert/strict";
import test from "node:test";
import { auditHeadToHead } from "../src/analysis/head-to-head.js";
import { ratingTournament } from "./helpers.js";

test("head-to-head audit finds lower-rated teams with repeated winning records", () => {
  const tournaments = Array.from({ length: 4 }, (_, index) =>
    ratingTournament({
      id: `meeting-${index}`,
      date: `2026-0${index + 1}-01`,
      schools: [
        { name: "Lower rated", rank: 1 },
        { name: "Higher rated", rank: 2 },
      ],
    }),
  );
  const states = new Map([
    [
      "school-Lower rated",
      {
        schoolKey: "school-Lower rated",
        canonicalName: "Lower rated",
        state: "CA",
        rating: 2200,
        lastSeason: 2026,
      },
    ],
    [
      "school-Higher rated",
      {
        schoolKey: "school-Higher rated",
        canonicalName: "Higher rated",
        state: "CA",
        rating: 2400,
        lastSeason: 2026,
      },
    ],
  ]);
  const audit = auditHeadToHead(tournaments, states);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].lowerRatedSchool, "Lower rated");
  assert.equal(audit[0].observedLowerScore, 1);
  assert.ok(audit[0].predictedLowerScore < 0.5);
});
