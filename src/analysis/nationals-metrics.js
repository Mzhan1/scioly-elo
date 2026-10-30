function ranks(values) {
  const order = values.map((value, index) => ({ value, index })).sort((a,b) => a.value-b.value);
  const result = [];
  for (let i=0;i<order.length;) {
    let j=i+1;
    while (j<order.length && order[j].value===order[i].value) j++;
    for (let k=i;k<j;k++) result[order[k].index]=(i+j+1)/2;
    i=j;
  }
  return result;
}

export function spearman(first, second) {
  if (first.length !== second.length || first.length < 2) return null;
  const a=ranks(first), b=ranks(second), mean=(a.length+1)/2;
  const denominator=Math.sqrt(a.reduce((s,v)=>s+(v-mean)**2,0)*b.reduce((s,v)=>s+(v-mean)**2,0));
  return denominator ? a.reduce((s,v,i)=>s+(v-mean)*(b[i]-mean),0)/denominator : null;
}

export function nationalsMetrics(rows) {
  const groups=new Map();
  for (const row of rows) {
    if (!groups.has(row.tournamentId)) groups.set(row.tournamentId,[]);
    groups.get(row.tournamentId).push(row);
  }
  const perTournament=[...groups.values()].map(field=>{
    const top=field.filter(row=>row.actualRank<=25);
    return { tournamentId:field[0].tournamentId, season:field[0].season, schools:field.length,
      generalSpearman:spearman(field.map(r=>-r.preRating),field.map(r=>r.actualRank)),
      nationalsSpearman:spearman(field.map(r=>-r.nationalsPreRating),field.map(r=>r.actualRank)),
      generalTop25Spearman:spearman(top.map(r=>-r.preRating),top.map(r=>r.actualRank)),
      nationalsTop25Spearman:spearman(top.map(r=>-r.nationalsPreRating),top.map(r=>r.actualRank)),
    };
  });
  const windows=Object.fromEntries([[2015,2021],[2022,2024],[2025,2025],[2026,2026],[2015,2026]].map(([from,to])=>{
    const selected=perTournament.filter(row=>row.season>=from&&row.season<=to);
    const result={tournaments:selected.length};
    for (const key of ['generalSpearman','nationalsSpearman','generalTop25Spearman','nationalsTop25Spearman']) {
      const values=selected.map(row=>row[key]).filter(value=>value!==null);
      result[key]=values.length?values.reduce((s,v)=>s+v,0)/values.length:null;
    }
    return [`${from}-${to}`,result];
  }));
  return {windows,perTournament};
}
