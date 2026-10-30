#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadArchive } from "../src/ingest/archive.js";
import { auditHeadToHead } from "../src/analysis/head-to-head.js";
import { EventRatingEngine } from "../src/ratings/events.js";
import { RatingEngine } from "../src/ratings/model.js";
import { rankMetrics } from "../src/analysis/rank-metrics.js";
import { nationalsMetrics } from "../src/analysis/nationals-metrics.js";
import { rankedEventStates, rankedStates, toCsv, toCsvRows } from "../src/export/csv.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const archive = path.resolve(process.argv[2] ?? path.join(root, "data/duosmium/data/results"));
const output = path.resolve(process.argv[3] ?? path.join(root, "output"));
const throughSeason = process.argv[4] === undefined ? Infinity : Number(process.argv[4]);
if (throughSeason !== Infinity && (!Number.isInteger(throughSeason) || throughSeason < 1900)) {
  throw new Error("Optional through-season must be an integer year");
}
const configPath = path.resolve(process.argv[5] ?? path.join(root, "config/model_v2.json"));
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const eventHistoryColumns = [
  "schoolId", "canonicalName", "city", "state", "division", "eventKey",
  "canonicalEvent", "tournamentId", "tournamentName", "date", "season", "level",
  "eventTeamEntryId", "eventTeamNumber", "eventInstanceId",
  "officialEventPlace", "representativeEventRank", "fieldSize", "effectiveFieldSize",
  "evidenceCoverage", "coverageEvidenceWeight", "lineupReliabilityWeight",
  "evidenceWeight", "fieldAverageRating", "topFieldStrength", "topFieldSize",
  "fieldStrength", "fieldQuality", "formatPrior", "informationWeight",
  "expectedPerformance", "actualPerformance", "expectedRank", "performanceRating",
  "effectiveGames", "preRating", "postRating", "combinedSameDayPostRating",
  "preUncertainty", "postUncertainty", "uncertaintyInformation", "ratingChange",
  "tournamentPerformanceEstimate",
  "modelVersion",
];

if (!fs.existsSync(archive)) {
  console.error(`Duosmium results directory not found: ${archive}`);
  console.error("Usage: node scripts/rebuild-ratings.js <duosmium-results-dir> [output-dir] [through-season] [config-path]");
  process.exit(2);
}

