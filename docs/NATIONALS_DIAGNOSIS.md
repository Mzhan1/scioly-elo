# Nationals prediction diagnosis

Retrospective diagnosis completed October 29, 2026. Production ratings and configuration were not changed.

## Method and verification

Archive commit: `eef1132e3626c659590cbddee82e3608b64aab0e`. Replayed 26 fixed diagnostic variants chronologically through 2026; each tournament uses entering ratings only. Each variant changes one setting or update rule unless explicitly labeled as a combination.

Evaluation uses Division C Nationals in 2015–2026 (11 tournaments; none in 2020). Correlations are averaged equally across tournaments. Top-25 correlation reranks predictions within the actual top 25. Ties receive average ranks. The full non-exhibition field includes schools with insufficient participation for rating updates; those schools are predicted from their earlier state.

The baseline replay exactly reproduces all 651 saved eligible Nationals entering ratings (maximum difference 0.0). The original eligible-field average is 0.934081; expanding the evaluation field changes it to 0.934020. In 2026 the full 59-school figure is 0.946113, versus 0.946526 for the 57 eligible schools. Field exclusion does not explain the gap.

## Main findings

**Poor invitational outcomes exert too much downward influence for forecasting Nationals.** Halving only negative invitational rating changes improves full-field Nationals correlation in 10 of 11 years, including both broad eras. It also improves pooled 2022–2026 normalized finishing-rank MAE across all tournaments from 0.128386 to 0.125356. Suppressing all invitational losses is an intentionally extreme diagnostic; it increases rating levels and can reward volume, so its success is not a justification for deploying it.

**The participation safeguard does not establish full-strength lineup quality.** Monta Vista enters 2026 Nationals predicted 17th and finishes first. At Triton, its selected B squad has 86.96% participation while the A squad has 56.52%; we deduct 186.4 points. Official California costs another 104.5 points and Georgia Scrimmage costs 98.4. Downweighting all updates, wins and losses, from invitational appearances below 95% participation to 25% of their existing size improves Nationals correlation to 0.9420 and moves Monta Vista to fifth. This supports an evidence-quality problem without relying entirely on ignoring bad outcomes. Squad labels alone do not prove which students competed or that a result was a secondary roster.

**Persistent school-specific Nationals differences contain predictive information.** A fixed, shrunk correction from earlier Nationals raises correlation from 0.9340 to 0.9428. Combining it with halved invitational losses reaches 0.9487. These effects overlap and cannot be added as independent contributions.

**Several earlier explanations fail these tests.** Seasonal carryover of 0.90 worsens correlation to 0.9263. Fixing the field-quality clamp changes no Nationals ordering. Removing city from otherwise exact identity keys changes little. Simply summing expected event places from our current event ratings is worse (0.9117); this does not rule out a better event model, but does rule out claiming that event aggregation alone is the missing fix.

## Main comparisons

| Diagnostic | All-team Spearman | Actual-top-25 Spearman |
| --- | ---: | ---: |
| Current model | 0.9340 | 0.7101 |
| Halve invitational losses | 0.9440 | 0.7654 |
| Ignore invitational losses (extreme diagnostic) | 0.9468 | 0.7956 |
| Quarter updates from <95%-coverage invitationals | 0.9420 | 0.7538 |
| 90% annual overall carryover | 0.9263 | 0.6798 |
| Fix field-quality clamp | 0.9340 | 0.7101 |
| Earlier-Nationals correction | 0.9428 | 0.7640 |
| Halved invitational losses + Nationals correction | 0.9487 | 0.8007 |
| Sum current event expected places | 0.9117 | 0.6618 |

The Nationals correction fits each earlier Nationals performance against its entering field using the overall logistic divisor of 225, clamps perfect/winless performance to 0.99/0.01, subtracts the entering rating, and adds the sum of earlier residuals divided by (earlier appearances + 5). The combined experiment recomputes these residuals for the changed model. It is an analogous diagnostic, not a reproduction of Scio.ly’s implementation.

