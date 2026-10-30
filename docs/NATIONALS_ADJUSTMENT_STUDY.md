# Earlier-Nationals adjustment

Implemented October 30, 2026 as `so-rating-v2.8`, on top of v2.7 invitational lineup weighting.

General ratings retain their original learning rules. A separate Nationals view adds a school-specific adjustment from completed earlier Nationals. The fixed rule is `sum(earlier residuals) / (earlier appearances + 5)`, with strength 1. A first-time Nationals school receives zero adjustment. No settings were newly tuned against 2025 or 2026.

Each residual measures the school’s field-adjusted overall performance against entering General ratings. The current tournament’s outcome enters history only after its whole date batch, and never alters its own forecast. Same-day forecasts share the earlier history. Unused registrations do not count. Finite tail targets cannot reverse the sign of actual over- or underperformance.

## Matched retrospective comparisons

| Nationals period | General, all teams | Adjusted, all teams | General, top 25 | Adjusted, top 25 |
| --- | ---: | ---: | ---: | ---: |
| 2015–2021 | 0.942934 | 0.944172 | 0.790513 | 0.805513 |
| 2022–2024 | 0.932240 | 0.943929 | 0.742821 | 0.797436 |
| 2025 | 0.946707 | 0.956266 | 0.738462 | 0.760000 |
| 2026 | 0.956984 | 0.960316 | 0.795385 | 0.830000 |
| 2015–2026 | 0.941638 | 0.946673 | 0.773217 | 0.801399 |

Correlations use identical full school-representative fields for both views and average tournaments equally. The 2015–2026 window contains 11 Nationals. These seasons were examined in earlier work; results are retrospective, rather than an untouched future test. The parameters were carried over from the earlier diagnostic rather than reselected for the new lineup model.

## Product behavior

The General / Nationals switch applies to school ratings and ranks, leaderboard ordering, comparisons, chart history, recent results, and CSV downloads. `?rating=nationals` opens the conditional view directly. Current post-tournament ratings include completed results for forecasting the next Nationals; historical pre-result predictions are exported separately. Rankings cover all active programs and are not a qualification forecast.

Known incomplete Nationals appearances can update the adjustment while being excluded from General Elo. They are labeled “Nationals adjustment only” and appear only in the conditional history. This preserves both the General evidence rules and agreement between conditional chart endpoints and current conditional ratings.

## Verification

All 62 tests pass. An independent chronological reconstruction checks all 2,232 historical Nationals forecasts: maximum difference in the earlier-history adjustment is 0. All 48,061 General appearances retain exactly the v2.7 entering rating, resulting rating, rating change and posterior uncertainty (maximum difference 0.0).

All conditional chart endpoints match current conditional ratings. There are 65 adjustment-only history points. Unit tests cover shrinkage, sparse histories, future/current-result leakage, same-day commits, tail censoring, duplicate observations, unchanged General learning, view-specific ordering, and conditional-only histories.

Browser visual verification was not repeated because local browser access was previously declined. Source syntax, data consistency and view-selection logic were checked without browser access.

## Files and reproduction

- Implementation: `src/ratings/nationals.js` and `src/ratings/model.js`.
- Fixed baseline: `config/model_v2.7.json`.
- Current conditional ranking: `output/nationals_rankings.csv`.
- Entering forecasts and residuals: `output/nationals_prediction_history.csv`.
- Matched metrics: `output/rebuild_report.json`, under `nationalsPredictionMetrics`.

```sh
node scripts/rebuild-ratings.js <archive>/data/results output 2026
node scripts/build-web-data.js
node --test test/*.test.js
```

The adjustment uses all earlier Nationals and has no separately calibrated uncertainty. It can retain outdated program or coaching history. Event ratings do not receive an analogous per-event adjustment.
