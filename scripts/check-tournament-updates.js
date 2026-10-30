import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { loadArchive } from "../src/ingest/archive.js";
import { EventRatingEngine } from "../src/ratings/events.js";
import { RatingEngine } from "../src/ratings/model.js";

const config = JSON.parse(fs.readFileSync(new URL("../config/model_v2.json", import.meta.url)));
const baselineRef = process.argv[3] ?? "0c47a54";
const baselineConfig = JSON.parse(execFileSync("git", ["show", `${baselineRef}:config/model_v2.json`], { encoding: "utf8" }));
async function baselineModule(file) {
  const source = execFileSync("git", ["show", `${baselineRef}:${file}`], { encoding: "utf8" })
    .replace(/from "(\.[^"]+)"/g, (_, relative) => `from "${new URL(relative, new URL(`../${file}`, import.meta.url)).href}"`);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}
const LegacyOverall = (await baselineModule("src/ratings/model.js")).RatingEngine;
const LegacyEvent = (await baselineModule("src/ratings/events.js")).EventRatingEngine;
const { tournaments, errors } = loadArchive(process.argv[2]);
if (errors.length || !tournaments.length) throw new Error("Invalid archive");
const archive = tournaments.filter(t => t.season <= 2026);
const report = {
  baselineRef, candidateConfig: config,
  archiveCommit: execFileSync("git", ["-C", process.argv[2], "rev-parse", "HEAD"], { encoding:"utf8" }).trim(),
  parseErrors: errors.length, cases: [],
};
const eventNames = new Set((process.env.RATING_CHECK_EVENTS ?? "disease detectives").split(","));
const subset = eventNames.has("*") ? archive : archive.map(t => ({ ...t, events: t.events.filter(e => eventNames.has(e.canonicalName.toLowerCase())) }));
const modes = [["baseline", LegacyOverall, LegacyEvent, baselineConfig], ["candidate", RatingEngine, EventRatingEngine, config]];
if (process.env.RATING_CHECK_EVENT_NOISE) {
  const candidateConfig = structuredClone(config);
  candidateConfig.eventModel.tournamentPerformanceUncertainty = Number(process.env.RATING_CHECK_EVENT_NOISE);
  modes.splice(1, 1, ["candidate", RatingEngine, EventRatingEngine, candidateConfig]);
}
for (const [name, Overall, Events, cfg] of modes) {
  const overall = new Overall(cfg);
  const { snapshots } = overall.rebuild(archive);
  const val = snapshots.filter(s => s.season >= 2022);
  const overallMetrics = Object.fromEntries([2022,2023,2024,2025,2026,"all"].map(year => {
    const items = val.filter(s => year === "all" || s.season === year);
    return [year, items.reduce((sum,s) => sum + Math.abs(s.expectedRank-s.representativeOverallRank)/Math.max(1,s.fieldSize-1),0)/items.length];
  }));
  let sum = 0, count = 0, over500 = 0, over1000 = 0, max = 0;
  const eventSeasons = {};
  const littleton = [];
  const events = new Events(cfg, { sameDayLineupWeights: overall.sameDayLineupWeights, retainSnapshots: false,
    onSnapshots: batch => { for (const s of batch) {
      max = Math.max(max, Math.abs(s.ratingChange));
      if (Math.abs(s.ratingChange)>500) over500++;
      if (Math.abs(s.ratingChange)>1000) over1000++;
      if (s.season >= 2022) {
        const error = Math.abs(s.expectedPerformance-s.actualPerformance);
        sum += error; count++;
        const aggregate = eventSeasons[s.season] ?? { sum:0, count:0 };
        aggregate.sum += error; aggregate.count++;
        eventSeasons[s.season] = aggregate;
      }
      if (s.canonicalName === "Littleton High School" && s.eventKey === "disease detectives" && s.season >= 2025) littleton.push(s);
    } },
  });
  events.rebuild(subset);
  const result = { name, overallNormalizedMAE: overallMetrics, eventPerformanceMAE: sum/count, eventSamples: count,
    eventPerSeason: Object.fromEntries(Object.entries(eventSeasons).map(([year,a])=>[year,{count:a.count,mae:a.sum/a.count}])),
    maximumEventChange: max, over500, over1000, littleton };
  report.cases.push(result);
  console.log(JSON.stringify(result));
}
fs.mkdirSync("output", { recursive: true });
fs.writeFileSync("output/tournament_update_check.json", JSON.stringify(report,null,2)+"\n");
