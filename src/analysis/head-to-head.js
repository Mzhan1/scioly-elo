import { representativeEntries } from "../scoring/sciolyff.js";
import {
  concurrentTournamentCounts,
  scheduleKey,
  splitSquadWeight,
  tournamentFormat,
} from "../ratings/evidence.js";

function expectedScore(rating, opponentRating) {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

function pairKey(left, right) {
  return left.schoolKey < right.schoolKey
    ? [left.schoolKey, right.schoolKey]
    : [right.schoolKey, left.schoolKey];
}

/** Find recent head-to-head records that disagree with the current rating order. */
export function auditHeadToHead(
  tournaments,
  currentStates,
  {
    lookbackSeasons = 4,
    minimumMeetings = 4,
    minimumCoverage = 0.75,
    formatPrior = { traditional: 1, hybrid: 0.8, satellite: 0.75 },
    sameDaySplitSquadExponent = 0.5,
  } = {},
) {
  const latestSeason = Math.max(...[...currentStates.values()].map((state) => state.lastSeason));
  const pairs = new Map();
  const eligibleEntries = (tournament) =>
    representativeEntries(tournament, { rateableOnly: true }).filter(
      (entry) =>
        currentStates.has(entry.schoolKey) &&
        (entry.evidenceCoverage ?? 1) >= minimumCoverage,
    );
  const concurrentCounts = concurrentTournamentCounts(tournaments, eligibleEntries);

  for (const tournament of tournaments) {
    if (tournament.season < latestSeason - lookbackSeasons + 1) continue;
    const entries = eligibleEntries(tournament);
    for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
        const left = entries[leftIndex];
        const right = entries[rightIndex];
        const [firstKey, secondKey] = pairKey(left, right);
        const key = `${firstKey}\u0000${secondKey}`;
        const record = pairs.get(key) ?? {
          firstKey,
          secondKey,
          meetings: 0,
          firstScore: 0,
          secondScore: 0,
        };
        const weight =
          Math.min(left.evidenceCoverage ?? 1, right.evidenceCoverage ?? 1) ** 2 *
          (formatPrior[tournament.format ?? tournamentFormat(tournament)] ?? 1) *
          Math.min(
            splitSquadWeight(
              concurrentCounts.get(scheduleKey(tournament.date, left.schoolKey)) ?? 1,
              sameDaySplitSquadExponent,
            ),
            splitSquadWeight(
              concurrentCounts.get(scheduleKey(tournament.date, right.schoolKey)) ?? 1,
              sameDaySplitSquadExponent,
            ),
          ) *
          0.8 ** (latestSeason - tournament.season);
        const leftScore =
          left.officialOverallRank < right.officialOverallRank
            ? 1
            : left.officialOverallRank > right.officialOverallRank
              ? 0
              : 0.5;
        record.meetings += 1;
        if (left.schoolKey === firstKey) {
          record.firstScore += weight * leftScore;
          record.secondScore += weight * (1 - leftScore);
        } else {
          record.firstScore += weight * (1 - leftScore);
          record.secondScore += weight * leftScore;
        }
        pairs.set(key, record);
      }
    }
  }

  return [...pairs.values()]
    .filter((pair) => pair.meetings >= minimumMeetings)
    .map((pair) => {
      const first = currentStates.get(pair.firstKey);
      const second = currentStates.get(pair.secondKey);
      const lower = first.rating <= second.rating ? first : second;
      const higher = lower === first ? second : first;
      const lowerScore = lower === first ? pair.firstScore : pair.secondScore;
      const higherScore = lower === first ? pair.secondScore : pair.firstScore;
      const weightedMeetings = lowerScore + higherScore;
      const observedLowerScore = lowerScore / weightedMeetings;
      const predictedLowerScore = expectedScore(lower.rating, higher.rating);
      return {
        lowerRatedSchool: lower.canonicalName,
        lowerState: lower.state,
        lowerRating: lower.rating,
        higherRatedSchool: higher.canonicalName,
        higherState: higher.state,
        higherRating: higher.rating,
        meetings: pair.meetings,
        weightedMeetings,
        observedLowerScore,
        predictedLowerScore,
        inconsistency: observedLowerScore - predictedLowerScore,
      };
    })
    .filter((pair) => pair.observedLowerScore > 0.5)
    .sort(
      (a, b) =>
        b.inconsistency * Math.sqrt(b.weightedMeetings) -
          a.inconsistency * Math.sqrt(a.weightedMeetings) ||
        b.meetings - a.meetings,
    );
}
