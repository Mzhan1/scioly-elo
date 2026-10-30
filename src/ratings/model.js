import { representativeEntries } from "../scoring/sciolyff.js";
import { fullStrengthAssessment } from "./lineup.js";
import { NationalsAdjustment } from "./nationals.js";
import {
  appearanceKey,
  competitiveLineupWeights,
  concurrentTournamentCounts,
  scheduleKey,
  tournamentFormat,
  tournamentFormatPrior,
} from "./evidence.js";

const DAYS_PER_YEAR = 365.2425;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function expectedScore(rating, opponentRating, divisor = 400) {
  return 1 / (1 + 10 ** ((opponentRating - rating) / divisor));
}

function actualScore(rank, opponentRank) {
  if (rank < opponentRank) return 1;
  if (rank > opponentRank) return 0;
  return 0.5;
}

function coverageEvidenceWeight(entry) {
  return (entry.evidenceCoverage ?? 1) ** 2;
}

function weightedMean(items, value) {
  const totalWeight = items.reduce((sum, item) => sum + item.evidenceWeight, 0);
  if (totalWeight === 0) return 0.5;
  return items.reduce(
    (sum, item) => sum + item.evidenceWeight * value(item),
    0,
  ) / totalWeight;
}

function scoredEventCount(entry, tournament) {
  const officialEvents = tournament.events?.filter((event) => event.official).length;
  if (officialEvents > 0) return officialEvents;
  return Math.max(1, entry.scoredEventCount ?? 1);
}

function scoreMarginMultiplier(entry, opponent, tournament, config) {
  if (!Number.isFinite(entry.totalPoints) || !Number.isFinite(opponent.totalPoints)) return 1;
  const pointMargin = Math.abs(entry.totalPoints - opponent.totalPoints);
  const eventCount = Math.max(
    scoredEventCount(entry, tournament),
    scoredEventCount(opponent, tournament),
  );
  return Math.min(
    config.maximumScoreMarginMultiplier,
    1 + config.scoreMarginLogStrength * Math.log1p(pointMargin / eventCount),
  );
}

function dateDifferenceYears(older, newer) {
  return Math.max(0, (Date.parse(newer) - Date.parse(older)) / 86_400_000 / DAYS_PER_YEAR);
}

function levelPrior(level, config) {
  const normalized = String(level ?? "").trim().toLowerCase();
  return config.levelPrior[normalized] ?? config.levelPrior.default;
}

export class RatingEngine {
  constructor(config) {
    this.config = structuredClone(config);
    this.states = new Map();
    this.snapshots = [];
    this.concurrentCounts = new Map();
    this.sameDayLineupWeights = new Map();
    this.nationals = new NationalsAdjustment(config.nationalsAdjustment, config.ratingDivisor);
    this.nationalsPredictions = [];
  }

  currentState(entry) {
    return this.states.get(entry.schoolKey) ?? {
      schoolId: entry.schoolId,
      schoolKey: entry.schoolKey,
      canonicalName: entry.canonicalName,
      city: entry.city,
      state: entry.state,
      division: entry.division,
      rating: this.config.mean,
      uncertainty: this.config.initialUncertainty,
      appearances: 0,
      recentSquadCounts: [],
      lastSeason: undefined,
      lastDate: undefined,
    };
  }

  prepareState(entry, tournament) {
    const prior = { ...this.currentState(entry) };
    let rating = prior.rating;
    let uncertainty = prior.uncertainty;

    if (prior.lastDate) {
      const inactiveYears = dateDifferenceYears(prior.lastDate, tournament.date);
      uncertainty = Math.sqrt(
        uncertainty ** 2 + (inactiveYears * this.config.inactivityUncertaintyPerYear) ** 2,
      );
    }

    const seasonGap =
      prior.lastSeason === undefined
        ? 0
        : Math.max(0, tournament.season - prior.lastSeason);
    if (seasonGap > 0) {
      const carryover =
        this.config.divisionCarryover[entry.division] ??
        this.config.divisionCarryover.default;
      rating =
        this.config.mean + carryover ** seasonGap * (rating - this.config.mean);
      uncertainty = Math.sqrt(
        uncertainty ** 2 + seasonGap * this.config.seasonUncertaintyIncrease ** 2,
      );
    }

    return {
      ...prior,
      rating,
      uncertainty: clamp(
        uncertainty,
        this.config.minimumUncertainty,
        this.config.maximumUncertainty,
      ),
    };
  }

