/** Finishing-rank evaluation counts each eligible school once, regardless of
 * the evidence weight used when learning ratings. Ties use average ranks. */
export function rankMetrics(snapshots) {
  const count = snapshots.length;
  if (!count) return { snapshots: 0 };
  let model = 0;
  let middle = 0;
  for (const s of snapshots) {
    const denominator = Math.max(1, s.fieldSize - 1);
    model += Math.abs(s.expectedRank - s.representativeOverallRank) / denominator;
    middle += Math.abs((Number(s.fieldSize) + 1) / 2 - s.representativeOverallRank) / denominator;
  }
  return {
    snapshots: count,
    rankDefinition: "Unweighted eligible-school ranks; average ranks for ties",
    normalizedRankMeanAbsoluteError: model / count,
    middleRankBaselineNormalizedMAE: middle / count,
    relativeImprovementOverMiddle: 1 - model / middle,
  };
}
