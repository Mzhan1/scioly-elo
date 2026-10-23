import fs from "node:fs";
import { loadArchive } from "../src/ingest/archive.js";
import { RatingEngine } from "../src/ratings/model.js";
import { rankMetrics } from "../src/analysis/rank-metrics.js";

const base = JSON.parse(fs.readFileSync(new URL("../config/model_v2.5.json", import.meta.url)));
// Fixed v2.4 benchmark: rerunning this comparison must not silently adopt the
// production model being evaluated as its baseline.
Object.assign(base, {
  modelVersion: "so-rating-v2.4", ratingDivisor: 400, baseK: 80,
  initialUncertainty: 300, minimumUncertainty: 35, maximumUncertainty: 350,
  seasonUncertaintyIncrease: 100, inactivityUncertaintyPerYear: 45,
  sameDayFieldStrengthTemperature: 200, fieldQualityRatingDivisor: 3000,
  divisionCarryover: { C: 0.93, default: 0.93 },
});
const { tournaments, errors } = loadArchive(process.argv[2]);
if (!tournaments.length || errors.length) throw new Error("Archive must be nonempty and parse cleanly");

// Scale every overall parameter expressed in rating units around the same mean.
export function scaledConfig(config, factor) {
  const result = structuredClone(config);
  result.ratingDivisor = (config.ratingDivisor ?? 400) * factor;
  for (const key of ["baseK", "initialUncertainty", "minimumUncertainty", "maximumUncertainty",
    "seasonUncertaintyIncrease", "inactivityUncertaintyPerYear",
    "sameDayFieldStrengthTemperature", "fieldQualityRatingDivisor"]) {
    result[key] *= factor;
  }
  return result;
}

function metrics(snapshots) {
  return {
    count: snapshots.length,
    rankMAE: rankMetrics(snapshots).normalizedRankMeanAbsoluteError,
    middleRankBaselineMAE: rankMetrics(snapshots).middleRankBaselineNormalizedMAE,
    performanceMAE: snapshots.reduce((sum, s) => sum + Math.abs(s.expectedPerformance - s.actualPerformance), 0) / snapshots.length,
  };
}

const noRegression = structuredClone(base);
noRegression.divisionCarryover = { C: 1, default: 1 };
const cases = [
  ["v2.4", base],
  ["100%-400", noRegression],
  ["100%-300", scaledConfig(noRegression, 0.75)],
  ["100%-280", scaledConfig(noRegression, 0.70)],
];
const report = { tournaments: tournaments.length, cases: [] };
let reference;
for (const [name, config] of cases) {
  const { states, snapshots } = new RatingEngine(config).rebuild(tournaments);
  const current = [...states.values()].filter(s => s.lastSeason === 2026).sort((a,b) => b.rating-a.rating);
  const validation = snapshots.filter(s => s.season >= 2022 && s.season <= 2024);
  const heldOut = snapshots.filter(s => s.season === 2025 || s.season === 2026);
  const result = {
    name, validation2022to2024: metrics(validation), heldOut2025to2026: metrics(heldOut),
    all2022plus: metrics(snapshots.filter(s => s.season >= 2022)),
    top: current.slice(0, 5).map(s => ({ name: s.canonicalName, rating: s.rating })),
    above2700: current.filter(s => s.rating >= 2700).length,
    above2500: current.filter(s => s.rating >= 2500).length,
  };
  if (name === "100%-400") reference = snapshots;
  if (reference && name !== "100%-400") {
    result.maxPredictionDifference = Math.max(...snapshots.map((s,i) => Math.abs(s.expectedPerformance - reference[i].expectedPerformance)));
  }
  report.cases.push(result);
  console.log(JSON.stringify(result));
}
fs.mkdirSync("output", { recursive: true });
fs.writeFileSync("output/scale_calibration.json", JSON.stringify(report, null, 2) + "\n");