const { tournaments: archiveTournaments, errors } = loadArchive(archive);
const tournaments = archiveTournaments.filter(tournament => tournament.season <= throughSeason);
if (!tournaments.length) throw new Error("No eligible tournaments in requested season range");
fs.mkdirSync(output, { recursive: true });
const engine = new RatingEngine(config);
const { states, snapshots } = engine.rebuild(tournaments);
const eventHistoryPath = path.join(output, "event_rating_history.csv");
fs.writeFileSync(eventHistoryPath, `${eventHistoryColumns.join(",")}\n`);
const eventValidation = {
  snapshots: 0,
  squaredPerformanceError: 0,
  absolutePerformanceError: 0,
  normalizedRankAbsoluteError: 0,
};
const eventEngine = new EventRatingEngine(config, {
  sameDayLineupWeights: engine.sameDayLineupWeights,
  retainSnapshots: false,
  onSnapshots: (batch) => {
    fs.appendFileSync(eventHistoryPath, toCsvRows(batch, eventHistoryColumns));
    for (const snapshot of batch) {
      if (snapshot.season < 2022) continue;
      const performanceError = snapshot.expectedPerformance - snapshot.actualPerformance;
      eventValidation.snapshots += 1;
      eventValidation.squaredPerformanceError += performanceError ** 2;
      eventValidation.absolutePerformanceError += Math.abs(performanceError);
      eventValidation.normalizedRankAbsoluteError +=
        Math.abs(snapshot.expectedRank - snapshot.representativeEventRank) /
        Math.max(1, snapshot.fieldSize - 1);
    }
  },
});
const { states: eventStates } = eventEngine.rebuild(tournaments);
const validationSnapshots = snapshots.filter((snapshot) => snapshot.season >= 2022);
const predictionMetrics = {
  seasons: "2022+",
  snapshots: validationSnapshots.length,
  meanSquaredPerformanceError:
    validationSnapshots.reduce(
      (sum, snapshot) =>
        sum + (snapshot.expectedPerformance - snapshot.actualPerformance) ** 2,
      0,
    ) / validationSnapshots.length,
  meanAbsolutePerformanceError:
    validationSnapshots.reduce(
      (sum, snapshot) =>
        sum + Math.abs(snapshot.expectedPerformance - snapshot.actualPerformance),
      0,
    ) / validationSnapshots.length,
  ...rankMetrics(validationSnapshots),
};
const eventPredictionMetrics = {
  seasons: "2022+",
  snapshots: eventValidation.snapshots,
  meanSquaredPerformanceError:
    eventValidation.squaredPerformanceError / eventValidation.snapshots,
  meanAbsolutePerformanceError:
    eventValidation.absolutePerformanceError / eventValidation.snapshots,
  normalizedRankMeanAbsoluteError:
    eventValidation.normalizedRankAbsoluteError / eventValidation.snapshots,
};
const decoratedStates = new Map([...states].map(([key,state]) => [key,engine.nationals.decorateState(state)]));
const allProgramStates = rankedStates(decoratedStates);
const latestSeasonByDivision = Object.fromEntries(
  [...states.values()].reduce((latest, state) => {
    latest.set(
      state.division,
      Math.max(latest.get(state.division) ?? -Infinity, state.lastSeason ?? -Infinity),
    );
    return latest;
  }, new Map()),
);
const currentStates = new Map(
  [...decoratedStates].filter(
    ([, state]) => state.lastSeason === latestSeasonByDivision[state.division],
  ),
);
const rankings = rankedStates(currentStates);
const nationalsRankings = rankedStates(new Map([...currentStates].map(([key,state]) => [key,{
  ...state, rating:state.nationalsRating,
}])));
const allEventStates = rankedEventStates(eventStates);
const currentEventStates = new Map(
  [...eventStates].filter(
    ([, state]) => state.lastSeason === latestSeasonByDivision[state.division],
  ),
);
const eventRankings = rankedEventStates(currentEventStates);
const rankingAudit = auditHeadToHead(tournaments, currentStates, {
  formatPrior: config.formatPrior,
  ratingDivisor: config.ratingDivisor,
});
const rankingColumns = [
  "nationalRank", "stateRank", "schoolId", "canonicalName", "city", "state",
  "division", "rating", "uncertainty", "appearances", "lastSeason", "lastDate",
];
const nationalsRankingColumns = [...rankingColumns, "nationalsAdjustment", "priorNationalsAppearances"];
const programStateColumns = [...rankingColumns, "nationalsRating", "nationalsAdjustment", "priorNationalsAppearances"];
const historyColumns = [
  "schoolId", "canonicalName", "city", "state", "division", "tournamentId",
  "tournamentName", "date", "season", "level", "representativeTeamEntryId",
  "representativeTeamNumber", "officialOverallRank", "representativeOverallRank", "totalPoints", "fieldSize",
  "fieldAverageRating", "topFieldStrength", "topFieldSize", "fieldStrength",
  "effectiveFieldSize", "evidenceCoverage", "evidenceWeight",
  "coverageEvidenceWeight", "sameDayTournamentCount", "lineupReliabilityWeight",
  "fullStrengthProbability", "fullStrengthWeight", "fullStrengthPrior", "lineupAssessmentReason",
  "performanceDeficit", "squadCount", "opponentEvidenceFactor",
  "tournamentFormat", "formatPrior", "fieldQuality",
  "expectedPerformance", "actualPerformance", "averageScoreMarginMultiplier",
  "learningExpectedPerformance", "learningActualPerformance",
  "marginAdjustedResidual", "expectedRank",
  "performanceRating", "informationWeight", "preRating", "postRating",
  "effectiveGames",
  "preUncertainty", "postUncertainty", "uncertaintyInformation", "ratingChange",
  "combinedSameDayPostRating", "modelVersion",
  "nationalsPreRating", "nationalsPostRating", "nationalsRatingChange", "nationalsAdjustment",
  "postNationalsAdjustment", "priorNationalsAppearances", "postNationalsAppearances",
];
const eventRankingColumns = [
  "nationalEventRank", "stateEventRank", "schoolId", "canonicalName", "city",
  "state", "division", "eventKey", "canonicalEvent", "rating", "uncertainty",
  "appearances", "lastSeason", "lastDate",
];

