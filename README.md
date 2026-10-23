# SciOly Rating Engine

An auditable, uncertainty-aware school-program rating pipeline built on the official SciolyFF interpreter and the Duosmium results archive.

This project rates **Division C only**. Division B tournaments are excluded at
ingestion and cannot affect overall or event-specific ratings.

## What is implemented

- exact SciolyFF scoring and overall team ranks via pinned `sciolyff@0.20.1`
- normalized tournament, team, event, and placing records
- exactly one representative per school/tournament, selected by overall rank
- strongest-overall-team school ratings and best-squad-per-event evidence
- chronological, simultaneous tournament updates (no future or same-event leakage)
- uncertainty, inactivity growth, season regression, field-derived weighting,
  capped tournament information, and tournament performance ratings
- reduced online/satellite evidence and same-day split-squad safeguards
- top-heavy field quality and bounded total-score margin adjustments
- best-squad-per-event ratings with separate uncertainty and season carryover
- a calibrated rating scale used directly for expected-score calculations
- deterministic national rankings and complete rating-history CSV exports

Lower squads remain in normalized tournament data but cannot enter the rating
field. Unknown event results remain stored and are excluded from event evidence.

## Run

Requires Node.js 24 or newer.

```sh
pnpm install
git clone --depth 1 https://github.com/Duosmium/duosmium.git data/duosmium
pnpm validate -- data/duosmium/data/results
pnpm rebuild -- data/duosmium/data/results output
pnpm test
```

Generated files:

- `output/national_rankings.csv`
- `output/all_program_states.csv`
- `output/rating_history.csv`
- `output/ranking_audit.csv`
- `output/rebuild_report.json`
- `output/event_rankings.csv`
- `output/all_event_states.csv`
- `output/event_rating_history.csv`

## Web dashboard

The included analytics site turns the generated CSV files into a searchable,
interactive Division C rating dashboard.

```sh
pnpm web:data   # rebuild web/data/ratings.json from output/*.csv
pnpm web        # open http://127.0.0.1:4173
```

The dashboard supports school search, four-school comparison, one-to-five-year
chart ranges, current and historical rating context, recent tournament results,
and CSV export. Running `pnpm web` automatically builds the browser dataset if
it is missing.

`national_rankings.csv` contains Division C programs that competed in the
archive's latest season. `all_program_states.csv` retains the final state of
every historical Division C program.

Model constants live in `config/model_v2.json`. Change the `modelVersion` when
changing formulas or parameters, then recompute from raw tournament data.

To reproduce the latest completed-season optimization, run
`node scripts/optimize-ratings.js <results-dir>` followed by
`node scripts/verify-optimization.js <results-dir>`. Both use the frozen v2.5
benchmark and the corrected school-rank metric. A rebuild can optionally end at
a specified season: `node scripts/rebuild-ratings.js <results-dir> output 2026`.

## Identity note

The current deterministic program key is canonical school name + city + state +
division. This prevents same-named schools from merging. A later ingestion phase
can replace it with a Duosmium canonical school identifier/alias table without
changing the rating engine.
