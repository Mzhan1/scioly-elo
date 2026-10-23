import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { loadArchive } from "../src/ingest/archive.js";
import { RatingEngine } from "../src/ratings/model.js";
import { rankMetrics } from "../src/analysis/rank-metrics.js";

const report = JSON.parse(fs.readFileSync("output/optimization_report.json", "utf8"));
const archiveCommit = execFileSync("git", ["-C", process.argv[2], "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (archiveCommit !== report.archiveCommit) throw new Error("Verification requires the same archive commit as optimization");
const winner = report.final.find(r => r.name === report.selected);
const { tournaments, errors } = loadArchive(process.argv[2]);
if (!tournaments.length || errors.length) throw new Error("Invalid archive");
const archive = tournaments.filter(t => t.season <= 2026);
const baseline = new RatingEngine(report.baselineConfig).rebuild(archive);
const candidate = new RatingEngine(winner.config).rebuild(archive);
const scale = 0.75;
const compressedConfig = structuredClone(winner.config);
compressedConfig.modelVersion = "so-rating-v2.6";
compressedConfig.ratingDivisor *= scale;
for (const key of ["baseK", "initialUncertainty", "minimumUncertainty", "maximumUncertainty",
  "seasonUncertaintyIncrease", "inactivityUncertaintyPerYear", "sameDayFieldStrengthTemperature",
  "fieldQualityRatingDivisor"]) compressedConfig[key] *= scale;
const compressed = new RatingEngine(compressedConfig).rebuild(archive);
if (baseline.snapshots.length !== candidate.snapshots.length || candidate.snapshots.length !== compressed.snapshots.length) {
  throw new Error("Compared models have different evaluation samples");
}
let maxDifference = 0;
for (let i = 0; i < candidate.snapshots.length; i++) {
  maxDifference = Math.max(maxDifference, Math.abs(candidate.snapshots[i].expectedRank - compressed.snapshots[i].expectedRank));
}
if (maxDifference > 1e-9) throw new Error("Scale changed predictions");
const summary = result => Object.fromEntries([
  ["all2022plus", result.snapshots.filter(s => s.season >= 2022)],
  ...[2022,2023,2024,2025,2026].map(y => [y, result.snapshots.filter(s => s.season === y)]),
].map(([name, snapshots]) => [name, rankMetrics(snapshots)]));

// Paired bootstrap of tournament dates, preserving simultaneous result groups.
// This describes sampling variability on this archive, not a selection-adjusted
// confidence interval or proof of future performance.
const blocks = new Map();
for (let i = 0; i < baseline.snapshots.length; i++) {
  const b = baseline.snapshots[i], c = candidate.snapshots[i];
  if (b.schoolKey !== c.schoolKey || b.tournamentId !== c.tournamentId) throw new Error("Unpaired results");
  if (b.season !== 2026) continue;
  const block = blocks.get(b.date) ?? { difference: 0, count: 0 };
  block.difference += (Math.abs(c.expectedRank-c.representativeOverallRank) -
    Math.abs(b.expectedRank-b.representativeOverallRank)) / Math.max(1,b.fieldSize-1);
  block.count++;
  blocks.set(b.date, block);
}
let seed = 20261023;
const random = () => { seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; return seed / 2**32; };
const dates = [...blocks.values()], draws = [];
for (let sample=0; sample<2000; sample++) {
  let difference=0, count=0;
  for (let i=0; i<dates.length; i++) {
    const b = dates[Math.floor(random()*dates.length)];
    difference += b.difference; count += b.count;
  }
  draws.push(difference/count);
}
draws.sort((a,b)=>a-b);
const current = [...compressed.states.values()].filter(s=>s.lastSeason===2026).sort((a,b)=>b.rating-a.rating);
report.verification = {
  baseline: summary(baseline), optimized: summary(compressed),
  maximumExpectedRankDifferenceAfterCompression: maxDifference,
  dateBlockBootstrap2026: { dates: dates.length, samples: 2000,
    difference95PercentInterval: [draws[50], draws[1949]] },
  compressedConfig,
  currentDistribution: { top: current.slice(0,10).map(s=>({name:s.canonicalName, rating:s.rating})),
    above2700: current.filter(s=>s.rating>=2700).length,
    above2500: current.filter(s=>s.rating>=2500).length },
};
fs.writeFileSync("output/optimization_report.json", JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report.verification,null,2));
