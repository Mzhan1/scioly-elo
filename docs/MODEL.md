# SO Rating v2 model card

This file describes `so-rating-v2.8`. The implementation in
`src/ratings/model.js` is authoritative; constants are versioned in
`config/model_v2.json`.

## Rating units and predictions

SO Rating is the value used directly in expected-score calculations. Overall
ratings use a 225-point logistic divisor; event ratings retain their 400-point
divisor. These scales have different probability meanings: a 225-point overall
advantage implies a 10:1 expected pairwise win ratio. There is
no display multiplier, latent display scale, or fixed tournament-change cap. A
2800 team facing a 1500 field is treated as an overwhelming favorite, so
repeated weak-field wins provide almost no additional rating. Tournament volume
cannot function as a substitute for tournament quality.

## Evidence and chronology

Tournaments are ordered by awards/end/start date, then division and source ID.
Every school's pre-tournament value is frozen before any school is updated, so
one tournament cannot leak into another participant's entering rating.

Only the best overall-ranked entry for each school is admitted. Exhibition and
disqualified representatives are retained in normalized data but not rated.
Each team's actual and expected result is the average of its implied pairwise
scores against all other school representatives.

A registration with zero known event participation is not rating evidence.
Entries below 75% official-event coverage are retained but not rated because
they do not represent a sufficiently complete school team. Entries from 75% to
100% coverage receive `coverage²` weight. The same weight applies when another
school is credited for beating that entry. This prevents no-shows and fragmented
satellite rosters from behaving like full-team losses.

The archive's tournament location supplies a separate format prior. Traditional
in-person tournaments receive weight 1.0, hybrid tournaments 0.8, and online or
satellite tournaments 0.75. The lower satellite weight reflects weaker lineup
assurance and competition integrity without attempting to identify cheating by
particular teams from standings alone.

When a school appears in multiple tournaments on the same date, lineup evidence
is allocated toward the stronger entering field. Raw weights decay exponentially
with a 112.5-point field-strength temperature, have a 0.2 floor, and are normalized
to one squared-information budget. Equal fields therefore still receive
`1 / sqrt(number of tournaments)` each, while a clearly stronger field approaches
weight 1. All results on that date use the same entering rating and are committed
together. The allocation never uses the school's resulting performance.

Field strength is top-heavy: 70% comes from the strongest quarter of the field
(between three and ten teams) and 30% from the full-field mean. Both components
use entering ratings and evidence weights. Adding a strong contender therefore
raises tournament quality much more than adding a weak team lowers it.

Tournament evidence is converted to an effective-game count:

```text
effective games = min(12, 1 + log2(field size - 1))
```

This lets a deep tournament carry more information than a dual while preventing
the raw pair count of a huge tournament from creating quadratic influence.

## Invitational lineup reliability

Overall ratings estimate whether an invitational appearance represents the
school's full strength. The estimate compares the entering rating with the
field-adjusted performance rating from that appearance. It uses a two-component
Gaussian model: full-strength performance deficits have mean 0, secondary-lineup
deficits have mean 350, and both have standard deviation 210 plus the school's
entering uncertainty in quadrature. The secondary-lineup prior starts at 5%.

Prior odds increase for another appearance in the previous two days or on the
same date (32×), coverage below 85% (4×), one squad when the median of the last
five appearances was at least two (2.5×), and September–November (1.5×). Only
earlier appearances and the known same-day field are consulted; a subsequent
appearance cannot change an earlier assessment. These contextual multipliers
are assumptions inspired by the Scio.ly methodology, not independently
calibrated probabilities for our archive.

The posterior full-strength probability weights the overall evidence, with a
5% floor on the applied weight so repeated poor performances still affect the
rating. Wins and performances above the entering expectation receive weight 1.
Schools need at least three earlier appearances before classification. States,
regionals, nationals, and other tournament levels retain weight 1 regardless
of the result. The detector never changes the official finish or removes the
appearance from history.

Every school is assessed against the same frozen field before any posterior
weights are applied. A likely secondary appearance contributes less both to
its school's update and to opponents' evidence; its low weight also reduces
uncertainty shrinkage. When total opponent evidence is below one full result,
an additional opponent-support factor prevents relative normalization in a
dual from restoring full credit. Pre-result expected ranks and performance
diagnostics are frozen before these outcome-dependent weights. Separate
`learningExpectedPerformance` and `learningActualPerformance` fields record
the weighted update inputs.

