/** Probability that an invitational appearance represents full program strength.
 * Two Gaussian performance models share the school's entering uncertainty:
 * full strength has deficit 0; a secondary lineup has a positive mean deficit.
 * This is an empirical reliability estimate, not a confirmed roster label.
 */
export function fullStrengthAssessment(evidence, config) {
  const unchanged = (reason) => ({ probability: 1, weight: 1, prior: 1, reason });
  if (!config?.enabled) return unchanged("disabled");
  if (String(evidence.level).trim().toLowerCase() !== "invitational") {
    return unchanged("championship-or-other-level");
  }
  if (evidence.appearances < config.minimumHistory) return unchanged("insufficient-history");
  if (!Number.isFinite(evidence.performanceDeficit) || evidence.performanceDeficit <= 0) {
    return unchanged("no-underperformance");
  }

  let odds = config.secondaryPrior / (1 - config.secondaryPrior);
  if (evidence.sameDayTournamentCount > 1 || (
    evidence.daysSincePreviousAppearance > 0 &&
    evidence.daysSincePreviousAppearance <= config.nearbyDays
  )) odds *= config.nearbyOddsMultiplier;
  if (evidence.evidenceCoverage < config.partialCoverageThreshold) odds *= config.partialOddsMultiplier;
  if (evidence.squadCount === 1 && evidence.usualSquadCount >= 2) odds *= config.singleSquadOddsMultiplier;
  if (evidence.month >= 9 && evidence.month <= 11) odds *= config.autumnOddsMultiplier;

  const prior = 1 / (1 + odds);
  const variance = config.performanceNoise ** 2 + evidence.uncertainty ** 2;
  const shift = config.secondaryPerformanceDrop;
  const logLikelihoodRatio = (2 * evidence.performanceDeficit * shift - shift ** 2) / (2 * variance);
  const logOdds = Math.log(odds) + logLikelihoodRatio;
  const posterior = 1 / (1 + Math.exp(Math.max(-700, Math.min(700, logOdds))));
  return {
    probability: posterior,
    weight: Math.max(config.minimumWeight, posterior),
    prior,
    reason: posterior < 0.5 ? "possible-secondary-lineup" : "ordinary-performance-variation",
  };
}
