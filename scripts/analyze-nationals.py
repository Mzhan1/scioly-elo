"""Post-process chronological diagnostic replays; production artifacts are read-only."""
import csv
import json
import math
import statistics
import random
import re
import unicodedata
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
report = json.loads((ROOT / 'output/nationals_diagnosis.json').read_text())
history_dir=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else ROOT/'output'
history_report=json.loads((history_dir/'rebuild_report.json').read_text())
if history_report['modelVersion']!=report['config']['modelVersion']:
    raise SystemExit('This retrospective analysis requires frozen v2.6 histories. '
        'Rebuild into a separate output directory using config/model_v2.6.json as the fifth rebuild argument, '
        'then pass that output directory to analyze-nationals.py.')

def ranks(values):
    order = sorted(range(len(values)), key=values.__getitem__)
    result = [0.] * len(values)
    i = 0
    while i < len(values):
        j = i + 1
        while j < len(values) and values[order[j]] == values[order[i]]:
            j += 1
        for k in range(i, j):
            result[order[k]] = (i + j + 1) / 2
        i = j
    return result

def corr(a, b):
    x, y = ranks(a), ranks(b)
    xm, ym = statistics.mean(x), statistics.mean(y)
    den = math.sqrt(sum((v-xm)**2 for v in x) * sum((v-ym)**2 for v in y))
    return sum((v-xm)*(w-ym) for v, w in zip(x, y)) / den if den else None

def metrics(rows, scores):
    actual = [r['representativeOverallRank'] for r in rows]
    predicted = ranks(scores)
    top = [i for i, a in enumerate(actual) if a <= 25]
    return dict(n=len(rows), spearman=corr(scores, actual),
                top25Spearman=corr([scores[i] for i in top], [actual[i] for i in top]),
                rankMAE=statistics.mean(abs(a-b) for a,b in zip(predicted,actual)),
                top10Hits=sum(p<=10 and a<=10 for p,a in zip(predicted,actual)))

def windows(per_season):
    return {f'{a}-{b}': {k: statistics.mean(r[k] for r in per_season if a<=r['season']<=b)
                        for k in ['spearman','top25Spearman','rankMAE','top10Hits']}
            for a,b in [(2015,2026),(2015,2021),(2022,2024),(2025,2026)]}

fields = defaultdict(list)
for row in report['fullFieldNationals']:
    fields[row['tournamentId']].append(row)
targets = sorted((rows for rows in fields.values() if rows[0]['season']>=2015), key=lambda rows:rows[0]['date'])
results = {'protocol': 'Retrospective diagnostics, not prospective validation. All features use results strictly before the predicted Nationals date. Full non-exhibition school field includes low-participation schools omitted from the rating-update field.',
           'variants': {}, 'eventCoverage': [], 'largestMisses2026': []}

# Nationals performance shift, with earlier Nationals only and fixed shrinkage.
residuals = defaultdict(list)
correction_results = defaultdict(list)
for rows in sorted(fields.values(), key=lambda rows: rows[0]['date']):
    entering = [r['preRating'] for r in rows]
    year = rows[0]['season']
    for strength in [.5, 1, 2]:
        scores = [-(r['preRating']+strength*sum(residuals[r['schoolId']])/(len(residuals[r['schoolId']])+5)) for r in rows]
        if year >= 2015:
            correction_results[f'nationals-residual-strength={strength}'].append(dict(season=year,**metrics(rows,scores)))
    for i, row in enumerate(rows):
        target = max(.01, min(.99, (len(rows)-row['representativeOverallRank'])/(len(rows)-1)))
        opponents = entering[:i]+entering[i+1:]
        low, high = -1000., 6000.
        for _ in range(60):
            mid = (low+high)/2
            expected = statistics.mean(1/(1+10**((other-mid)/225)) for other in opponents)
            if expected < target:
                low = mid
            else:
                high = mid
        residuals[row['schoolId']].append((low+high)/2-row['preRating'])
for name, rows in correction_results.items():
    results['variants'][name] = dict(windows=windows(rows),perSeason=rows)

