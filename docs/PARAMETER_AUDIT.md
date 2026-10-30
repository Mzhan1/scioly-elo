# Parameter evidence audit

This audit describes the current `config/model_v2.json`, not a claim that every
constant has been optimized. A tested value is not necessarily globally optimal.
Experiments are on the cached Division C archive through season 2026. Previously
inspected evaluation seasons are not pristine holdouts.

## Compared empirically

| Settings | Evidence and limitations |
| --- | --- |
| Nationals residual strength `1` and shrinkage `5` | Implements the earlier diagnostic as a conditional prediction layer over v2.7. No new tuning of these values against 2025/2026; the rebuild report compares identical historical Nationals fields. These settings were not jointly optimized with lineup inference, and the years have already been inspected. |
| Overall lineup performance noise `210` and secondary deficit `350` | `scripts/test-lineup-model.js`: fixed nine-value grid on 2022–2024; select highest Nationals Spearman among candidates improving all-tournament NMAE. Fixed choice then compared on 2025 and 2026, which have been inspected before. Improves Nationals ordering; 2026 all-tournament NMAE slightly worsens. Contextual odds and the 5% floor were not optimized. |
| Overall learning rate `baseK=90` and margin coefficient `0.6` | `scripts/optimize-ratings.js`: individual and combined comparisons; tuning 2022–2024, selection 2025, comparison 2026. K was tested in pre-compression units, then rescaled consistently. |
| Overall carryover `1.0` | Compared against `0.93` and `0.98` in the corrected-rank optimizer, in addition to earlier manual comparisons. Not an exhaustive continuous search. |
| Satellite weight `0.75` | Overall comparisons against `0.4`, `0.6`, `0.9`; retained baseline. No separate event-model optimization. |
| Overall uncertainty-factor bounds `[0.5, 0.7]` | Several alternative bound pairs tested; retained baseline. This does not validate the separate uncertainty initialization, floor, ceiling, or growth constants. |
| Event likelihood strength `2350`, shared tournament noise `400`, annual process noise `400` | Sparse joint candidate search in `scripts/tune-tournament-posterior.js` on Disease Detectives, Codebusters, and Machines through 2024. Only 23,129 scored appearances in 2022–2024, not the whole event archive. The selected candidate was slightly worse on training MAE than the best candidate but more conservative about one tournament. These are partially calibrated, not globally optimized. |
| Event carryover `0.70` | Previously a heuristic change from `0.85`, not an optimized value. `scripts/test-event-carryover.js` now compares `0`, `0.30`, `0.50`, `0.70`, `0.85`, `0.95`, `1.0` across all events, holding the rest of the current event model fixed. See `output/event_carryover_study.json`. |

The original overall experiment is recorded in `output/optimization_report.json`;
the narrower event experiment in `output/posterior_tuning.json`. Neither establishes
that shared settings are optimal for both engines.

## Not independently optimized for predictive accuracy

| Settings | Current values (overall / event where different) |
| --- | --- |
| Overall secondary-lineup context | Prior `5%`, minimum applied weight `5%`, minimum history `3`; nearby appearance within `2` past days or same day odds `32×`, coverage below `85%` odds `4×`, unusually few squads odds `2.5×` using past five appearances, autumn odds `1.5×`. These are heuristic context assumptions, not empirical roster-probability calibration. |
| Initial uncertainty | `168.75 / 300` |
| Minimum uncertainty | `19.6875 / 35` |
| Maximum uncertainty | `196.875 / 350` |
| Seasonal uncertainty increment | `56.25 / 140` |
| Overall inactivity uncertainty | `25.3125` (event inactivity was in the limited search above) |
| Effective-game rule | `min(12, 1 + log2(opponent evidence))`; neither cap nor functional form systematically tuned |
| Overall minimum participation coverage | `0.75`; coverage-squared weighting also heuristic |
| Same-day field-selection temperature and minimum raw weight | `112.5`, `0.2`; squared-information budget is a modeling assumption |
| Top-heavy field selection | Top `25%`, minimum `3`, maximum `10`, strength weight `0.70` |
| Field-quality bounds | `[0.8, 1.3]` |
| Field-quality rating divisor | `1687.5 / 3000` |
| Established-field quality weight | `0.1`; appearance threshold also not calibrated |
| Hybrid weight | `0.8` |
| Tournament-level weights | Nationals `1.20`, states `1.05`, invitationals `1.0`, regionals `0.90`, fallback `0.95` |
| Score-margin multiplier ceiling | `1.75` (the log-strength coefficient was tested) |
| Information-weight bounds | `[0.35, 1.35] / [0.30, 1.35]` |

These values have structural motivations, but structural reasoning and regression
tests are not empirical calibration. Some exact overall numbers are scaled versions
of earlier round-number assumptions, not evidence of fine-grained optimization.

Implementation caveat: both engines currently pass the field-quality clamp
arguments in the wrong order. The nominal lower field-quality bound is therefore
not enforced (the upper bound still is). The carryover experiment intentionally
leaves this unchanged to isolate carryover. Fixing it would require rerunning the
relevant comparisons, not assuming the configured bounds describe actual behavior.

## Conventions rather than independent predictive parameters

The rating origin `1500` and a consistent global change of rating units are
conventions. Moving the origin or rescaling *all* rating-dimensional quantities
does not improve predictions. Overall divisor `225` comes from a consistent scale
conversion; event divisor `400` fixes its units. Changing a divisor while holding
the other dimensional constants fixed is a different model and would need testing.
Numerical solver tolerances and the diagnostic performance-rating calculation
also should not be confused with parameters controlling learned strength.

## Recommended next calibration

1. Jointly test event carryover, seasonal uncertainty, annual process noise,
   and tournament noise: they interact, so a one-dimensional winner is conditional.
2. Test initial uncertainty and the uncertainty floor: these control how quickly
   sparse and established event ratings adapt.
3. Test field-quality and same-day reliability choices, with format and tournament
   level ablations. They currently encode substantial unvalidated assumptions.

Use chronological pre-tournament predictions, school-level average ranks for ties,
and both pooled and subgroup results. Track first returning appearance, long-gap
returns, sparse histories, and rating stability alongside overall error. Select
on earlier seasons and reserve genuinely new results for prospective validation.
