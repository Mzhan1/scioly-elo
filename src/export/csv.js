function escapeCsv(value) {
  if (value === undefined || value === null) return "";
  const string = typeof value === "number" ? String(value) : String(value);
  return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

export function toCsv(rows, columns) {
  return [
    columns.join(","),
    toCsvRows(rows, columns),
  ].join("\n");
}

export function toCsvRows(rows, columns) {
  if (rows.length === 0) return "";
  return rows
    .map((row) => columns.map((column) => escapeCsv(row[column])).join(","))
    .join("\n") + "\n";
}

export function rankedStates(states) {
  const rows = [...states.values()].sort(
    (a, b) =>
      a.division.localeCompare(b.division) ||
      b.rating - a.rating ||
      a.canonicalName.localeCompare(b.canonicalName),
  );
  const nationalCounters = new Map();
  const stateCounters = new Map();
  return rows.map((state) => {
    const national = (nationalCounters.get(state.division) ?? 0) + 1;
    nationalCounters.set(state.division, national);
    const stateKey = `${state.division}|${state.state}`;
    const stateRank = (stateCounters.get(stateKey) ?? 0) + 1;
    stateCounters.set(stateKey, stateRank);
    return {
      ...state,
      nationalRank: national,
      stateRank,
    };
  });
}

export function rankedEventStates(states) {
  const rows = [...states.values()].sort(
    (left, right) =>
      left.division.localeCompare(right.division) ||
      left.eventKey.localeCompare(right.eventKey) ||
      right.rating - left.rating ||
      left.canonicalName.localeCompare(right.canonicalName),
  );
  const nationalCounters = new Map();
  const stateCounters = new Map();
  return rows.map((state) => {
    const nationalKey = `${state.division}|${state.eventKey}`;
    const nationalEventRank = (nationalCounters.get(nationalKey) ?? 0) + 1;
    nationalCounters.set(nationalKey, nationalEventRank);
    const stateKey = `${nationalKey}|${state.state}`;
    const stateEventRank = (stateCounters.get(stateKey) ?? 0) + 1;
    stateCounters.set(stateKey, stateEventRank);
    return {
      ...state,
      nationalEventRank,
      stateEventRank,
    };
  });
}
