/** Pure view selection, shared by dashboard and non-browser regression tests. */
export function schoolsForView(schools, view) {
  return schools.map(school => ({ ...school,
    rating: view === 'nationals' ? school.nationalsRating ?? school.rating : school.rating,
    nationalRank: view === 'nationals' ? school.nationalsNationalRank ?? school.nationalRank : school.nationalRank,
    stateRank: view === 'nationals' ? school.nationalsStateRank ?? school.stateRank : school.stateRank,
  })).sort((a,b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.active) return a.nationalRank-b.nationalRank;
    return a.name.localeCompare(b.name) || a.state.localeCompare(b.state);
  });
}

export function historyPointForView(point, view) {
  return {
    dateString: point[0], date: new Date(`${point[0]}T00:00:00`),
    rating: view === 'nationals' ? point[10] ?? point[1] : point[1],
    uncertainty: point[2], tournament: point[3], place: point[4], fieldSize: point[5],
    change: view === 'nationals' ? point[11] ?? point[6] : point[6],
    level: point[7], fullStrengthProbability: point[8] ?? 1, fullStrengthWeight: point[9] ?? 1,
    nationalsAdjustment: point[12] ?? 0, priorNationalsAppearances: point[13] ?? 0,
    nationalsAdjustmentOnly: point[14] ?? false,
  };
}

export function historyRowsForView(data, schoolId, view) {
  const general=data.history[schoolId] ?? [];
  return view === 'nationals' ? [...general,...(data.nationalsOnlyHistory?.[schoolId] ?? [])]
    .sort((a,b)=>a[0].localeCompare(b[0])) : general;
}
