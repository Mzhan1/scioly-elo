import path from "node:path";
import Interpreter from "sciolyff/interpreter";
import { programKey, stableId, tournamentSchoolKey } from "../identity.js";
import { tournamentFormat } from "../ratings/evidence.js";

function isoDate(tournament, sourceFile) {
  const date = tournament.awardsDate ?? tournament.endDate ?? tournament.startDate ?? tournament.date;
  if (date instanceof Date && !Number.isNaN(date.valueOf())) {
    return date.toISOString().slice(0, 10);
  }
  const match = path.basename(sourceFile).match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? `${tournament.year}-12-31`;
}

function selectRepresentatives(teams) {
  const selected = new Map();
  for (const team of teams) {
    const key = tournamentSchoolKey(team);
    const incumbent = selected.get(key);
    if (
      !incumbent ||
      (team.rank ?? Infinity) < (incumbent.rank ?? Infinity) ||
      (team.rank === incumbent.rank && team.number < incumbent.number)
    ) {
      selected.set(key, team);
    }
  }
  return new Set(selected.values());
}

/**
 * Parse and normalize a SciolyFF tournament. All scoring and overall ranking is
 * delegated to the pinned official SciolyFF interpreter.
 */
export function scoreSciolyff(yaml, sourceFile = "tournament.yaml") {
  const interpreter = new Interpreter(yaml);
  const tournament = interpreter.tournament;
  const representatives = selectRepresentatives(interpreter.teams);
  const date = isoDate(tournament, sourceFile);
  const tournamentId = path.basename(sourceFile, path.extname(sourceFile));

  const teamEntries = interpreter.teams.map((team) => {
    const schoolKey = programKey(team, tournament.division);
    return {
      id: `${tournamentId}:team:${team.number}`,
      tournamentId,
      schoolId: stableId(schoolKey),
      schoolKey,
      canonicalName: team.school,
      city: team.city ?? "",
      state: team.state ?? "",
      division: tournament.division,
      number: team.number,
      suffix: team.suffix ?? "",
      track: team.trackName ?? "",
      exhibition: team.exhibition,
      disqualified: team.disqualified,
      officialOverallRank: team.rank,
      totalPoints: team.points,
      representativeForSchool: representatives.has(team),
    };
  });

  const entriesByNumber = new Map(teamEntries.map((entry) => [entry.number, entry]));
  const events = interpreter.events.map((event, index) => ({
    id: `${tournamentId}:event:${index + 1}`,
    tournamentId,
    canonicalName: event.name,
    trial: event.trial,
    trialed: event.trialed,
    official: !event.trial && !event.trialed,
  }));
  const eventsByName = new Map(events.map((event) => [event.canonicalName, event]));

  const eventResults = interpreter.placings.map((placing) => {
    const entry = entriesByNumber.get(placing.team?.number ?? placing.rep.team);
    const event = eventsByName.get(placing.event?.name ?? placing.rep.event);
    return {
      eventInstanceId: event?.id,
      teamEntryId: entry?.id,
      place: placing.place,
      points: placing.points,
      participated: placing.participated,
      unknown: placing.unknown,
      disqualified: placing.disqualified,
      exempt: placing.exempt,
      dropped: placing.droppedAsPartOfWorstPlacings ?? false,
      representativeForSchool: entry?.representativeForSchool ?? false,
    };
  });

  const officialEventIds = new Set(
    events.filter((event) => event.official).map((event) => event.id),
  );
  for (const entry of teamEntries) {
    const officialResults = eventResults.filter(
      (result) =>
        result.teamEntryId === entry.id && officialEventIds.has(result.eventInstanceId),
    );
    entry.scoredEventCount = officialResults.length;
    entry.ratedEventParticipation = officialResults.filter(
      (result) => result.participated && !result.unknown,
    ).length;
    entry.evidenceCoverage =
      entry.scoredEventCount === 0
        ? 0
        : entry.ratedEventParticipation / entry.scoredEventCount;
  }

  const normalizedTournament = {
    id: tournamentId,
    name: tournament.name ?? tournament.shortName ?? tournamentId,
    date,
    season: tournament.year,
    division: tournament.division,
    level: tournament.level,
    location: tournament.location,
    state: tournament.state ?? "",
    sourceFile,
    numberOfTeams: teamEntries.length,
    scoringConfig: {
      worstPlacingsDropped: tournament.worstPlacingsDropped,
      exemptPlacings: tournament.exemptPlacings,
      reverseScoring: tournament.reverseScoring,
      maximumPlace: tournament.maximumPlace,
      perEventN: tournament.perEventN,
      nOffset: tournament.nOffset,
      participationOnlyOffset: tournament.poOffset,
      noShowOffset: tournament.nsOffset,
      disqualificationOffset: tournament.dqOffset,
      hasTracks: tournament.hasTracks,
    },
    teamEntries,
    events,
    eventResults,
  };
  normalizedTournament.format = tournamentFormat(normalizedTournament);
  return normalizedTournament;
}

export function representativeEntries(tournament, { rateableOnly = false } = {}) {
  return tournament.teamEntries.filter(
    (entry) =>
      entry.representativeForSchool &&
      (!rateableOnly ||
        (!entry.exhibition &&
          !entry.disqualified &&
          entry.evidenceCoverage > 0 &&
          Number.isFinite(entry.officialOverallRank))),
  );
}

/** Select each school's best valid squad separately for every official event. */
export function bestSchoolEventEvidence(tournament) {
  const officialEventIds = new Set(
    tournament.events.filter((event) => event.official).map((event) => event.id),
  );
  const entriesById = new Map(tournament.teamEntries.map((entry) => [entry.id, entry]));
  const selected = new Map();

  for (const result of tournament.eventResults) {
    const entry = entriesById.get(result.teamEntryId);
    if (
      !entry ||
      entry.exhibition ||
      entry.disqualified ||
      !officialEventIds.has(result.eventInstanceId) ||
      !result.participated ||
      result.unknown ||
      result.disqualified ||
      result.exempt ||
      !Number.isFinite(result.place)
    ) {
      continue;
    }
    const key = `${result.eventInstanceId}\u0000${entry.schoolKey}`;
    const incumbent = selected.get(key);
    const incumbentEntry = incumbent && entriesById.get(incumbent.teamEntryId);
    if (
      !incumbent ||
      result.place < incumbent.place ||
      (result.place === incumbent.place && entry.number < incumbentEntry.number)
    ) {
      selected.set(key, result);
    }
  }
  return [...selected.values()];
}