This detector applies to overall school ratings, not directly to best-squad
event evidence: a weak overall lineup can still include a strong event squad.
Event same-day allocation continues to use the overall entering field ratings.
CSV histories export the posterior probability, applied weight, contextual
prior, performance deficit, squad count, and assessment reason. The dashboard
marks appearances counted below 50% as possible secondary lineups and shows
the applied percentage. The estimate is not a verified roster label.

Nine noise/secondary-deficit settings were compared on 2022–2024. Among
settings improving all-tournament NMAE, the highest mean Nationals Spearman
selected noise 210 and deficit 350. With that choice fixed, 2026 Nationals
Spearman improves from 0.946113 to 0.956984 and actual-top-25 correlation from
0.654615 to 0.795385. Across 2015–2026, correlations improve from 0.934020 to
0.941638 and from 0.710140 to 0.773217. The 2026 all-tournament NMAE slightly
worsens, from 0.124468 to 0.124913. These are retrospective comparisons on
previously inspected years, not pristine holdouts. No blanket halving of losses
is included. Version 2.8 adds the separate Nationals prediction layer below.

Reproduce with `node scripts/test-lineup-model.js <results-dir>`; the frozen
baseline is `config/model_v2.6.json` and results are recorded in
`output/lineup_model_study.json`.

## Earlier-Nationals adjustment

Version 2.8 adds a conditional Nationals rating alongside the General rating.
It does not alter general Elo learning, lineup inference, opponent strengths,
uncertainty, or event ratings. The dashboard's General / Nationals switch applies
to ratings, ranks, school comparisons, history, and CSV downloads.

For each completed earlier Nationals, the school's unweighted finishing rank
among school representatives is converted into a field-adjusted performance
rating using the entering General ratings and the overall divisor of 225.
Perfect and winless performances use finite targets of 0.99 and 0.01. The
residual is that performance rating minus the school's entering General rating.
If the finite tail target would reverse the sign of observed over- or
underperformance, the residual is zero instead. Numerical tail handling cannot
reward a last-place finish as overperformance or penalize a perfect win.
The conditional prediction is:

```text
Nationals adjustment = sum(earlier Nationals residuals) / (earlier appearances + 5)
Nationals rating = General rating + Nationals adjustment
```

The strength is fixed at 1 and shrinkage is fixed at five pseudo-appearances,
matching the earlier diagnostic. A school with no prior Nationals has adjustment
zero. An unused registration supplies no residual evidence. Schools below the
overall participation threshold can still have known Nationals results; they
remain in the conditional forecast field and their known participation supplies
history even when their incomplete team is excluded from general Elo updates.

Forecasts use only records strictly before the predicted tournament date.
All forecasts on the same date use the same entering history; residuals are
committed after the whole date batch. The current result cannot adjust its own
forecast. Post-tournament chart points and current rankings include completed
results for predicting the next Nationals. Historical forecasts are exported
separately, so post-result charts cannot be confused with pre-result predictions.
Known incomplete Nationals appearances that supply only adjustment evidence are
marked "Nationals adjustment only" and appear only in the Nationals chart/history.

The adjustment is based on overall school performance; no per-event Nationals
specialty adjustment is inferred. It has no separate calibrated uncertainty or
qualification probability. It retains all earlier Nationals, so a coaching or
program change can make old residuals less representative. These are conditional
rankings of all active programs, not a projection of the qualified Nationals field.

`output/nationals_rankings.csv` contains current conditional ranks and ratings;
`output/nationals_prediction_history.csv` contains the entering General rating,
prior adjustment and appearance count, expected ranks, actual rank and residual
for every historical Nationals field. `rebuild_report.json` compares General and
Nationals correlations on identical fields. The frozen pre-adjustment baseline
is `config/model_v2.7.json`. This is a retrospective experiment on previously
inspected seasons, not a prospective validation claim.

## Rating update

Before the overall update, v2.7 estimates invitational lineup reliability as
described below. This weighting does not change the pre-tournament prediction.

For school `i` and opponent `j`, expected overall score uses:

```text
E(i,j) = 1 / (1 + 10 ^ ((Rj - Ri) / 225))
```

Actual pairwise scores are 1 for finishing ahead, 0.5 for an overall-rank tie,
and 0 for finishing behind. Each pairwise residual is multiplied by a bounded
score-margin factor:

```text
margin multiplier = min(1.75, 1 + 0.60 * ln(1 + point margin / scored events))
```

Normalizing by the number of scored events makes margins comparable across
short and full schedules. Missing point totals use multiplier 1. The update is:

