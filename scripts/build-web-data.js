#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "output");
const destinationDir = path.join(root, "web", "data");

function readCsv(file) {
  const input = fs.readFileSync(file, "utf8");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }

  const columns = rows.shift();
  return rows
    .filter((values) => values.length > 1)
    .map((values) => Object.fromEntries(columns.map((column, index) => [column, values[index]])));
}

function number(value) {
  if (value === "" || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

for (const name of ["all_program_states.csv", "general_rankings.csv", "nationals_rankings.csv", "rating_history.csv", "nationals_prediction_history.csv"]) {
  const file = path.join(outputDir, name);
  if (!fs.existsSync(file)) {
    console.error(`Missing ${file}. Run pnpm rebuild first.`);
    process.exit(2);
  }
}

const allStates = readCsv(path.join(outputDir, "all_program_states.csv"));
const currentStates = readCsv(path.join(outputDir, "general_rankings.csv"));
const nationalsStates = readCsv(path.join(outputDir, "nationals_rankings.csv"));
const nationalsById = new Map(nationalsStates.map(row=>[row.schoolId,row]));
const historyRows = readCsv(path.join(outputDir, "rating_history.csv"));
const nationalsPredictionRows = readCsv(path.join(outputDir, "nationals_prediction_history.csv"));
const currentById = new Map(currentStates.map((row) => [row.schoolId, row]));
const history = {};

for (const row of historyRows) {
  const schoolHistory = history[row.schoolId] ?? [];
  schoolHistory.push([
    row.date,
    number(row.combinedSameDayPostRating ?? row.postRating),
    number(row.postUncertainty),
    row.tournamentName,
    number(row.officialOverallRank),
    number(row.fieldSize),
    number(row.ratingChange),
    row.level,
    number(row.fullStrengthProbability) ?? 1,
    number(row.fullStrengthWeight) ?? 1,
    number(row.nationalsPostRating),
    number(row.nationalsRatingChange),
    number(row.postNationalsAdjustment) ?? 0,
    number(row.postNationalsAppearances) ?? 0,
  ]);
  history[row.schoolId] = schoolHistory;
}

for (const schoolHistory of Object.values(history)) {
  schoolHistory.sort((left, right) => left[0].localeCompare(right[0]));
}

// An incomplete Nationals appearance may update the conditional adjustment
// while being ineligible for General Elo. Do not invent a General rated point.
const ratedAppearances = new Set(historyRows.map(row=>`${row.schoolId}|${row.tournamentId}`));
const generalPostByDate = new Map(historyRows.map(row=>[
  `${row.schoolId}|${row.date}`,number(row.combinedSameDayPostRating ?? row.postRating),
]));
const knownSchools = new Set(allStates.map(row=>row.schoolId));
const nationalsOnlyHistory = {};
for (const row of nationalsPredictionRows) {
  if (!knownSchools.has(row.schoolId) || !(number(row.evidenceCoverage)>0) ||
      ratedAppearances.has(`${row.schoolId}|${row.tournamentId}`)) continue;
  const generalPost=generalPostByDate.get(`${row.schoolId}|${row.date}`) ?? number(row.preRating);
  const before=number(row.nationalsAdjustment), after=number(row.postNationalsAdjustment);
  const points=nationalsOnlyHistory[row.schoolId] ?? [];
  points.push([row.date,generalPost,null,row.tournamentId,number(row.actualRank),number(row.fieldSize),
    0,'Nationals',1,1,generalPost+after,after-before,after,number(row.postNationalsAppearances),true]);
  nationalsOnlyHistory[row.schoolId]=points;
}

const schools = allStates
  .filter((row) => row.division === "C")
  .map((row) => {
    const current = currentById.get(row.schoolId);
    const nationals = nationalsById.get(row.schoolId);
    return {
      id: row.schoolId,
      name: row.canonicalName,
      city: row.city,
      state: row.state,
      rating: number(row.rating),
      nationalsRating: number(row.nationalsRating),
      nationalsAdjustment: number(row.nationalsAdjustment) ?? 0,
      priorNationalsAppearances: number(row.priorNationalsAppearances) ?? 0,
      nationalsNationalRank: number(nationals?.nationalRank),
      nationalsStateRank: number(nationals?.stateRank),
      uncertainty: number(row.uncertainty),
      appearances: number(row.appearances),
      lastSeason: number(row.lastSeason),
      lastDate: row.lastDate,
      nationalRank: number(current?.nationalRank),
      stateRank: number(current?.stateRank),
      active: Boolean(current),
    };
  })
  .sort((left, right) => {
    if (left.active !== right.active) return left.active ? -1 : 1;
    if (left.active) return left.nationalRank - right.nationalRank;
    return left.name.localeCompare(right.name) || left.state.localeCompare(right.state);
  });

const report = JSON.parse(fs.readFileSync(path.join(outputDir, "rebuild_report.json"), "utf8"));
const payload = {
  generatedAt: new Date().toISOString(),
  modelVersion: report.modelVersion,
  latestSeason: report.latestSeasonByDivision?.C,
  schools,
  history,
  nationalsOnlyHistory,
};

fs.mkdirSync(destinationDir, { recursive: true });
const destination = path.join(destinationDir, "ratings.json");
fs.writeFileSync(destination, JSON.stringify(payload));
console.log(
  `Wrote ${schools.length} schools and ${historyRows.length} rating snapshots to ${destination}`,
);