Event aggregation uses strictly earlier event-history states, the production 70% seasonal event carryover, all official events on that Nationals schedule, and 1500 for unseen school/event pairs. Expected event places are summed across the full predicted field. Post-hoc school priors were also tested; neither tested strength exceeded the overall baseline.

## All replay ablations

| Variant | Nationals Spearman | Top-25 Spearman | All-tournament 2022–2026 NMAE |
| --- | ---: | ---: | ---: |
| baseline | 0.934020 | 0.710140 | 0.128386 |
| carry=0.7 | 0.908728 | 0.622308 | 0.149002 |
| carry=0.9 | 0.926307 | 0.679790 | 0.135111 |
| carry=0.98 | 0.932368 | 0.710909 | 0.129508 |
| K=45 | 0.933747 | 0.728252 | 0.132926 |
| K=135 | 0.929043 | 0.682238 | 0.129228 |
| K=180 | 0.922648 | 0.656783 | 0.131295 |
| no-margin | 0.934823 | 0.726503 | 0.131276 |
| equal-formats | 0.929789 | 0.684266 | 0.129077 |
| equal-levels | 0.933831 | 0.706923 | 0.128168 |
| nationals-weight=3.1 | 0.933564 | 0.713776 | 0.128593 |
| correct-field-clamp | 0.934020 | 0.710140 | 0.128386 |
| no-field-quality | 0.934404 | 0.729510 | 0.128702 |
| invitationals-ignore-negative | 0.946779 | 0.795594 | 0.129063 |
| invitationals-negative=0.25 | 0.946461 | 0.791049 | 0.126322 |
| invitationals-negative=0.5 | 0.944043 | 0.765385 | 0.125356 |
| invitationals-negative=0.75 | 0.940581 | 0.744615 | 0.126061 |
| all-levels-ignore-negative | 0.935798 | 0.766224 | 0.138438 |
| invitational-learning=0.5 | 0.938118 | 0.754196 | 0.130047 |
| ignore-negative-incomplete-invitational | 0.942603 | 0.758252 | 0.127009 |
| ignore-negative-satellite-invitational | 0.941548 | 0.761748 | 0.126002 |
| ignore-negative-autumn-invitational | 0.937209 | 0.715874 | 0.126826 |
| ignore-negative-traditional-invitational | 0.942340 | 0.743427 | 0.127851 |
| incomplete-invitational-learning=0.25 | 0.942001 | 0.753776 | 0.127951 |
| satellite-invitational-learning=0.25 | 0.937963 | 0.753706 | 0.129413 |
| identity-without-city | 0.934174 | 0.715594 | 0.128947 |

## Limits and next decision

For halved invitational losses, the paired-year bootstrap interval for the mean correlation improvement is [0.0053, 0.0149] (10,000 resamples). This is descriptive and not corrected for the variants tried. These years were previously inspected and these experiments are retrospective; none is a pristine holdout.

Scio.ly reports 0.949 overall and 0.815 within the top 25 across its Nationals backtest. Our combined diagnostic reaches similar overall correlation on our archive, but we have not reproduced its exact fields, per-year predictions, tuning or implementation. We can identify weaknesses inside our model; we cannot uniquely assign the entire cross-model gap to individual Scio.ly features from the methodology note alone.

The supported development direction is a lineup-aware, robust invitational observation model plus a separately validated Nationals correction. Ignoring losses outright risks inflation and volume bias. Preserve a general rating if a Nationals-specific adjustment hurts other prediction targets; reserve new results for prospective validation.

## Reproduce

With Node.js 24+, Python 3 and the pinned archive available:

```sh
node scripts/diagnose-nationals.js <archive>/data/results
node scripts/rebuild-ratings.js <archive>/data/results <baseline-output> 2026 config/model_v2.6.json
python3 scripts/analyze-nationals.py <baseline-output>
```

Detailed results: `output/nationals_diagnosis.json` and `output/nationals_analysis.json`.