```text
delta = baseK * effectiveGames * informationWeight * uncertaintyFactor
        * coverage² * lineupReliabilityWeight
        * fullStrengthWeight * opponentEvidenceFactor
        * mean(marginMultiplier * (actual - expected))
```

There is no hard delta cap. The uncertainty factor is constrained to `[0.5,
0.7]`, so provisional programs move more than established ones without allowing
uncertainty alone to dominate. Field quality and the tournament-level prior are
bounded independently.

## Uncertainty and seasons

Uncertainty grows with inactivity and shrinks with new evidence, subject to
configured floors and ceilings. Overall ratings retain 100% of their value
across season boundaries. Transition variance is still added, allowing fresh
evidence to correct a changed roster. Optimization doubles the learning rate
from K=60 to K=120 in v2.5 units and increases the score-margin coefficient from
0.30 to 0.60 while keeping its 1.75 cap. The optimized rating units are then
compressed by a fixed factor of 0.75 around 1500, yielding K=90 and divisor=225.
Uncertainty bounds and growth, field-quality divisor, and same-day temperature
are scaled by the same factor. This last step preserves the optimized model's
predictions and learning dynamics while producing smaller numerical gaps.

## Performance rating

The performance rating is the Elo value whose mean expected score against the
entering opponent field equals the school's actual normalized pairwise score.
Perfect and winless finishes are clamped to 0.99 and 0.01 for a finite result.

## Event ratings

`so-event-v1.6` maintains an independent rating and uncertainty for every
school/canonical-event pair using its own 400-point expectation divisor.
For each school and event, the best valid placing may come from any of the
school's non-exhibition squads; different events may therefore select different
squads. Unknown, missing, exempt, disqualified, trial, and trialed results are
not evidence. A known event result does not require 75% overall-team coverage.

Within an event, each selected school result receives pairwise win/loss/tie
scores from its official event placing against the other eligible schools.
Updates use the same tournament level, format prior, top-heavy field principle,
and same-day lineup allocation as the overall model. Overall tournament point
margins do not enter event ratings.

Event uncertainty starts at 300 and has a 35-point floor. Inactivity adds
`elapsed years * 400^2` to variance, so process variance is additive over time.
The previous square-of-elapsed-time rule severely understated change across
short gaps. Division C event
ratings retain 70% of their distance from 1500 at each season boundary. After a
five-season gap, only 16.8% of the earlier rating advantage remains. This is much
more aggressive than the 100% overall-program carryover because an event depends
on only a few students, while overall strength is a composite of roughly 23
events. Event partners, specialists, rules, and topics also change quickly, and
a four-year gap generally turns over the entire student roster. Event histories
include entering rating, uncertainty, selected event squad, expected and actual
performance, performance rating, information weight, delta, and resulting
state.

Each event tournament measures one noisy performance shared across all of that
school's implied pairwise outcomes. A large field helps estimate that day's
performance; it is not equivalent to several independent demonstrations of
the school's lasting ability. The event update therefore uses a Gaussian
strength prior, a shared tournament-performance deviation (standard deviation
400), and a normalized Bradley-Terry composite likelihood. Its mode is solved
iteratively using the updated expected scores, rather than extrapolating from
one pre-result residual. Gaussian/Laplace conditioning transfers only the
supported part of the performance shift into the school rating:

```text
performance prior variance V = school variance + tournament variance
new rating = old rating + school variance / V * (fitted performance - old rating)
```

Uncertainty comes from the curvature of the same likelihood, with residual
uncertainty for a performance shared by all comparisons. Event updates no
longer force a certain school to use half the maximum learning rate. Same-day
event updates combine approximate Gaussian likelihood messages against the
shared school prior once, rather than summing several posterior changes.
There is no maximum allowed rating change. The helper's tests explicitly
permit movements above 1200 with a sufficiently uncertain prior and strong
evidence; the repair targets unjustified certainty and numerical overshoot.

Event `baseK=2350` now calibrates likelihood strength, not a direct Elo step:
the likelihood power is `baseK / (q * initialUncertainty^2)` times effective
games, format/field weight, and lineup evidence, with `q=ln(10)/400`.
Noise and likelihood settings were compared on 2022–2024 Disease Detectives,
Codebusters, and Machines evidence. The selected shared-noise calibration
stays within 0.0004 MAE of the best training result while taking a more
conservative view of what one tournament establishes. Opponent ratings remain
point estimates; this is a regularized composite likelihood with a Laplace
approximation, not a full Bayesian ranking model.