# Do the two demonstrated effects overlap? Recompute historical residuals for
# each changed model, rather than adding the baseline correction to its ratings.
for candidate in report['candidates']:
    if candidate['name'] not in ['invitationals-ignore-negative','invitationals-negative=0.5']:
        continue
    variant_fields=defaultdict(list)
    for row in candidate.get('nationalsPredictions',[]):
        variant_fields[row['tournamentId']].append(row)
    prior=defaultdict(list)
    scores_by_year=[]
    for rows in sorted(variant_fields.values(),key=lambda rows:rows[0]['date']):
        scores=[-(r['preRating']+sum(prior[r['schoolId']])/(len(prior[r['schoolId']])+5)) for r in rows]
        if rows[0]['season']>=2015:
            scores_by_year.append(dict(season=rows[0]['season'],**metrics(rows,scores)))
        for i,row in enumerate(rows):
            target=max(.01,min(.99,(len(rows)-row['representativeOverallRank'])/(len(rows)-1)))
            others=[r['preRating'] for j,r in enumerate(rows) if j!=i]
            low,high=-1000.,6000.
            for _ in range(60):
                mid=(low+high)/2
                expected=statistics.mean(1/(1+10**((r-mid)/225)) for r in others)
                if expected<target: low=mid
                else: high=mid
            prior[row['schoolId']].append((low+high)/2-row['preRating'])
    if scores_by_year:
        results['variants'][candidate['name']+'+nationals-residual']=dict(windows=windows(scores_by_year),perSeason=scores_by_year)

# Event aggregation: hold all event states immediately BEFORE each Nationals date.
state = {}
index = 0
previous_date = ''
event_results = defaultdict(list)
def event_key(name):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC',name).strip()).lower()

event_schedule = {t['id']: [event_key(e) for e in t['events']] for t in report['nationalsFields']}

def evaluate_events(rows):
    keys = event_schedule[rows[0]['tournamentId']]
    year = rows[0]['season']
    matrix, counts = [], []
    for row in rows:
        values, ns = [], []
        for event in keys:
            old = state.get((row['schoolId'],event))
            if old:
                rating, season, count = old
                values.append(1500 + .7**max(0,year-season)*(rating-1500))
                ns.append(count)
            else:
                values.append(1500)
                ns.append(0)
        matrix.append(values)
        counts.append(ns)
    results['eventCoverage'].append(dict(season=year,schools=len(rows),events=len(keys),
        missingPairs=sum(n==0 for ns in counts for n in ns), totalPairs=len(rows)*len(keys)))
    for prior in [None, .5, 1.]:
        m = matrix if prior is None else [
            [n/(n+4)*v+4/(n+4)*(1500+prior*(row['preRating']-1500)*400/225)
             for v,n in zip(vs,ns)] for row,vs,ns in zip(rows,matrix,counts)]
        expected_points = [sum(1+sum(1/(1+10**((vs[e]-other[e])/400))
            for j,other in enumerate(m) if j!=i) for e in range(len(keys))) for i,vs in enumerate(m)]
        name = 'event-summed-expected-places' if prior is None else f'event-school-prior={prior}'
        event_results[name].append(dict(season=year,**metrics(rows,expected_points)))
        if prior is None:
            event_results['event-mean-rating'].append(dict(season=year,**metrics(rows,[-statistics.mean(vs) for vs in m])))
    print('event snapshot',year,flush=True)

with (history_dir/'event_rating_history.csv').open() as f:
    for row in csv.DictReader(f):
        date = row['date']
        if date < previous_date:
            raise ValueError('History is not chronological')
        previous_date = date
        while index<len(targets) and date>=targets[index][0]['date']:
            evaluate_events(targets[index])
            index+=1
        key = (row['schoolId'],row['eventKey'])
        n = state.get(key,(0,0,0))[2]+1
        state[key] = (float(row['combinedSameDayPostRating']),int(row['season']),n)
while index<len(targets):
    evaluate_events(targets[index]); index+=1
for name, rows in event_results.items():
    results['variants'][name] = dict(windows=windows(rows),perSeason=rows)

# Audit biggest misses and exact pre-Nationals invitational losses.
rows = next(rows for rows in targets if rows[0]['season']==2026)
predicted = ranks([-r['preRating'] for r in rows])
for row,pred in sorted(zip(rows,predicted),key=lambda rp:-abs(rp[1]-rp[0]['representativeOverallRank']))[:15]:
    history=[s for s in report['recentHistories'] if s['schoolId']==row['schoolId'] and s['season']==2026 and s['date']<row['date']]
    results['largestMisses2026'].append(dict(name=row['canonicalName'],state=row['state'],predicted=pred,
        actual=row['representativeOverallRank'],rating=row['preRating'],history=history))

