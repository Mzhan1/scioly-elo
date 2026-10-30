# Event carryover comparison

Reproduction: `node scripts/test-event-carryover.js <results-directory>`.
Raw results and complete fixed configuration: `output/event_carryover_study.json`.
Archive commit: `eef1132e3626c659590cbddee82e3608b64aab0e`.

Seven fresh chronological replays cover 2,788 Division C tournaments through
2026, with 1,138,949 historical event updates per replay. Evaluation covers
449,666 school-event appearances in 2022–2026. All earlier history initializes
the model. Only event carryover changes; overall-derived same-day evidence
weights are fixed. The production carryover remains 70%.

Primary metric: unweighted expected versus actual school-event finishing rank,
normalized by eligible field size minus one. Ties receive average ranks.
Expectations use entering ratings, not updated ratings. This corrects the
weighted-rank/tie mismatch in the existing event snapshot rank fields. The raw
report also records the distinct evidence-weighted pairwise-performance MAE;
that secondary metric gives the same ordering on the tuning seasons.

| Carryover | 2022–2024 tuning NMAE | 2025 NMAE | 2026 NMAE |
| --- | ---: | ---: | ---: |
| 0% | 0.22659 | 0.22255 | 0.21973 |
| 30% | 0.21661 | 0.21054 | 0.20993 |
| 50% | 0.21113 | 0.20455 | 0.20440 |
| 70% (current) | 0.20613 | 0.19991 | 0.19877 |
| 85% | 0.20253 | 0.19651 | 0.19421 |
| 95% | 0.20104 | 0.19467 | 0.19215 |
| 100% | 0.20119 | 0.19448 | 0.19203 |

95% is selected using only the prespecified 2022–2024 metric. 100% narrowly
wins the later-season comparison, but those differences are small and do not
establish a unique optimum. Later seasons have already been inspected during
prior model development, so these are not pristine holdouts.

Relative to 70%, 95% lowers 2026 NMAE by 3.33%; pooled 2022–2026 NMAE falls from
0.202947 to 0.197447 (2.71%). Always predicting the middle yields about 0.265.

Subgroup results, pooled 2022–2026:

| Subgroup | Appearances | 70% | 85% | 95% | 100% |
| --- | ---: | ---: | ---: | ---: | ---: |
| First competition date of a returning school-event in each season | 149,718 | 0.22010 | 0.21590 | 0.21590 | 0.21792 |
| Above, after at least one missing season | 49,078 | 0.24658 | 0.23849 | 0.23874 | 0.24364 |
| Machines, 2026 | 4,675 | 0.21499 | 0.20942 | 0.20711 | 0.20734 |

All tournaments on a school's first date count in the first-appearance subgroup.
A missing season can reflect event rotation, school absence, or archive gaps;
it does not prove roster continuity or turnover. These subgroups favor retaining
substantial history, but also show why 100% is not uniformly preferable.

Stability tradeoff: the largest absolute individual tournament update over all
history grows from 578.7 at 70% to 789.7 at 95% and 867.6 at 100%. These are not
artificially clipped updates, and no candidate here restores the old >1000 jumps.
The experiment does not establish that higher carryover is optimal jointly with
different tournament noise, seasonal variance, or process variance.

Recommendation: 95% is the defensible provisional choice from this grid, rather
than claiming 70% was optimized or declaring 100% universally best. Jointly test
carryover and uncertainty/noise settings next. No production parameter or ranking
export was changed by this study. A research-only switch skips diagnostic
performance-rating calculations; an equivalence test verifies identical updates,
predictions, and states with that switch off or on. All 43 tests pass.