The event expected-score divisor remains 400.
Overall K is 90 in the compressed units. Overall and event rating numbers are
not interchangeable probability scales.

The overall base update/calibration is v2.6, with lineup weighting added in v2.7. A trial applying the posterior
method to overall ratings worsened overall prediction error and was not kept.
Reproduce the event comparison with
`RATING_CHECK_EVENTS='*' node scripts/check-tournament-updates.js <results-dir>`.
`output/tournament_update_check.json` records the old/new error and large-update
counts, including Littleton's complete 2025/2026 update inputs.
On all 1,138,949 historical event updates through 2026, movements above 1000
fall from 424 to zero and the maximum absolute movement falls from 1426.8 to
578.7. Among the 449,666 event predictions from 2022 onward, pairwise-performance
MAE improves from 0.206318 to 0.203135, including improvements in every season.
Littleton's Disease Detectives 2025 update changes from -726.3 to -187.8;
its 2026 update changes from +1195.4 to +427.0. These comparisons use a full
chronological rebuild, not the old rating history with its deltas clipped.

## Current validation and limitations

Corrected overall evaluation compares unweighted expected finishing ranks with
average ranks among the same eligible school representatives. Squad placements
are not compared directly with school field sizes. Always predicting the middle
has NMAE approximately 0.267; finite fields yield a baseline somewhat above 0.25.

The October 23 optimization tunes 20 configurations on 2022–2024, evaluates the
three finalists on 2025, and locks the winner before evaluating 2026. Results:

| Seasons | v2.5 NMAE | v2.6 NMAE |
| --- | ---: | ---: |
| 2022–2024 (tuning) | 0.13701 | 0.13176 |
| 2025 (selection) | 0.13117 | 0.12458 |
| 2026 (locked comparison) | 0.13122 | 0.12447 |
| 2022–2026 combined | 0.13430 | 0.12839 |

The combined comparison covers 18,027 appearances on the same archive for both
models; adding archive results can change these numbers. The improvement is
4.4% overall and 5.1% on 2026, with lower error in every individual season.
The 2026 paired date-block bootstrap (2,000 samples, 50 tournament dates) gives
an error-difference interval of [-0.00868, -0.00475]. This is descriptive sampling
variability, not a selection-adjusted guarantee of future performance. Prior
experiments have seen these seasons; future results remain the strongest test.
Every prediction uses only earlier results, including during evaluation seasons.

Compression preserves optimized expected ranks within 1e-12. The resulting
current field has one school above 2700 and 18 above 2500, with Troy near 2809.
These units are fixed; they are not a cap or a dynamic percentile mapping, and
there is no mathematical upper bound on future ratings.

Reproduce the search using `node scripts/optimize-ratings.js <results-dir>`,
then `node scripts/verify-optimization.js <results-dir>` with the same archive.
`output/optimization_report.json` includes configurations, archive commit,
season metrics, scale checks, and the bootstrap. The frozen v2.5 benchmark
is `config/model_v2.5.json`.
For a completed-season rebuild matching this comparison, run
`node scripts/rebuild-ratings.js <results-dir> output 2026`.

The event v1.3 chronological 2022–2026 normalized-rank MAE was approximately
0.205 across 711,841 snapshots. Its higher K-factor trades about 0.002 rank MAE
against the more compressed v1.1 scale in order to align established national
event leaders with the overall model's roughly 2750–3000 rating range. Event
v1.4 changes annual carryover from 85% to 70%; its metrics are regenerated with
the next complete archive rebuild.

- School identity still uses canonical name + city + state + division. A stable
  Duosmium identifier/alias table remains important.
- Tournament field weighting and season carryover need formal train/validation
  backtesting rather than continued tuning against the current leaderboard.
- Exact-name recurrence is supported; configurable relationships between renamed
  or related event families are not yet modeled.

### Event carryover evidence update

The all-event seven-value carryover study is documented in
`docs/EVENT_CARRYOVER_STUDY.md` and `output/event_carryover_study.json`.
70% was originally heuristic: 95% now wins the 2022–2024 tuning comparison,
while 100% narrowly wins on 2025 and 2026. The production configuration remains
70% pending a separate adoption decision. This one-dimensional comparison does
not jointly optimize uncertainty/noise settings. `docs/PARAMETER_AUDIT.md`
distinguishes tested settings from remaining assumptions and records an existing
field-quality lower-bound implementation caveat left unchanged by the experiment.