saved={}
with (history_dir/'rating_history.csv').open() as f:
    for row in csv.DictReader(f):
        if row['level']=='Nationals' and int(row['season'])>=2015:
            saved[(row['tournamentId'],row['schoolId'])]=float(row['preRating'])
results['verification']={
    'savedNationalsSnapshots':len(saved),
    'maximumReplayPreRatingDifference':max(abs(s['preRating']-saved[(s['tournamentId'],s['schoolId'])]) for s in report['baselineNationals']),
}
baseline=report['candidates'][0]
rng=random.Random(20261029)
results['bootstrap']={}
for name in ['invitationals-negative=0.5','invitationals-ignore-negative']:
    candidate=next(c for c in report['candidates'] if c['name']==name)
    differences=[a['spearman']-b['spearman'] for a,b in zip(candidate['fullFieldPerSeason'],baseline['fullFieldPerSeason'])]
    samples=sorted(statistics.mean(rng.choices(differences,k=len(differences))) for _ in range(10000))
    results['bootstrap'][name]=dict(yearsImproved=sum(d>0 for d in differences),years=len(differences),
        meanDifference=statistics.mean(differences),pairedYearBootstrap95=[samples[249],samples[9749]],
        caveat='Descriptive retrospective interval; not adjusted for trying multiple variants.')
(ROOT/'output/nationals_analysis.json').write_text(json.dumps(results,indent=2)+'\n')

lines=['# Nationals prediction diagnosis', '',
       'Retrospective diagnosis completed October 29, 2026. Production ratings and configuration were not changed.', '',
       '## Method and verification', '',
       f'Archive commit: `{report["archiveCommit"]}`. Replayed {len(report["candidates"])} fixed diagnostic variants chronologically through 2026; each tournament uses entering ratings only. Each variant changes one setting or update rule unless explicitly labeled as a combination.', '',
       'Evaluation uses Division C Nationals in 2015–2026 (11 tournaments; none in 2020). Correlations are averaged equally across tournaments. Top-25 correlation reranks predictions within the actual top 25. Ties receive average ranks. The full non-exhibition field includes schools with insufficient participation for rating updates; those schools are predicted from their earlier state.', '',
       f'The baseline replay exactly reproduces all {len(saved)} saved eligible Nationals entering ratings (maximum difference {results["verification"]["maximumReplayPreRatingDifference"]}). The original eligible-field average is 0.934081; expanding the evaluation field changes it to {baseline["fullFieldAverage"]["spearman"]:.6f}. In 2026 the full 59-school figure is 0.946113, versus 0.946526 for the 57 eligible schools. Field exclusion does not explain the gap.', '',
       '## Main findings', '',
       '**Poor invitational outcomes exert too much downward influence for forecasting Nationals.** Halving only negative invitational rating changes improves full-field Nationals correlation in 10 of 11 years, including both broad eras. It also improves pooled 2022–2026 normalized finishing-rank MAE across all tournaments from 0.128386 to 0.125356. Suppressing all invitational losses is an intentionally extreme diagnostic; it increases rating levels and can reward volume, so its success is not a justification for deploying it.', '',
       '**The participation safeguard does not establish full-strength lineup quality.** Monta Vista enters 2026 Nationals predicted 17th and finishes first. At Triton, its selected B squad has 86.96% participation while the A squad has 56.52%; we deduct 186.4 points. Official California costs another 104.5 points and Georgia Scrimmage costs 98.4. Downweighting all updates, wins and losses, from invitational appearances below 95% participation to 25% of their existing size improves Nationals correlation to 0.9420 and moves Monta Vista to fifth. This supports an evidence-quality problem without relying entirely on ignoring bad outcomes. Squad labels alone do not prove which students competed or that a result was a secondary roster.', '',
       '**Persistent school-specific Nationals differences contain predictive information.** A fixed, shrunk correction from earlier Nationals raises correlation from 0.9340 to 0.9428. Combining it with halved invitational losses reaches 0.9487. These effects overlap and cannot be added as independent contributions.', '',
       '**Several earlier explanations fail these tests.** Seasonal carryover of 0.90 worsens correlation to 0.9263. Fixing the field-quality clamp changes no Nationals ordering. Removing city from otherwise exact identity keys changes little. Simply summing expected event places from our current event ratings is worse (0.9117); this does not rule out a better event model, but does rule out claiming that event aggregation alone is the missing fix.', '',
       '## Main comparisons', '',
       '| Diagnostic | All-team Spearman | Actual-top-25 Spearman |',
       '| --- | ---: | ---: |']
