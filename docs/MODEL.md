# SO Rating v2 model card

This file describes `so-rating-v2.3`. The implementation in
`src/ratings/model.js` is authoritative; constants are versioned in
`config/model_v2.json`.

## Genuine Elo-scale ratings

SO Rating is the value used directly in expected-score calculations. There is
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
with a 200-point field-strength temperature, have a 0.2 floor, and are normalized
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

## Rating update

For school `i` and opponent `j`, expected score uses the standard Elo logistic:

```text
E(i,j) = 1 / (1 + 10 ^ ((Rj - Ri) / 400))
```

Actual pairwise scores are 1 for finishing ahead, 0.5 for an overall-rank tie,
and 0 for finishing behind. Each pairwise residual is multiplied by a bounded
score-margin factor:

```text
margin multiplier = min(1.75, 1 + 0.30 * ln(1 + point margin / scored events))
```

Normalizing by the number of scored events makes margins comparable across
short and full schedules. Missing point totals use multiplier 1. The update is:

```text
delta = baseK * effectiveGames * informationWeight * uncertaintyFactor
        * coverage² * lineupReliabilityWeight
        * mean(marginMultiplier * (actual - expected))
```

There is no hard delta cap. The uncertainty factor is constrained to `[0.5,
0.7]`, so provisional programs move more than established ones without allowing
uncertainty alone to dominate. Field quality and the tournament-level prior are
bounded independently.

## Uncertainty and seasons

Uncertainty grows with inactivity and shrinks with new evidence, subject to
configured floors and ceilings. At every missed season boundary, distance from
1500 is multiplied by 0.93 and transition variance is added. The 0.93 carryover
was selected from the tested candidates because it produced the lowest
chronological 2022–2026 normalized-rank error; it remains a parameter to revisit
with a formal train/validation split.

## Performance rating

The performance rating is the Elo value whose mean expected score against the
entering opponent field equals the school's actual normalized pairwise score.
Perfect and winless finishes are clamped to 0.99 and 0.01 for a finite result.

## Event ratings

`so-event-v1.4` maintains an independent rating and uncertainty for every
school/canonical-event pair on the same genuine Elo scale as the overall model.
For each school and event, the best valid placing may come from any of the
school's non-exhibition squads; different events may therefore select different
squads. Unknown, missing, exempt, disqualified, trial, and trialed results are
not evidence. A known event result does not require 75% overall-team coverage.

Within an event, each selected school result receives pairwise win/loss/tie
scores from its official event placing against the other eligible schools.
Updates use the same tournament level, format prior, top-heavy field principle,
and same-day lineup allocation as the overall model. Overall tournament point
margins do not enter event ratings.

Event uncertainty starts at 300, has the same 35-point floor as the overall
model, and grows by 70 points of variance per inactive year. Division C event
ratings retain 70% of their distance from 1500 at each season boundary. After a
five-season gap, only 16.8% of the earlier rating advantage remains. This is much
more aggressive than the 93% overall-program carryover because an event depends
on only a few students, while overall strength is a composite of roughly 23
events. Event partners, specialists, rules, and topics also change quickly, and
a four-year gap generally turns over the entire student roster. Event histories
include entering rating, uncertainty, selected event squad, expected and actual
performance, performance rating, information weight, delta, and resulting
state.

The event K-factor is 235 rather than the overall model's 110 because event
ratings do not use the overall-score margin multiplier. This produces a similar
public rating spread while leaving the expected-score divisor at the same genuine
400-point Elo scale.

## Current validation and limitations

Compared with v1, v2.3 reduces chronological 2022–2026 normalized-rank MAE from
approximately 0.409 to 0.274. Among satellite priors tested from 0.60 through
0.80, 0.75 preserves the intended national rating scale while outperforming the
more aggressive discounts. This was a comparative chronological check, not a
final independent calibration study.

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
