import { bestSchoolEventEvidence } from "../scoring/sciolyff.js";
import { appearanceKey, tournamentFormatPrior } from "./evidence.js";
import { tournamentPosterior, combineTournamentPosteriors } from "./tournament-posterior.js";

const DAYS_PER_YEAR = 365.2425;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function fold(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

export function canonicalEventKey(name) {
  return fold(name);
}

function stateKey(schoolKey, eventKey) {
  return `${schoolKey}\u0000${eventKey}`;
}

function expectedScore(rating, opponentRating) {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

function actualScore(place, opponentPlace) {
  if (place < opponentPlace) return 1;
  if (place > opponentPlace) return 0;
  return 0.5;
}

function weightedMean(items, value) {
  const totalWeight = items.reduce((sum, item) => sum + item.evidenceWeight, 0);
  if (totalWeight === 0) return 0.5;
  return items.reduce(
    (sum, item) => sum + item.evidenceWeight * value(item),
    0,
  ) / totalWeight;
}

function dateDifferenceYears(older, newer) {
  return Math.max(0, (Date.parse(newer) - Date.parse(older)) / 86_400_000 / DAYS_PER_YEAR);
}

function levelPrior(level, config) {
  const normalized = fold(level);
  return config.levelPrior[normalized] ?? config.levelPrior.default;
}

/** Build one best-squad-per-school field for every official event. */
function eventFields(tournament) {
  const entriesById = new Map(tournament.teamEntries.map((entry) => [entry.id, entry]));
  const eventsById = new Map(
    tournament.events.filter((event) => event.official).map((event) => [event.id, event]),
  );
  const fields = new Map();

  for (const result of bestSchoolEventEvidence(tournament)) {
    const entry = entriesById.get(result.teamEntryId);
    const event = eventsById.get(result.eventInstanceId);
    if (!entry || !event) continue;
    const eventKey = canonicalEventKey(event.canonicalName);
    const field = fields.get(eventKey) ?? {
      eventKey,
      canonicalEvent: event.canonicalName,
      eventInstanceId: event.id,
      participants: [],
    };
    field.participants.push({ entry, result, event });
    fields.set(eventKey, field);
  }

  return [...fields.values()].filter((field) => field.participants.length >= 2);
}

export class EventRatingEngine {
  constructor(
    config,
    {
      sameDayLineupWeights = new Map(),
      retainSnapshots = true,
      calculatePerformanceRatings = true,
      onSnapshots,
    } = {},
  ) {
    this.config = structuredClone(config);
    this.eventConfig = this.config.eventModel;
    this.sameDayLineupWeights = sameDayLineupWeights;
    this.retainSnapshots = retainSnapshots;
    this.calculatePerformanceRatings = calculatePerformanceRatings;
    this.onSnapshots = onSnapshots;
    this.states = new Map();
    this.snapshots = [];
    this.snapshotCount = 0;
  }

  recordSnapshots(snapshots) {
    this.snapshotCount += snapshots.length;
    if (this.retainSnapshots) this.snapshots.push(...snapshots);
    this.onSnapshots?.(snapshots);
  }

  currentState(entry, event) {
    const eventKey = canonicalEventKey(event.canonicalName);
    return this.states.get(stateKey(entry.schoolKey, eventKey)) ?? {
      schoolId: entry.schoolId,
      schoolKey: entry.schoolKey,
      canonicalName: entry.canonicalName,
      city: entry.city,
      state: entry.state,
      division: entry.division,
      eventKey,
      canonicalEvent: event.canonicalName,
      rating: this.eventConfig.mean,
      uncertainty: this.eventConfig.initialUncertainty,
      appearances: 0,
      lastSeason: undefined,
      lastDate: undefined,
    };
  }

  prepareState(entry, event, tournament) {
    const prior = { ...this.currentState(entry, event) };
    let rating = prior.rating;
    let uncertainty = prior.uncertainty;

    if (prior.lastDate) {
      const inactiveYears = dateDifferenceYears(prior.lastDate, tournament.date);
      uncertainty = Math.sqrt(
        uncertainty ** 2 +
          inactiveYears * this.eventConfig.inactivityUncertaintyPerYear ** 2,
      );
    }

    const seasonGap =
      prior.lastSeason === undefined
        ? 0
        : Math.max(0, tournament.season - prior.lastSeason);
    if (seasonGap > 0) {
      const carryover =
        this.eventConfig.divisionCarryover[entry.division] ??
        this.eventConfig.divisionCarryover.default;
      rating =
        this.eventConfig.mean +
        carryover ** seasonGap * (rating - this.eventConfig.mean);
      uncertainty = Math.sqrt(
        uncertainty ** 2 +
          seasonGap * this.eventConfig.seasonUncertaintyIncrease ** 2,
      );
    }

    return {
      ...prior,
      rating,
      uncertainty: clamp(
        uncertainty,
        this.eventConfig.minimumUncertainty,
        this.eventConfig.maximumUncertainty,
      ),
    };
  }

  fieldInformation(prepared, tournament) {
    const totalWeight = prepared.reduce((sum, item) => sum + item.evidenceWeight, 0);
    const fieldAverageRating = prepared.reduce(
      (sum, item) => sum + item.evidenceWeight * item.state.rating,
      0,
    ) / totalWeight;
    const sorted = [...prepared].sort((left, right) => right.state.rating - left.state.rating);
    const topFieldSize = Math.min(
      sorted.length,
      Math.max(
        this.eventConfig.minimumTopFieldSize,
        Math.min(
          this.eventConfig.maximumTopFieldSize,
          Math.ceil(sorted.length * this.eventConfig.topFieldFraction),
        ),
      ),
    );
    const top = sorted.slice(0, topFieldSize);
    const topWeight = top.reduce((sum, item) => sum + item.evidenceWeight, 0);
    const topFieldStrength = top.reduce(
      (sum, item) => sum + item.evidenceWeight * item.state.rating,
      0,
    ) / topWeight;
    const fieldStrength =
      (1 - this.eventConfig.topFieldStrengthWeight) * fieldAverageRating +
      this.eventConfig.topFieldStrengthWeight * topFieldStrength;
    const establishedFraction = prepared.reduce(
      (sum, item) => sum + (item.state.appearances >= 3 ? item.evidenceWeight : 0),
      0,
    ) / totalWeight;
    const fieldQuality = clamp(
      this.eventConfig.minimumFieldQuality,
      this.eventConfig.maximumFieldQuality,
      1 +
        (fieldStrength - this.eventConfig.mean) /
          this.eventConfig.fieldQualityRatingDivisor +
        this.eventConfig.establishedFieldQualityWeight * (establishedFraction - 0.5),
    );
    return {
      fieldAverageRating,
      topFieldStrength,
      topFieldSize,
      fieldStrength,
      fieldQuality,
      formatPrior: tournamentFormatPrior(tournament, this.config),
      informationWeight: clamp(
        levelPrior(tournament.level, this.config) *
          fieldQuality *
          tournamentFormatPrior(tournament, this.config),
        this.eventConfig.minimumInformationWeight,
        this.eventConfig.maximumInformationWeight,
      ),
    };
  }

  performanceRating(item, prepared) {
    const opponents = prepared.filter((other) => other !== item);
    const actual = weightedMean(
      opponents,
      (opponent) => actualScore(item.result.place, opponent.result.place),
    );
    const target = clamp(actual, 0.01, 0.99);
    let low = 0;
    let high = 4000;
    for (let iteration = 0; iteration < 48; iteration += 1) {
      const middle = (low + high) / 2;
      const score = weightedMean(
        opponents,
        (opponent) => expectedScore(middle, opponent.state.rating),
      );
      if (score < target) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  }

  rateTournament(tournament, { stateOverrides, commit = true } = {}) {
    const snapshots = [];
    for (const field of eventFields(tournament)) {
      const prepared = field.participants.map(({ entry, result, event }) => {
        const eventStateKey = stateKey(entry.schoolKey, field.eventKey);
        const lineupReliabilityWeight =
          this.sameDayLineupWeights.get(appearanceKey(tournament.id, entry.schoolKey)) ?? 1;
        const coverageEvidenceWeight = 1;
        return {
          entry,
          result,
          event,
          state:
            stateOverrides?.get(eventStateKey) ??
            this.prepareState(entry, event, tournament),
          coverageEvidenceWeight,
          lineupReliabilityWeight,
          evidenceWeight: coverageEvidenceWeight * lineupReliabilityWeight,
        };
      });
      const fieldInfo = this.fieldInformation(prepared, tournament);

      for (const item of prepared) {
        const opponents = prepared.filter((other) => other !== item);
        const expectedPerformance = weightedMean(
          opponents,
          (opponent) => expectedScore(item.state.rating, opponent.state.rating),
        );
        const actualPerformance = weightedMean(
          opponents,
          (opponent) => actualScore(item.result.place, opponent.result.place),
        );
        const effectiveGames = Math.min(
          this.eventConfig.maximumEffectiveGames,
          1 +
            Math.log2(
              Math.max(
                1,
                opponents.reduce((sum, opponent) => sum + opponent.evidenceWeight, 0),
              ),
            ),
        );
        const posterior = tournamentPosterior({
          rating: item.state.rating,
          uncertainty: item.state.uncertainty,
          initialUncertainty: this.eventConfig.initialUncertainty,
          baseK: this.eventConfig.baseK,
          divisor: 400,
          performanceUncertainty: this.eventConfig.tournamentPerformanceUncertainty,
          effectiveGames,
          informationWeight: fieldInfo.informationWeight,
          evidenceWeight: item.evidenceWeight,
          opponents: opponents.map(o => ({ rating: o.state.rating,
            score: actualScore(item.result.place, o.result.place), weight: o.evidenceWeight })),
        });
        const { ratingChange, uncertaintyInformation } = posterior;
        const postUncertainty = clamp(
          posterior.postUncertainty,
          this.eventConfig.minimumUncertainty,
          this.eventConfig.maximumUncertainty,
        );
        const representativeEventRank =
          1 + opponents.filter((opponent) => opponent.result.place < item.result.place).length;

        snapshots.push({
          schoolId: item.entry.schoolId,
          schoolKey: item.entry.schoolKey,
          canonicalName: item.entry.canonicalName,
          city: item.entry.city,
          state: item.entry.state,
          division: item.entry.division,
          eventKey: field.eventKey,
          canonicalEvent: field.canonicalEvent,
          tournamentId: tournament.id,
          tournamentName: tournament.name,
          date: tournament.date,
          season: tournament.season,
          level: tournament.level,
          eventTeamEntryId: item.entry.id,
          eventTeamNumber: item.entry.number,
          eventInstanceId: field.eventInstanceId,
          officialEventPlace: item.result.place,
          representativeEventRank,
          fieldSize: prepared.length,
          effectiveFieldSize: prepared.reduce(
            (sum, participant) => sum + participant.evidenceWeight,
            0,
          ),
          evidenceCoverage: item.entry.evidenceCoverage ?? 1,
          coverageEvidenceWeight: item.coverageEvidenceWeight,
          lineupReliabilityWeight: item.lineupReliabilityWeight,
          evidenceWeight: item.evidenceWeight,
          fieldAverageRating: fieldInfo.fieldAverageRating,
          topFieldStrength: fieldInfo.topFieldStrength,
          topFieldSize: fieldInfo.topFieldSize,
          fieldStrength: fieldInfo.fieldStrength,
          fieldQuality: fieldInfo.fieldQuality,
          formatPrior: fieldInfo.formatPrior,
          informationWeight: fieldInfo.informationWeight,
          expectedPerformance,
          actualPerformance,
          expectedRank: 1 + opponents.length * (1 - expectedPerformance),
          performanceRating: this.calculatePerformanceRatings
            ? this.performanceRating(item, prepared)
            : undefined,
          effectiveGames,
          preRating: item.state.rating,
          postRating: item.state.rating + ratingChange,
          preUncertainty: item.state.uncertainty,
          postUncertainty,
          uncertaintyInformation,
          ratingChange,
          tournamentPerformanceEstimate: posterior.tournamentPerformanceEstimate,
          modelVersion: this.eventConfig.modelVersion,
          priorAppearances: item.state.appearances,
        });
      }
    }

    if (commit) {
      for (const snapshot of snapshots) {
        this.states.set(stateKey(snapshot.schoolKey, snapshot.eventKey), {
          schoolId: snapshot.schoolId,
          schoolKey: snapshot.schoolKey,
          canonicalName: snapshot.canonicalName,
          city: snapshot.city,
          state: snapshot.state,
          division: snapshot.division,
          eventKey: snapshot.eventKey,
          canonicalEvent: snapshot.canonicalEvent,
          rating: snapshot.postRating,
          uncertainty: snapshot.postUncertainty,
          appearances: snapshot.priorAppearances + 1,
          lastSeason: snapshot.season,
          lastDate: snapshot.date,
        });
      }
      this.recordSnapshots(snapshots);
    }
    return snapshots;
  }

  rebuild(tournaments) {
    const ordered = [...tournaments].sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.division.localeCompare(right.division) ||
        left.id.localeCompare(right.id),
    );

    for (let start = 0; start < ordered.length;) {
      let end = start + 1;
      while (end < ordered.length && ordered[end].date === ordered[start].date) end += 1;
      const dateBatch = ordered.slice(start, end);
      const stateOverrides = new Map();
      for (const tournament of dateBatch) {
        for (const field of eventFields(tournament)) {
          for (const { entry, event } of field.participants) {
            const key = stateKey(entry.schoolKey, field.eventKey);
            if (!stateOverrides.has(key)) {
              stateOverrides.set(key, this.prepareState(entry, event, tournament));
            }
          }
        }
      }

      const batchSnapshots = dateBatch.flatMap((tournament) =>
        this.rateTournament(tournament, { stateOverrides, commit: false }),
      );
      const byState = new Map();
      for (const snapshot of batchSnapshots) {
        const key = stateKey(snapshot.schoolKey, snapshot.eventKey);
        const stateSnapshots = byState.get(key) ?? [];
        stateSnapshots.push(snapshot);
        byState.set(key, stateSnapshots);
      }
      for (const [key, stateSnapshots] of byState) {
        const baseline = stateOverrides.get(key);
        const latest = stateSnapshots.at(-1);
        const combined = combineTournamentPosteriors(baseline, stateSnapshots);
        const combinedRating = combined.rating;
        const combinedUncertainty = clamp(
          combined.uncertainty,
          this.eventConfig.minimumUncertainty,
          this.eventConfig.maximumUncertainty,
        );
        for (const snapshot of stateSnapshots) {
          snapshot.combinedSameDayPostRating = combinedRating;
        }
        this.states.set(key, {
          schoolId: latest.schoolId,
          schoolKey: latest.schoolKey,
          canonicalName: latest.canonicalName,
          city: latest.city,
          state: latest.state,
          division: latest.division,
          eventKey: latest.eventKey,
          canonicalEvent: latest.canonicalEvent,
          rating: combinedRating,
          uncertainty: combinedUncertainty,
          appearances: baseline.appearances + stateSnapshots.length,
          lastSeason: Math.max(...stateSnapshots.map((item) => item.season)),
          lastDate: latest.date,
        });
      }
      this.recordSnapshots(batchSnapshots);
      start = end;
    }
    return { states: this.states, snapshots: this.snapshots };
  }
}