for name,label in [('baseline','Current model'),('invitationals-negative=0.5','Halve invitational losses'),
                   ('invitationals-ignore-negative','Ignore invitational losses (extreme diagnostic)'),
                   ('incomplete-invitational-learning=0.25','Quarter updates from <95%-coverage invitationals'),
                   ('carry=0.9','90% annual overall carryover'),('correct-field-clamp','Fix field-quality clamp')]:
    c=next(c for c in report['candidates'] if c['name']==name)['fullFieldAverage']
    lines.append(f'| {label} | {c["spearman"]:.4f} | {c["top25Spearman"]:.4f} |')
for name,label in [('nationals-residual-strength=1','Earlier-Nationals correction'),
                   ('invitationals-negative=0.5+nationals-residual','Halved invitational losses + Nationals correction'),
                   ('event-summed-expected-places','Sum current event expected places')]:
    c=results['variants'][name]['windows']['2015-2026']
    lines.append(f'| {label} | {c["spearman"]:.4f} | {c["top25Spearman"]:.4f} |')
lines += ['', 'The Nationals correction fits each earlier Nationals performance against its entering field using the overall logistic divisor of 225, clamps perfect/winless performance to 0.99/0.01, subtracts the entering rating, and adds the sum of earlier residuals divided by (earlier appearances + 5). The combined experiment recomputes these residuals for the changed model. It is an analogous diagnostic, not a reproduction of Scio.ly’s implementation.', '',
          'Event aggregation uses strictly earlier event-history states, the production 70% seasonal event carryover, all official events on that Nationals schedule, and 1500 for unseen school/event pairs. Expected event places are summed across the full predicted field. Post-hoc school priors were also tested; neither tested strength exceeded the overall baseline.', '',
          '## All replay ablations', '',
          '| Variant | Nationals Spearman | Top-25 Spearman | All-tournament 2022–2026 NMAE |',
          '| --- | ---: | ---: | ---: |']
for c in report['candidates']:
    m=c['fullFieldAverage']
    lines.append(f'| {c["name"]} | {m["spearman"]:.6f} | {m["top25Spearman"]:.6f} | {c["allTournamentRankMetrics2022Plus"]["normalizedRankMeanAbsoluteError"]:.6f} |')
interval=results['bootstrap']['invitationals-negative=0.5']['pairedYearBootstrap95']
lines += ['', '## Limits and next decision', '',
          f'For halved invitational losses, the paired-year bootstrap interval for the mean correlation improvement is [{interval[0]:.4f}, {interval[1]:.4f}] (10,000 resamples). This is descriptive and not corrected for the variants tried. These years were previously inspected and these experiments are retrospective; none is a pristine holdout.', '',
          'Scio.ly reports 0.949 overall and 0.815 within the top 25 across its Nationals backtest. Our combined diagnostic reaches similar overall correlation on our archive, but we have not reproduced its exact fields, per-year predictions, tuning or implementation. We can identify weaknesses inside our model; we cannot uniquely assign the entire cross-model gap to individual Scio.ly features from the methodology note alone.', '',
          'The supported development direction is a lineup-aware, robust invitational observation model plus a separately validated Nationals correction. Ignoring losses outright risks inflation and volume bias. Preserve a general rating if a Nationals-specific adjustment hurts other prediction targets; reserve new results for prospective validation.', '',
          '## Reproduce', '', 'With Node.js 24+, Python 3 and the pinned archive available:', '',
          '```sh', 'node scripts/diagnose-nationals.js <archive>/data/results',
          'node scripts/rebuild-ratings.js <archive>/data/results <baseline-output> 2026 config/model_v2.6.json',
          'python3 scripts/analyze-nationals.py <baseline-output>', '```', '',
          'Detailed results: `output/nationals_diagnosis.json` and `output/nationals_analysis.json`.']
(ROOT/'docs/NATIONALS_DIAGNOSIS.md').write_text('\n'.join(lines)+'\n')
for name,r in results['variants'].items():
    print(name,json.dumps(r['windows']))