  tournamentInformationWeight(prepared, tournament) {
    const totalWeight = prepared.reduce((sum, item) => sum + item.evidenceWeight, 0);
    const averageRating = prepared.reduce(
      (sum, item) => sum + item.evidenceWeight * item.state.rating,
      0,
    ) / totalWeight;
    const sortedByRating = [...prepared].sort(
      (left, right) => right.state.rating - left.state.rating,
    );
    const topFieldSize = Math.min(
      sortedByRating.length,
      Math.max(
        this.config.minimumTopFieldSize,
        Math.min(
          this.config.maximumTopFieldSize,
          Math.ceil(sortedByRating.length * this.config.topFieldFraction),
        ),
      ),
    );
    const topField = sortedByRating.slice(0, topFieldSize);
    const topFieldWeight = topField.reduce((sum, item) => sum + item.evidenceWeight, 0);
    const topFieldStrength = topField.reduce(
      (sum, item) => sum + item.evidenceWeight * item.state.rating,
      0,
    ) / topFieldWeight;
    const fieldStrength =
      (1 - this.config.topFieldStrengthWeight) * averageRating +
      this.config.topFieldStrengthWeight * topFieldStrength;
    const establishedFraction = prepared.reduce(
      (sum, item) => sum + (item.state.appearances >= 3 ? item.evidenceWeight : 0),
      0,
    ) / totalWeight;
    const fieldQuality = clamp(
      this.config.minimumFieldQuality,
      this.config.maximumFieldQuality,
      1 +
        (fieldStrength - this.config.mean) / this.config.fieldQualityRatingDivisor +
        this.config.establishedFieldQualityWeight * (establishedFraction - 0.5),
    );
    return {
      fieldAverageRating: averageRating,
      topFieldStrength,
      topFieldSize,
      fieldStrength,
      fieldQuality,
      tournamentFormat: tournament.format ?? tournamentFormat(tournament),
      formatPrior: tournamentFormatPrior(tournament, this.config),
      informationWeight: clamp(
        levelPrior(tournament.level, this.config) *
          fieldQuality *
          tournamentFormatPrior(tournament, this.config),
        this.config.minimumInformationWeight,
        this.config.maximumInformationWeight,
      ),
    };
  }

