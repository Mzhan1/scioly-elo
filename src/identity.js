import { createHash } from "node:crypto";

function fold(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

/** A tournament-local school identity, matching SciolyFF's school/city/state grouping. */
export function tournamentSchoolKey(team) {
  return [fold(team.school), fold(team.city), fold(team.state)].join("|");
}

/** A persistent program identity. Division is included so B and C programs never merge. */
export function programKey(team, division) {
  return [fold(team.school), fold(team.city), fold(team.state), fold(division)].join("|");
}

export function stableId(value) {
  return `sch_${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}
