#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { loadArchive } from "../src/ingest/archive.js";
import { representativeEntries } from "../src/scoring/sciolyff.js";

const archive = path.resolve(process.argv[2] ?? "data/duosmium/data/results");
const { tournaments, errors } = loadArchive(archive);
let invariantFailures = 0;
for (const tournament of tournaments) {
  const schools = new Set(tournament.teamEntries.map((entry) => entry.schoolKey));
  const representatives = representativeEntries(tournament);
  if (schools.size !== representatives.length) invariantFailures += 1;
}

console.log(`SciolyFF-ranked tournaments: ${tournaments.length}`);
console.log(`Parser failures: ${errors.length}`);
console.log(`Representative invariant failures: ${invariantFailures}`);
if (errors.length > 0) {
  for (const error of errors.slice(0, 20)) console.error(`${error.sourceFile}: ${error.message}`);
}
if (invariantFailures > 0) process.exitCode = 1;