  performanceRating(item, prepared) {
    const opponents = prepared.filter((other) => other !== item);
    if (opponents.length === 0) return item.state.rating;
    const actual = weightedMean(
      opponents,
      (opponent) =>
        actualScore(item.entry.officialOverallRank, opponent.entry.officialOverallRank),
    );
    const target = clamp(actual, 0.01, 0.99);
    const divisor = this.config.ratingDivisor ?? 400;
    let low = Math.min(...prepared.map(other => other.state.rating)) - 4 * divisor;
    let high = Math.max(...prepared.map(other => other.state.rating)) + 4 * divisor;
    for (let iteration = 0; iteration < 48; iteration += 1) {
      const middle = (low + high) / 2;
      const score = weightedMean(
        opponents,
        (opponent) => expectedScore(middle, opponent.state.rating, this.config.ratingDivisor),
      );
      if (score < target) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  }

  evaluateNationalsField(tournament, stateOverrides) {
    if (String(tournament.level).trim().toLowerCase() !== 'nationals') return [];
    const entries = representativeEntries(tournament).filter(entry =>
      !entry.exhibition && !entry.disqualified && Number.isFinite(entry.officialOverallRank));
    return this.nationals.evaluateField(tournament, entries.map(entry => ({
      schoolId: entry.schoolId, canonicalName: entry.canonicalName, city: entry.city,
      state: entry.state, division: entry.division, officialOverallRank: entry.officialOverallRank,
      evidenceCoverage: entry.evidenceCoverage ?? 1,
      preRating: (stateOverrides?.get(entry.schoolKey) ?? this.prepareState(entry, tournament)).rating,
    })));
  }

  commitNationals(fields, snapshots) {
    for (const rows of fields) this.nationals.observeField(rows);
    for (const rows of fields) for (const row of rows) {
      const after = this.nationals.summary(row.schoolId, row.date, { inclusive: true });
      this.nationalsPredictions.push({ ...row, postNationalsAdjustment: after.adjustment,
        postNationalsAppearances: after.appearances });
    }
    for (const snapshot of snapshots) {
      const after = this.nationals.summary(snapshot.schoolId, snapshot.date, { inclusive: true });
      snapshot.postNationalsAdjustment = after.adjustment;
      snapshot.postNationalsAppearances = after.appearances;
      snapshot.nationalsPostRating = (snapshot.combinedSameDayPostRating ?? snapshot.postRating) + after.adjustment;
      snapshot.nationalsRatingChange = snapshot.ratingChange +
        (String(snapshot.level).trim().toLowerCase() === 'nationals' ? after.adjustment - snapshot.nationalsAdjustment : 0);
    }
  }

  rateTournament(tournament, { stateOverrides, commit = true } = {}) {
    const nationalsField = commit ? this.evaluateNationalsField(tournament, stateOverrides) : [];
    const entries = representativeEntries(tournament, { rateableOnly: true }).filter(
      (entry) =>
        (entry.evidenceCoverage ?? 1) >=
        this.config.minimumOverallEvidenceCoverage,
    );
    if (entries.length < 2) {
      if (commit) this.commitNationals([nationalsField], []);
      return [];
    }

    const prepared = entries.map((entry) => {
      const sameDayTournamentCount =
        this.concurrentCounts.get(scheduleKey(tournament.date, entry.schoolKey)) ?? 1;
      const lineupReliabilityWeight =
        this.sameDayLineupWeights.get(appearanceKey(tournament.id, entry.schoolKey)) ?? 1;
      const coverageWeight = coverageEvidenceWeight(entry);
      return {
        entry,
        state: stateOverrides?.get(entry.schoolKey) ?? this.prepareState(entry, tournament),
        sameDayTournamentCount,
        lineupReliabilityWeight,
        coverageWeight,
        evidenceWeight: coverageWeight * lineupReliabilityWeight,
      };
    });
    // Freeze prediction diagnostics before inferring reliability from this result.
    // Outcome-dependent weights must never enter reported pre-result forecasts.
    const forecasts = new Map(prepared.map((item) => {
      const opponents = prepared.filter(other => other !== item);
      const expected = weightedMean(opponents, opponent => expectedScore(
        item.state.rating, opponent.state.rating, this.config.ratingDivisor,
      ));
      const actual = weightedMean(opponents, opponent => actualScore(
        item.entry.officialOverallRank, opponent.entry.officialOverallRank,
      ));
      const performanceRating = this.performanceRating(item, prepared);
      // Perfect results are clamped for finite performance diagnostics. That
      // numerical convention must not turn a favorite's win into a bad result.
      const performanceDeficit = actual < expected ? Math.max(0, item.state.rating - performanceRating) : 0;
      return [item, { expected, actual, performanceRating, performanceDeficit }];
    }));
    for (const item of prepared) {
      const forecast = forecasts.get(item);
      item.squadCount = tournament.teamEntries.filter(entry =>
        entry.schoolKey === item.entry.schoolKey && !entry.exhibition && !entry.disqualified,
      ).length;
      const recent = item.state.recentSquadCounts ?? [];
      const usualSquadCount = recent.length ? [...recent].sort((a,b) => a-b)[Math.floor(recent.length/2)] : 1;
      item.lineupAssessment = fullStrengthAssessment({
        level: tournament.level,
        performanceDeficit: forecast.performanceDeficit,
        uncertainty: item.state.uncertainty,
        appearances: item.state.appearances,
        evidenceCoverage: item.entry.evidenceCoverage ?? 1,
        sameDayTournamentCount: item.sameDayTournamentCount,
        daysSincePreviousAppearance: item.state.lastDate ?
          (Date.parse(tournament.date) - Date.parse(item.state.lastDate)) / 86_400_000 : Infinity,
        squadCount: item.squadCount,
        usualSquadCount,
        month: Number(tournament.date.slice(5,7)),
      }, this.config.lineupModel);
    }
    // Assess everyone against the original frozen field in one pass. Then weight
    // both the school's update and its influence as another school's opponent.
    for (const item of prepared) item.evidenceWeight *= item.lineupAssessment.weight;
    const strength = this.tournamentInformationWeight(prepared, tournament);
    const tournamentSnapshots = prepared.map((item) => {
      const opponents = prepared.filter((other) => other !== item);
      const expected = weightedMean(
        opponents,
        (opponent) => expectedScore(item.state.rating, opponent.state.rating, this.config.ratingDivisor),
      );
      const actual = weightedMean(
        opponents,
        (opponent) =>
          actualScore(item.entry.officialOverallRank, opponent.entry.officialOverallRank),
      );
      const averageScoreMarginMultiplier = weightedMean(
        opponents,
        (opponent) =>
          scoreMarginMultiplier(item.entry, opponent.entry, tournament, this.config),
      );
      const marginAdjustedResidual = weightedMean(
        opponents,
        (opponent) =>
          scoreMarginMultiplier(item.entry, opponent.entry, tournament, this.config) *
          (actualScore(
            item.entry.officialOverallRank,
            opponent.entry.officialOverallRank,
          ) - expectedScore(item.state.rating, opponent.state.rating, this.config.ratingDivisor)),
      );
      const uncertaintyFactor = clamp(
        item.state.uncertainty / this.config.initialUncertainty,
        this.config.minimumUncertaintyFactor,
        this.config.maximumUncertaintyFactor,
      );
      // Relative opponent weights cancel in a dual. Preserve the absolute loss
      // of support when the entire remaining field is likely nonrepresentative.
      const opponentEvidenceFactor = this.config.lineupModel?.enabled ? Math.min(
        1, opponents.reduce((sum, opponent) => sum + opponent.evidenceWeight, 0),
      ) : 1;
      const effectiveGames = Math.min(
        this.config.maximumEffectiveGames,
        1 +
          Math.log2(
            Math.max(
              1,
              opponents.reduce((sum, opponent) => sum + opponent.evidenceWeight, 0),
            ),
          ),
      );
      const ratingChange =
        this.config.baseK *
        effectiveGames *
        strength.informationWeight *
        uncertaintyFactor *
        opponentEvidenceFactor *
        item.evidenceWeight *
        marginAdjustedResidual;
      const postUncertainty = clamp(
        item.state.uncertainty /
          Math.sqrt(
            1 +
              item.evidenceWeight *
                opponentEvidenceFactor *
                strength.informationWeight *
                Math.max(0.35, 4 * expected * (1 - expected)),
          ),
        this.config.minimumUncertainty,
        this.config.maximumUncertainty,
      );
      const forecast = forecasts.get(item);
      const uncertaintyInformation =
        item.evidenceWeight *
        opponentEvidenceFactor *
        strength.informationWeight *
        Math.max(0.35, 4 * expected * (1 - expected));
      const nationals = this.nationals.summary(item.entry.schoolId, tournament.date);

      return {
        schoolId: item.entry.schoolId,
        schoolKey: item.entry.schoolKey,
        canonicalName: item.entry.canonicalName,
        city: item.entry.city,
        state: item.entry.state,
        division: item.entry.division,
        tournamentId: tournament.id,
        tournamentName: tournament.name,
        date: tournament.date,
        season: tournament.season,
        level: tournament.level,
        representativeTeamEntryId: item.entry.id,
        representativeTeamNumber: item.entry.number,
        officialOverallRank: item.entry.officialOverallRank,
        representativeOverallRank: 1 + opponents.reduce(
          (sum, opponent) => sum + 1 - actualScore(
            item.entry.officialOverallRank, opponent.entry.officialOverallRank,
          ), 0,
        ),
        fieldSize: prepared.length,
        effectiveFieldSize: prepared.reduce(
          (sum, participant) => sum + participant.evidenceWeight,
          0,
        ),
        evidenceCoverage: item.entry.evidenceCoverage ?? 1,
        coverageEvidenceWeight: item.coverageWeight,
        sameDayTournamentCount: item.sameDayTournamentCount,
        lineupReliabilityWeight: item.lineupReliabilityWeight,
        fullStrengthProbability: item.lineupAssessment.probability,
        fullStrengthWeight: item.lineupAssessment.weight,
        fullStrengthPrior: item.lineupAssessment.prior,
        lineupAssessmentReason: item.lineupAssessment.reason,
        performanceDeficit: forecast.performanceDeficit,
        squadCount: item.squadCount,
        evidenceWeight: item.evidenceWeight,
        opponentEvidenceFactor,
        totalPoints: item.entry.totalPoints,
        averageScoreMarginMultiplier,
        marginAdjustedResidual,
        fieldAverageRating: strength.fieldAverageRating,
        topFieldStrength: strength.topFieldStrength,
        topFieldSize: strength.topFieldSize,
        fieldStrength: strength.fieldStrength,
        fieldQuality: strength.fieldQuality,
        tournamentFormat: strength.tournamentFormat,
        formatPrior: strength.formatPrior,
        expectedPerformance: forecast.expected,
        actualPerformance: forecast.actual,
        learningExpectedPerformance: expected,
        learningActualPerformance: actual,
        expectedRank: 1 + opponents.reduce(
          (sum, opponent) => sum + 1 - expectedScore(
            item.state.rating, opponent.state.rating, this.config.ratingDivisor,
          ), 0,
        ),
        performanceRating: forecast.performanceRating,
        informationWeight: strength.informationWeight,
        effectiveGames,
        preRating: item.state.rating,
        nationalsPreRating: item.state.rating + nationals.adjustment,
        nationalsAdjustment: nationals.adjustment,
        priorNationalsAppearances: nationals.appearances,
        postRating: item.state.rating + ratingChange,
        preUncertainty: item.state.uncertainty,
        postUncertainty,
        uncertaintyInformation,
        ratingChange,
        modelVersion: this.config.modelVersion,
        priorAppearances: item.state.appearances,
        priorSquadCounts: item.state.recentSquadCounts ?? [],
      };
    });

    if (commit) {
      // Commit only after every result is computed, preventing same-tournament leakage.
      for (const snapshot of tournamentSnapshots) {
        this.states.set(snapshot.schoolKey, {
          schoolId: snapshot.schoolId,
          schoolKey: snapshot.schoolKey,
          canonicalName: snapshot.canonicalName,
          city: snapshot.city,
          state: snapshot.state,
          division: snapshot.division,
          rating: snapshot.postRating,
          uncertainty: snapshot.postUncertainty,
          appearances: snapshot.priorAppearances + 1,
          recentSquadCounts: [...snapshot.priorSquadCounts, snapshot.squadCount].slice(-5),
          lastSeason: snapshot.season,
          lastDate: snapshot.date,
        });
      }
      this.snapshots.push(...tournamentSnapshots);
      this.commitNationals([nationalsField], tournamentSnapshots);
    }
    return tournamentSnapshots;
  }

  rebuild(tournaments) {
    const ordered = [...tournaments].sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.division.localeCompare(b.division) ||
        a.id.localeCompare(b.id),
    );
    const eligibleEntries = (tournament) =>
      representativeEntries(tournament, { rateableOnly: true }).filter(
        (entry) =>
          (entry.evidenceCoverage ?? 1) >=
          this.config.minimumOverallEvidenceCoverage,
      );
    this.concurrentCounts = concurrentTournamentCounts(ordered, eligibleEntries);

    for (let start = 0; start < ordered.length;) {
      let end = start + 1;
      while (end < ordered.length && ordered[end].date === ordered[start].date) end += 1;
      const dateBatch = ordered.slice(start, end);
      const stateOverrides = new Map();
      for (const tournament of dateBatch) {
        for (const entry of eligibleEntries(tournament)) {
          if (!stateOverrides.has(entry.schoolKey)) {
            stateOverrides.set(entry.schoolKey, this.prepareState(entry, tournament));
          }
        }
      }

      const appearancesBySchool = new Map();
      for (const tournament of dateBatch) {
        const entries = eligibleEntries(tournament);
        if (entries.length < 2) continue;
        const selectionField = this.tournamentInformationWeight(
          entries.map((entry) => ({
            entry,
            state: stateOverrides.get(entry.schoolKey),
            evidenceWeight: coverageEvidenceWeight(entry),
          })),
          tournament,
        );
        for (const entry of entries) {
          const appearances = appearancesBySchool.get(entry.schoolKey) ?? [];
          appearances.push({ tournamentId: tournament.id, fieldStrength: selectionField.fieldStrength });
          appearancesBySchool.set(entry.schoolKey, appearances);
        }
      }
      for (const [schoolKey, appearances] of appearancesBySchool) {
        const weights = competitiveLineupWeights(
          appearances.map((appearance) => appearance.fieldStrength),
          {
            temperature: this.config.sameDayFieldStrengthTemperature,
            minimumRawWeight: this.config.minimumSplitSquadRawWeight,
          },
        );
        appearances.forEach((appearance, index) => {
          this.sameDayLineupWeights.set(
            appearanceKey(appearance.tournamentId, schoolKey),
            weights[index],
          );
        });
      }

      const nationalsFields = dateBatch.map(tournament => this.evaluateNationalsField(tournament, stateOverrides));
      const batchSnapshots = dateBatch.flatMap((tournament) =>
        this.rateTournament(tournament, { stateOverrides, commit: false }),
      );
      const bySchool = new Map();
      for (const snapshot of batchSnapshots) {
        const schoolSnapshots = bySchool.get(snapshot.schoolKey) ?? [];
        schoolSnapshots.push(snapshot);
        bySchool.set(snapshot.schoolKey, schoolSnapshots);
      }
      for (const [schoolKey, schoolSnapshots] of bySchool) {
        const baseline = stateOverrides.get(schoolKey);
        const latest = schoolSnapshots.at(-1);
        const combinedRating =
          baseline.rating + schoolSnapshots.reduce((sum, item) => sum + item.ratingChange, 0);
        const combinedUncertainty = clamp(
          baseline.uncertainty /
            Math.sqrt(
              1 +
                schoolSnapshots.reduce(
                  (sum, item) => sum + item.uncertaintyInformation,
                  0,
                ),
            ),
          this.config.minimumUncertainty,
          this.config.maximumUncertainty,
        );
        for (const snapshot of schoolSnapshots) {
          snapshot.combinedSameDayPostRating = combinedRating;
        }
        this.states.set(schoolKey, {
          schoolId: latest.schoolId,
          schoolKey,
          canonicalName: latest.canonicalName,
          city: latest.city,
          state: latest.state,
          division: latest.division,
          rating: combinedRating,
          uncertainty: combinedUncertainty,
          appearances: baseline.appearances + schoolSnapshots.length,
          recentSquadCounts: [...(baseline.recentSquadCounts ?? []), ...schoolSnapshots.map(item => item.squadCount)].slice(-5),
          lastSeason: Math.max(...schoolSnapshots.map((item) => item.season)),
          lastDate: latest.date,
        });
      }
      this.snapshots.push(...batchSnapshots);
      this.commitNationals(nationalsFields, batchSnapshots);
      start = end;
    }
    return { states: this.states, snapshots: this.snapshots };
  }
}
