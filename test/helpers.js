export function scoringFixture({
  includeLowerSquad = true,
  unknownRepresentativeEvent = false,
  division = "C",
} = {}) {
  const lowerTeam = includeLowerSquad
    ? `
- number: 1
  school: Alpha High School
  suffix: A
  city: Alpha
  state: CA`
    : "";
  const lowerPlacings = includeLowerSquad
    ? `
- { team: 1, event: Astronomy, place: 3 }
- { team: 1, event: Codebusters, place: 3 }
- { team: 1, event: Forensics, place: 2 }`
    : "";
  const representativeForensics = unknownRepresentativeEvent
    ? "- { team: 2, event: Forensics, unknown: true }"
    : "- { team: 2, event: Forensics, place: 4 }";

  return `---
Tournament:
  name: Exact Scoring Fixture
  location: Alpha, CA
  state: CA
  level: Invitational
  division: ${division}
  year: 2026
  worst placings dropped: 1
  awards date: 2026-02-01
Events:
- { name: Astronomy }
- { name: Codebusters }
- { name: Forensics }
Teams:${lowerTeam}
- number: 2
  school: Alpha High School
  suffix: B
  city: Alpha
  state: CA
- number: 3
  school: Beta High School
  city: Beta
  state: CA
- number: 4
  school: Gamma High School
  city: Gamma
  state: CA
Placings:${lowerPlacings}
- { team: 2, event: Astronomy, place: 1 }
- { team: 2, event: Codebusters, place: 1 }
${representativeForensics}
- { team: 3, event: Astronomy, place: 2 }
- { team: 3, event: Codebusters, place: 2 }
- { team: 3, event: Forensics, place: 1 }
- { team: 4, event: Astronomy, place: 4 }
- { team: 4, event: Codebusters, place: 4 }
- { team: 4, event: Forensics, place: 3 }
Penalties:
- { team: 2, points: 1 }
`;
}

export function ratingTournament({
  id = "fixture",
  date = "2026-02-01",
  season = 2026,
  level = "Invitational",
  location = "Example High School",
  schools,
}) {
  return {
    id,
    name: id,
    date,
    season,
    division: "C",
    level,
    location,
    teamEntries: schools.map((school, index) => ({
      id: `${id}:team:${index + 1}`,
      schoolId: `school-${school.name}`,
      schoolKey: `school-${school.name}`,
      canonicalName: school.name,
      city: school.city ?? school.name,
      state: school.state ?? "CA",
      division: "C",
      number: index + 1,
      officialOverallRank: school.rank,
      totalPoints: school.totalPoints,
      scoredEventCount: school.scoredEventCount,
      representativeForSchool: school.representative ?? true,
      exhibition: false,
      disqualified: false,
      evidenceCoverage: school.evidenceCoverage ?? 1,
    })),
  };
}
