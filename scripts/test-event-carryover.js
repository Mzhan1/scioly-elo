import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { loadArchive } from "../src/ingest/archive.js";
import { RatingEngine } from "../src/ratings/model.js";
import { EventRatingEngine } from "../src/ratings/events.js";

const base = JSON.parse(fs.readFileSync("config/model_v2.json"));
const archivePath = process.argv[2];
const grid = [0.7, 0, 0.3, 0.5, 0.85, 0.95, 1];
console.log("Loading Division C archive...");
const { tournaments, errors } = loadArchive(archivePath);
if (!tournaments.length || errors.length) throw new Error("Archive must parse cleanly");
const archive = tournaments.filter(t => t.season <= 2026);
const overall = new RatingEngine(base);
overall.rebuild(archive);
const report = {
  archiveCommit: execFileSync("git", ["-C", archivePath, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  baseConfig: base,
  tournaments: archive.length,
  protocol: "Fixed grid; select lowest pooled 2022-2024 corrected event rank NMAE, then compare 2025 and 2026 without reselection. These later seasons have been inspected in previous model work, so are not pristine holdouts. All events and all earlier history initialize each replay; only carryover changes. No production settings are changed.",
  rankDefinition: "Unweighted school-event finishing ranks, average ranks for ties, normalized by field size minus one; pre-tournament logistic expectations with divisor 400. Separate from evidence-weighted performance MAE.",
  candidates: [],
};
const make = () => ({ count: 0, error: 0, middle: 0, performanceError: 0 });
const finish = m => ({ count: m.count, nmae: m.error / m.count, middleBaseline: m.middle / m.count, performanceMAE: m.performanceError / m.count });
for (const carryover of grid) {
  const start = Date.now();
  const config = structuredClone(base);
  config.eventModel.divisionCarryover = { C: carryover, default: carryover };
  const metrics = new Map();
  const lastSeen = new Map();
  let count = 0, maximumChange = 0;
  const add = (key, error, middle, s) => {
    const m = metrics.get(key) ?? make();
    m.count++; m.error += error; m.middle += middle;
    m.performanceError += Math.abs(s.expectedPerformance - s.actualPerformance);
    metrics.set(key, m);
  };
  const engine = new EventRatingEngine(config, {
    sameDayLineupWeights: overall.sameDayLineupWeights,
    retainSnapshots: false,
    calculatePerformanceRatings: false,
    onSnapshots(batch) {
      const fields = new Map();
      for (const s of batch) {
        count++; maximumChange = Math.max(maximumChange, Math.abs(s.ratingChange));
        const key = `${s.tournamentId}|${s.eventKey}`;
        if (!fields.has(key)) fields.set(key, []);
        fields.get(key).push(s);
      }
      for (const field of fields.values()) {
        const n = field.length;
        const expected = Array(n).fill(1), actual = Array(n).fill(1);
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
          const win = 1 / (1 + 10 ** ((field[j].preRating - field[i].preRating) / 400));
          expected[i] += 1 - win; expected[j] += win;
          const a = field[i].officialEventPlace, b = field[j].officialEventPlace;
          actual[i] += a > b ? 1 : a === b ? 0.5 : 0;
          actual[j] += b > a ? 1 : a === b ? 0.5 : 0;
        }
        for (let i = 0; i < n; i++) {
          const s = field[i], key = `${s.schoolKey}|${s.eventKey}`;
          let seen = lastSeen.get(key);
          if (!seen || seen.season !== s.season) {
            seen = { season: s.season, firstDate: s.date, previousSeason: seen?.season };
            lastSeen.set(key, seen);
          }
          if (s.season < 2022) continue;
          const error = Math.abs(expected[i] - actual[i]) / (n - 1);
          const middle = Math.abs((n + 1) / 2 - actual[i]) / (n - 1);
          const keys = [`season:${s.season}`, `event:${s.eventKey}`];
          if (s.season <= 2024) keys.push("training");
          if (s.date === seen.firstDate && seen.previousSeason !== undefined) {
            keys.push("firstReturningAppearance", `firstReturningAppearance:${s.season}`);
            if (s.season - seen.previousSeason >= 2) keys.push("returnAfterGap");
          }
          if (s.eventKey === "machines" && s.season === 2026) keys.push("machines2026");
          for (const k of keys) add(k, error, middle, s);
        }
      }
    },
  });
  engine.rebuild(archive);
  const result = { carryover, snapshots: count, maximumChange, seconds: (Date.now() - start) / 1000,
    metrics: Object.fromEntries([...metrics].map(([key, m]) => [key, finish(m)])) };
  report.candidates.push(result);
  report.selectedCarryover = [...report.candidates].sort((a, b) => a.metrics.training.nmae - b.metrics.training.nmae)[0].carryover;
  fs.writeFileSync("output/event_carryover_study.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ carryover, seconds: result.seconds, training: result.metrics.training,
    validation2025: result.metrics["season:2025"], comparison2026: result.metrics["season:2026"] }));
}