fs.writeFileSync(path.join(output, "general_rankings.csv"), toCsv(rankings, rankingColumns));
fs.writeFileSync(path.join(output, "nationals_rankings.csv"), toCsv(nationalsRankings, nationalsRankingColumns));
fs.writeFileSync(path.join(output, "nationals_prediction_history.csv"), toCsv(engine.nationalsPredictions,[
  "schoolId","canonicalName","city","state","division","tournamentId","date","season","fieldSize",
  "actualRank","evidenceCoverage","preRating","nationalsAdjustment","priorNationalsAppearances",
  "nationalsPreRating","generalExpectedRank","nationalsExpectedRank","performanceRating","nationalsResidual",
  "postNationalsAdjustment","postNationalsAppearances",
]));
fs.writeFileSync(
  path.join(output, "ranking_audit.csv"),
  toCsv(rankingAudit, [
    "lowerRatedSchool", "lowerState", "lowerRating", "higherRatedSchool",
    "higherState", "higherRating", "meetings", "weightedMeetings",
    "observedLowerScore", "predictedLowerScore", "inconsistency",
  ]),
);
fs.writeFileSync(
  path.join(output, "all_program_states.csv"),
  toCsv(allProgramStates, programStateColumns),
);
fs.writeFileSync(
  path.join(output, "rating_history.csv"),
  toCsv(snapshots, historyColumns),
);
fs.writeFileSync(
  path.join(output, "event_rankings.csv"),
  toCsv(eventRankings, eventRankingColumns),
);
fs.writeFileSync(
  path.join(output, "all_event_states.csv"),
  toCsv(allEventStates, eventRankingColumns),
);
fs.writeFileSync(
  path.join(output, "rebuild_report.json"),
  JSON.stringify(
    {
      modelVersion: config.modelVersion,
      ratingDivisor: config.ratingDivisor ?? 400,
      throughSeason: Number.isFinite(throughSeason) ? throughSeason : undefined,
      eventModelVersion: config.eventModel.modelVersion,
      eventUpdateRule: "correlated-tournament-posterior",
      eventTournamentPerformanceUncertainty: config.eventModel.tournamentPerformanceUncertainty,
      tournamentsProcessed: tournaments.length,
      schoolsRated: states.size,
      schoolsInCurrentRankings: currentStates.size,
      latestSeasonByDivision,
      snapshots: snapshots.length,
      lineupModel: config.lineupModel,
      nationalsAdjustment: config.nationalsAdjustment,
      nationalsPredictionMetrics: nationalsMetrics(engine.nationalsPredictions),
      lineupDiagnostics: {
        discountedAppearances: snapshots.filter(s => s.fullStrengthWeight < 0.5).length,
        minimallyCountedAppearances: snapshots.filter(s => s.fullStrengthWeight <= (config.lineupModel?.minimumWeight ?? 0)).length,
      },
      eventRatings: eventStates.size,
      currentEventRatings: currentEventStates.size,
      eventSnapshots: eventEngine.snapshotCount,
      headToHeadInconsistencies: rankingAudit.length,
      predictionMetrics,
      eventPredictionMetrics,
      parseErrors: errors,
    },
    null,
    2,
  ) + "\n",
);

console.log(
  `Processed ${tournaments.length} tournaments, ${states.size} schools, ` +
    `${snapshots.length} overall and ${eventEngine.snapshotCount} event snapshots; ` +
    `${errors.length} files failed.`,
);
console.log(`Outputs: ${output}`);
