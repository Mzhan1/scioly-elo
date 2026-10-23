import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { loadArchive } from "../src/ingest/archive.js";
import { RatingEngine } from "../src/ratings/model.js";
import { rankMetrics } from "../src/analysis/rank-metrics.js";

const archive = process.argv[2];
const base = JSON.parse(fs.readFileSync(new URL("../config/model_v2.5.json", import.meta.url)));
const { tournaments, errors } = loadArchive(archive);
if (!tournaments.length || errors.length) throw new Error("Archive must be nonempty and parse cleanly");
const through2024 = tournaments.filter(t => t.season <= 2024);
const through2025 = tournaments.filter(t => t.season <= 2025);
const all = tournaments.filter(t => t.season <= 2026);
const report = {
  archiveCommit: execFileSync("git", ["-C", archive, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  baselineConfig: base,
  protocol: "Tune 2022-2024 only; select among three finalists using 2025; compare locked winner against baseline on 2026. Prior manual experiments have seen these seasons.",
  training: [], validation: [], final: [],
};
fs.mkdirSync("output", { recursive: true });
const save = () => fs.writeFileSync("output/optimization_report.json", JSON.stringify(report, null, 2) + "\n");
function evaluate(name, config, archiveSlice, seasons) {
  const { snapshots, states } = new RatingEngine(config).rebuild(archiveSlice);
  const selected = snapshots.filter(s => seasons.includes(s.season));
  const current = [...states.values()].filter(s => s.lastSeason === Math.max(...seasons));
  return { name, config, metrics: rankMetrics(selected),
    perSeason: Object.fromEntries(seasons.map(y => [y, rankMetrics(selected.filter(s => s.season === y))])),
    topRating: Math.max(...current.map(s => s.rating)),
    above2700: current.filter(s => s.rating >= 2700).length,
    above2500: current.filter(s => s.rating >= 2500).length,
  };
}
const candidates = [];
function add(name, patch) { candidates.push([name, { ...structuredClone(base), ...patch }]); }
add("baseline", {});
for (const k of [30, 45, 90, 120]) add(`K=${k}`, { baseK: k });
for (const strength of [0, 0.15, 0.6]) add(`margin=${strength}`, { scoreMarginLogStrength: strength });
for (const satellite of [0.4, 0.6, 0.9]) add(`satellite=${satellite}`, { formatPrior: { ...base.formatPrior, satellite } });
for (const carry of [0.93, 0.98]) add(`carry=${carry}`, { divisionCarryover: { C: carry, default: carry } });
for (const [minimum, maximum] of [[0.25, 0.7], [0.25, 1], [0.5, 1], [0.5, 1.5]]) {
  add(`uncertainty=${minimum}-${maximum}`, { minimumUncertaintyFactor: minimum, maximumUncertaintyFactor: maximum });
}
for (const [name, config] of candidates) {
  const result = evaluate(name, config, through2024, [2022, 2023, 2024]);
  report.training.push(result); save();
  console.log(`train ${name}: ${result.metrics.normalizedRankMeanAbsoluteError.toFixed(6)}`);
}
// Combine the best individual choices for each independently tested dimension.
const bestFor = prefix => report.training.filter(r => r.name.startsWith(prefix))
  .sort((a,b) => a.metrics.normalizedRankMeanAbsoluteError-b.metrics.normalizedRankMeanAbsoluteError)[0];
const bestK = bestFor("K=").config.baseK;
const bestMargin = bestFor("margin=").config.scoreMarginLogStrength;
const bestSatellite = bestFor("satellite=").config.formatPrior;
const bestUncertainty = bestFor("uncertainty=").config;
for (const [name, patch] of [
  ["combined-k-margin", { baseK: bestK, scoreMarginLogStrength: bestMargin }],
  ["combined-k-margin-satellite", { baseK: bestK, scoreMarginLogStrength: bestMargin, formatPrior: bestSatellite }],
  ["combined-all", { baseK: bestK, scoreMarginLogStrength: bestMargin, formatPrior: bestSatellite,
    minimumUncertaintyFactor: bestUncertainty.minimumUncertaintyFactor,
    maximumUncertaintyFactor: bestUncertainty.maximumUncertaintyFactor }],
]) {
  const result = evaluate(name, { ...structuredClone(base), ...patch }, through2024, [2022, 2023, 2024]);
  report.training.push(result); save();
  console.log(`train ${name}: ${result.metrics.normalizedRankMeanAbsoluteError.toFixed(6)}`);
}
const finalists = [...report.training].sort((a,b) => a.metrics.normalizedRankMeanAbsoluteError-b.metrics.normalizedRankMeanAbsoluteError).slice(0,3);
for (const r of finalists) {
  const result = evaluate(r.name, r.config, through2025, [2025]);
  report.validation.push(result); save();
  console.log(`validation ${r.name}: ${result.metrics.normalizedRankMeanAbsoluteError.toFixed(6)}`);
}
const winner = [...report.validation].sort((a,b) => a.metrics.normalizedRankMeanAbsoluteError-b.metrics.normalizedRankMeanAbsoluteError)[0];
report.selected = winner.name;
for (const [name, config] of [["baseline", base], [winner.name, winner.config]]) {
  const result = evaluate(name, config, all, [2026]);
  report.final.push(result); save();
  console.log(`final ${name}: ${JSON.stringify(result)}`);
}
