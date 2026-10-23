import fs from "node:fs";
import path from "node:path";
import { rankMetrics } from "../src/analysis/rank-metrics.js";
import { toCsv } from "../src/export/csv.js";

const output = path.resolve(process.argv[2] ?? "output");
const historyPath = path.join(output, "rating_history.csv");
const reportPath = path.join(output, "rebuild_report.json");
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const text = fs.readFileSync(historyPath, "utf8");
const records = [];
let record = [], cell = "", quoted = false;
for (let i = 0; i < text.length; i += 1) {
  const c = text[i];
  if (c === '"') {
    if (quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
    else quoted = !quoted;
  } else if (c === "," && !quoted) { record.push(cell); cell = ""; }
  else if (c === "\n" && !quoted) {
    record.push(cell.replace(/\r$/, "")); records.push(record); record = []; cell = "";
  } else cell += c;
}
if (cell || record.length) { record.push(cell); records.push(record); }
const columns = records.shift();
const rows = records.filter(r => r.length > 1).map(r =>
  Object.fromEntries(columns.map((key, i) => [key, r[i]])));
const groups = new Map();
for (const row of rows) {
  const group = groups.get(row.tournamentId) ?? [];
  group.push(row);
  groups.set(row.tournamentId, group);
}
for (const group of groups.values()) {
  for (const row of group) {
    const opponents = group.filter(other => other !== row);
    if (+row.fieldSize !== group.length) throw new Error(`Incomplete tournament: ${row.tournamentId}`);
    row.representativeOverallRank = 1 + opponents.reduce((sum, other) =>
      sum + (+other.officialOverallRank < +row.officialOverallRank ? 1 :
        +other.officialOverallRank === +row.officialOverallRank ? 0.5 : 0), 0);
    row.expectedRank = 1 + opponents.reduce((sum, other) => sum +
      1 / (1 + 10 ** ((+row.preRating - +other.preRating) / (report.ratingDivisor ?? 400))), 0);
  }
}
const validation = rows.filter(row => +row.season >= 2022);
const corrected = rankMetrics(validation);
if (!report.predictionMetrics.legacyMismatchedRankMAE) {
  report.predictionMetrics.legacyMismatchedRankMAE = report.predictionMetrics.normalizedRankMeanAbsoluteError;
}
Object.assign(report.predictionMetrics, corrected);
if (!columns.includes("representativeOverallRank")) {
  columns.splice(columns.indexOf("officialOverallRank") + 1, 0, "representativeOverallRank");
}
fs.writeFileSync(historyPath, toCsv(rows, columns));
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(corrected, null, 2));
