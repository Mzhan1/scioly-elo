function expectedScore(rating, opponent, divisor) {
  return 1 / (1 + 10 ** ((opponent - rating) / divisor));
}

/** A conditional Nationals prediction layer. It never feeds back into Elo. */
export class NationalsAdjustment {
  constructor(config, divisor = 225) {
    this.config = { enabled: false, strength: 1, priorAppearances: 5, ...config };
    if (!(this.config.priorAppearances > 0) || !Number.isFinite(this.config.strength)) {
      throw new Error('Nationals shrinkage must be positive and strength finite');
    }
    this.divisor = divisor;
    this.history = new Map();
    this.observed = new Set();
  }

  summary(schoolId, date, { inclusive = false } = {}) {
    const rows = this.config.enabled ? (this.history.get(schoolId) ?? []).filter(
      row => !date || row.date < date || (inclusive && row.date === date),
    ) : [];
    const residualSum = rows.reduce((sum, row) => sum + row.residual, 0);
    return {
      adjustment: this.config.strength * residualSum / (rows.length + this.config.priorAppearances),
      appearances: rows.length,
      residualSum,
    };
  }

  evaluateField(tournament, entrants) {
    if (!this.config.enabled || entrants.length < 2) return [];
    const prepared = entrants.map(entry => {
      const prior = this.summary(entry.schoolId, tournament.date);
      return { ...entry, priorNationalsAppearances: prior.appearances,
        nationalsAdjustment: prior.adjustment, nationalsPreRating: entry.preRating + prior.adjustment };
    });
    return prepared.map(entry => {
      const others = prepared.filter(other => other !== entry);
      const rank = 1 + others.reduce((sum, other) => sum +
        (other.officialOverallRank < entry.officialOverallRank ? 1 :
          other.officialOverallRank === entry.officialOverallRank ? 0.5 : 0), 0);
      const observed = (prepared.length - rank) / others.length;
      const target = Math.max(.01, Math.min(.99, observed));
      const expected = others.reduce((sum,other) => sum + expectedScore(entry.preRating,other.preRating,this.divisor),0)/others.length;
      let low = Math.min(...prepared.map(other => other.preRating)) - 4 * this.divisor;
      let high = Math.max(...prepared.map(other => other.preRating)) + 4 * this.divisor;
      for (let i = 0; i < 60; i++) {
        const mid = (low + high) / 2;
        const expected = others.reduce((sum, other) => sum + expectedScore(mid, other.preRating, this.divisor), 0) / others.length;
        if (expected < target) low = mid; else high = mid;
      }
      const performanceRating = (low + high) / 2;
      let residual = performanceRating - entry.preRating;
      // Finite tail targets cannot turn a last-place finish into positive
      // Nationals evidence, or penalize an overwhelming favorite for winning.
      if ((observed - expected) * residual < 0 || observed === expected) residual = 0;
      return { ...entry, tournamentId: tournament.id, date: tournament.date,
        season: tournament.season, fieldSize: prepared.length, actualRank: rank,
        generalExpectedRank: 1 + others.reduce((sum, other) => sum +
          1 - expectedScore(entry.preRating, other.preRating, this.divisor), 0),
        nationalsExpectedRank: 1 + others.reduce((sum, other) => sum +
          1 - expectedScore(entry.nationalsPreRating, other.nationalsPreRating, this.divisor), 0),
        performanceRating, nationalsResidual: residual };
    });
  }

  observeField(rows) {
    for (const row of rows) {
      // An unused registration is not an earlier Nationals appearance.
      if (!(row.evidenceCoverage > 0)) continue;
      const key = `${row.tournamentId}\u0000${row.schoolId}`;
      if (this.observed.has(key)) throw new Error('Duplicate Nationals observation');
      if (!Number.isFinite(row.nationalsResidual)) throw new Error('Non-finite Nationals residual');
      this.observed.add(key);
      const history = this.history.get(row.schoolId) ?? [];
      history.push({ date: row.date, residual: row.nationalsResidual });
      this.history.set(row.schoolId, history);
    }
  }

  decorateState(state) {
    const summary = this.summary(state.schoolId);
    return { ...state, nationalsRating: state.rating + summary.adjustment,
      nationalsAdjustment: summary.adjustment, priorNationalsAppearances: summary.appearances };
  }
}
