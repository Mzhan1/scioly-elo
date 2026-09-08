function normalized(value) {
  return String(value ?? "").trim().toLowerCase();
}

/** Infer only tournament formats that the archive identifies objectively. */
export function tournamentFormat(tournament) {
  const location = normalized(tournament.location);
  const name = normalized(tournament.name);

  if (location === "hybrid" || /\bhybrid\b/.test(location)) return "hybrid";
  if (
    location === "online" ||
    /\b(?:online|virtual)\b/.test(location) ||
    /\b(?:satellite|virtual)\b/.test(name)
  ) {
    return "satellite";
  }
  return "traditional";
}

export function tournamentFormatPrior(tournament, config) {
  const format = tournament.format ?? tournamentFormat(tournament);
  return config.formatPrior?.[format] ?? config.formatPrior?.traditional ?? 1;
}

export function scheduleKey(date, schoolKey) {
  return `${date}\u0000${schoolKey}`;
}

export function appearanceKey(tournamentId, schoolKey) {
  return `${tournamentId}\u0000${schoolKey}`;
}

/** Count distinct same-day tournaments entered by each school program. */
export function concurrentTournamentCounts(tournaments, eligibleEntries) {
  const appearances = new Map();
  for (const tournament of tournaments) {
    for (const entry of eligibleEntries(tournament)) {
      const key = scheduleKey(tournament.date, entry.schoolKey);
      const tournamentIds = appearances.get(key) ?? new Set();
      tournamentIds.add(tournament.id);
      appearances.set(key, tournamentIds);
    }
  }
  return new Map([...appearances].map(([key, ids]) => [key, ids.size]));
}

export function splitSquadWeight(count, exponent = 0.5) {
  return 1 / Math.max(1, count) ** exponent;
}

/**
 * Allocate one squared-information budget across concurrent appearances.
 * Equal-strength fields reproduce 1/sqrt(n); stronger fields approach 1.
 */
export function competitiveLineupWeights(
  fieldStrengths,
  { temperature = 200, minimumRawWeight = 0.2 } = {},
) {
  if (fieldStrengths.length === 0) return [];
  const maximum = Math.max(...fieldStrengths);
  const raw = fieldStrengths.map((strength) =>
    Math.max(minimumRawWeight, Math.exp((strength - maximum) / temperature)),
  );
  const norm = Math.sqrt(raw.reduce((sum, weight) => sum + weight ** 2, 0));
  return raw.map((weight) => weight / norm);
}
