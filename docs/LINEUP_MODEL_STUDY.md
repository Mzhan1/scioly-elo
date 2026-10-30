# Invitational lineup model study

Completed October 30, 2026. Adopted as `so-rating-v2.7` for overall school ratings.

The model estimates whether an unexpectedly poor invitational appearance reflects full program strength. It combines a Gaussian full-strength/secondary-lineup performance model with earlier lineup context. It applies a variable evidence weight to both the school and its influence on opponents. The applied weight has a 5% floor. Championships, first appearances, and performances meeting or exceeding expectation remain fully counted. No Nationals-specific correction or blanket loss reduction is applied.

## Selection and limits

Retrospective chronological replays. Fixed 3x3 grid. Select maximum mean 2022-2024 Nationals Spearman among candidates that also improve 2022-2024 all-tournament NMAE; inspect 2025 and 2026 without reselection. Previously inspected years are not pristine holdouts. No Nationals-specific correction is added.

Noise values 140, 175, 210 were crossed with secondary deficits 250, 350, 450. The selected setting is noise 210, deficit 350. The prior and contextual multipliers were inspired by the linked Scio.ly methodology and remain heuristic; the reported probability is not calibrated against confirmed roster labels. A genuinely weak full-strength appearance can be discounted.

Archive: `eef1132e3626c659590cbddee82e3608b64aab0e`. The frozen baseline configuration is `config/model_v2.6.json`.

## Results

| Period | Baseline all-team rho | New all-team rho | Baseline top-25 rho | New top-25 rho |
| --- | ---: | ---: | ---: | ---: |
| 2015–2021 | 0.939755 | 0.942934 | 0.767692 | 0.790513 |
| 2022–2024 (selection) | 0.918366 | 0.932240 | 0.638718 | 0.742821 |
| 2025 | 0.934482 | 0.946707 | 0.634615 | 0.738462 |
| 2026 | 0.946113 | 0.956984 | 0.654615 | 0.795385 |
| 2015–2026 | 0.934020 | 0.941638 | 0.710140 | 0.773217 |

The 2015–2026 blanket-half-loss benchmark is 0.944043 overall and 0.765385 within the actual top 25. The targeted model is slightly weaker overall across all years but stronger within the top 25.

All-tournament normalized rank MAE in 2026 changes from 0.124468 to 0.124913 (lower is better). Pooled 2022–2026 MAE is 0.128510 versus baseline 0.128386. Thus the Nationals improvement comes with a small general-prediction tradeoff.

## Monta Vista example

| 2026-season appearance | Applied weight | Rating change |
| --- | ---: | ---: |
| 2025-10-11_georgia_scrimmage_c | 5.7% | -6.4 |
| 2025-10-19_whale_invitational_c | 22.0% | -10.8 |
| 2025-11-01_rickards_invitational_c | 100.0% | +4.3 |
| 2025-12-13_gullso_invitational_c | 89.7% | -47.2 |
| 2026-01-17_usc_invitational_c | 100.0% | +12.5 |
| 2026-01-24_aggie_invitational_c | 5.0% | -1.4 |
| 2026-01-24_mit_invitational_c | 100.0% | +31.4 |
| 2026-01-31_golden_gate_invitational_c | 100.0% | +2.4 |
| 2026-01-20_official_california_invitational_c | 16.0% | -18.9 |
| 2026-02-21_triton_invitational_c | 29.3% | -63.6 |
| 2026-03-21_nCA_santa_clara_regional_c | 100.0% | +1.0 |
| 2026-04-04_nCA_states_c | 100.0% | +19.2 |
| 2026-05-22_nationals_c | 100.0% | +93.2 |

Monta Vista rises from predicted 17th to fifth entering 2026 Nationals; it actually wins. This remains a miss, rather than evidence that the model recovers the exact best roster.

## Verification and reproduction

The complete rebuild contains 2,788 tournaments and 48,061 overall appearances, with no parse errors. Invariants across all exported appearances verify probability/weight bounds, full championship weighting, full weighting when actual performance meets expectation, and finite ratings. The test suite covers conservative treatment of uncertainty and sparse histories, opponent credit in a dual, no future-appearance leakage, processing-order independence, and the perfect-win performance-clamp edge case. Dashboard histories and exports include applied weights; visual browser verification was blocked by declined browser access.

```sh
node scripts/test-lineup-model.js <archive>/data/results
node scripts/rebuild-ratings.js <archive>/data/results output 2026
node scripts/build-web-data.js
node --test test/*.test.js
```

Detailed candidate metrics and examples are in `output/lineup_model_study.json`. The detector is in `src/ratings/lineup.js`; integration and frozen prediction diagnostics are in `src/ratings/model.js`.

Context inspiration: [Scio.ly methodology](https://gist.github.com/Kudostoy0u/270e25077b9df1da35b0a4b373ab3c21). This implements a related approach on our own rating scale, rather than reproducing their model.
