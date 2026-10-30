/** A tournament measures a single noisy performance shared by all comparisons.
 * The latent performance has variance priorVariance + performanceVariance.
 * Solve its Gaussian-prior / Bradley-Terry composite-likelihood posterior mode,
 * then condition the underlying school rating on that performance. No delta cap.
 */
export function tournamentPosterior({
  rating, uncertainty, initialUncertainty, baseK, divisor,
  performanceUncertainty, effectiveGames, informationWeight, evidenceWeight,
  opponents, normalizationWeight = opponents.reduce((sum,o) => sum + o.weight, 0),
}) {
  const q = Math.LN10 / divisor;
  const variance = uncertainty ** 2;
  const performanceVariance = performanceUncertainty ** 2;
  const totalVariance = variance + performanceVariance;
  // K specifies likelihood strength in the initial prior's rating units.
  // Unlike the old uncertainty-factor floor, actual prior precision governs
  // how much an established school can learn from an observation.
  const strength = baseK / (q * initialUncertainty ** 2) *
    effectiveGames * informationWeight * evidenceWeight;
  const likelihood = opponents.map(o => ({ ...o, weight: strength * o.weight / normalizationWeight }));
  const successes = likelihood.reduce((sum,o) => sum + o.weight * o.score, 0);
  const failures = likelihood.reduce((sum,o) => sum + o.weight * (1-o.score), 0);
  let low = rating - totalVariance * q * failures;
  let high = rating + totalVariance * q * successes;
  let performance = rating;
  function derivatives(value) {
    let gradient = -(value-rating) / totalVariance;
    let precision = 1 / totalVariance;
    for (const o of likelihood) {
      const p = 1 / (1 + Math.exp(q * (o.rating-value)));
      gradient += q * o.weight * (o.score-p);
      precision += q*q * o.weight * p * (1-p);
    }
    return { gradient, precision };
  }
  for (let iteration=0; iteration<64; iteration++) {
    const { gradient, precision } = derivatives(performance);
    if (Math.abs(gradient * totalVariance) < divisor * 1e-11) break;
    if (gradient > 0) low = performance;
    else high = performance;
    const next = performance + gradient / precision;
    performance = next > low && next < high ? next : (low+high)/2;
  }
  const precision = derivatives(performance).precision;
  const schoolShare = variance / totalVariance;
  const postVariance = variance * performanceVariance / totalVariance + schoolShare ** 2 / precision;
  return {
    ratingChange: schoolShare * (performance-rating),
    postUncertainty: Math.sqrt(postVariance),
    uncertaintyInformation: Math.max(0, variance/postVariance-1),
    tournamentPerformanceEstimate: performance,
  };
}

/** Merge same-date approximate Gaussian likelihood messages once against their
 * shared prior, rather than adding posterior deltas that each reuse that prior. */
export function combineTournamentPosteriors(prior, snapshots) {
  const information = snapshots.reduce((sum,s) => sum + s.uncertaintyInformation, 0);
  return {
    rating: prior.rating + snapshots.reduce((sum,s) =>
      sum + s.ratingChange * (1+s.uncertaintyInformation), 0) / (1+information),
    uncertainty: prior.uncertainty / Math.sqrt(1+information),
  };
}
