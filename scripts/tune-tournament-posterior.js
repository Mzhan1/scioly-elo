import fs from "node:fs";
import { loadArchive } from "../src/ingest/archive.js";
import { RatingEngine } from "../src/ratings/model.js";
import { EventRatingEngine } from "../src/ratings/events.js";

const base = JSON.parse(fs.readFileSync("config/model_v2.json"));
const { tournaments, errors } = loadArchive(process.argv[2]);
if (!tournaments.length || errors.length) throw new Error("Invalid archive");
// Select only on 2022-2024; later seasons do not participate in this search.
const archive = tournaments.filter(t=>t.season<=2024);
const names = new Set(["disease detectives", "codebusters", "machines"]);
const subset = archive.map(t=>({...t,events:t.events.filter(e=>names.has(e.canonicalName.toLowerCase()))}));
const overall = new RatingEngine(base);
overall.rebuild(archive);
const cases = [
  ["narrow-3",100,200,705],
  ["narrow-10",100,200,2350],
  ["moderate-10",150,300,2350],
  ["wide-10",200,400,2350],
  ["fast-drift-10",100,400,2350],
  ["narrow-1",100,200,235],
  ["small-drift-3",100,100,705],
  ["small-noise-3",50,100,705],
  ["moderate-small-drift-10",150,100,2350],
  ["wide-moderate-drift-3",200,200,705],
  ["shared-300",300,400,2350],
  ["shared-400",400,400,2350],
  ["shared-300-slower-drift",300,200,2350],
];
const selectedNames = process.env.RATING_POSTERIOR_CASES?.split(",");
const report = selectedNames && fs.existsSync("output/posterior_tuning.json") ? JSON.parse(fs.readFileSync("output/posterior_tuning.json")) : [];
for(const [name,eventNoise,eventDrift,eventK] of cases){
  if (selectedNames && !selectedNames.includes(name)) continue;
  const cfg=structuredClone(base);
  Object.assign(cfg.eventModel,{tournamentPerformanceUncertainty:eventNoise,inactivityUncertaintyPerYear:eventDrift,baseK:eventK});
  let sum=0,count=0,max=0;
  const eventEngine=new EventRatingEngine(cfg,{sameDayLineupWeights:overall.sameDayLineupWeights,retainSnapshots:false,
    onSnapshots:batch=>{for(const s of batch){max=Math.max(max,Math.abs(s.ratingChange));if(s.season>=2022){sum+=Math.abs(s.expectedPerformance-s.actualPerformance);count++}}}});
  eventEngine.rebuild(subset);
  const result={name,eventMAE:sum/count,eventCount:count,maximumEventChange:max,config:cfg};
  report.push(result);
  console.log(JSON.stringify({name,eventMAE:sum/count,maximumEventChange:max}));
  fs.writeFileSync("output/posterior_tuning.json",JSON.stringify(report,null,2)+"\n");
}
