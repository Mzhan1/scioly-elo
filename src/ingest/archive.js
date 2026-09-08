import fs from "node:fs";
import path from "node:path";
import { scoreSciolyff } from "../scoring/sciolyff.js";

function yamlFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return yamlFiles(fullPath);
      return /\.ya?ml$/i.test(entry.name) ? [fullPath] : [];
    });
}

// This project rates Division C only. Keep the restriction at the ingestion
// boundary so Division B data cannot affect fields, updates, audits, or exports.
export function loadArchive(resultsDirectory) {
  const tournaments = [];
  const errors = [];

  for (const sourceFile of yamlFiles(resultsDirectory).sort()) {
    try {
      const tournament = scoreSciolyff(fs.readFileSync(sourceFile, "utf8"), sourceFile);
      if (tournament.division === "C") tournaments.push(tournament);
    } catch (error) {
      errors.push({ sourceFile, message: error instanceof Error ? error.message : String(error) });
    }
  }

  tournaments.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.division.localeCompare(b.division) ||
      a.id.localeCompare(b.id),
  );
  return { tournaments, errors };
}
