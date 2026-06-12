// The tournament's real shape, reconstructed from the live fixtures — the single source of truth
// for "which teams/groups are actually in World Cup 2026". The four teams in a group each play the
// other three, so teams connected by group-stage matches form a component; union-find recovers the
// 12 groups. Both the wall-chart (`groups.list`) and the pundit grounding (the briefing + the
// Touchline) read from here, so nobody can claim a real team "isn't in the tournament".

// Official group letters by team — the odds feed carries none, so we pin them here. Any team listed
// fixes its whole group to that letter; unlisted groups fall back to kickoff order.
export const GROUP_LETTER: Record<string, string> = {
  Mexico: "A", // A: Mexico, South Korea, South Africa, Czech Republic
  Canada: "B", // B: Canada, Switzerland, Qatar, Bosnia & Herzegovina
  Brazil: "C", // C: Brazil, Morocco, Haiti, Scotland
  USA: "D", // D: USA, Paraguay, Australia, Turkey
  Germany: "E", // E: Germany, Curaçao, Ecuador, Ivory Coast
  Netherlands: "F", // F: Netherlands, Japan, Sweden, Tunisia
  Belgium: "G", // G: Belgium, Egypt, Iran, New Zealand
  Spain: "H", // H: Spain, Cape Verde, Saudi Arabia, Uruguay
  France: "I", // I: France, Senegal, Iraq, Norway
  Argentina: "J", // J: Argentina, Algeria, Austria, Jordan
  Portugal: "K", // K: Portugal, DR Congo, Uzbekistan, Colombia
  England: "L", // L: England, Croatia, Ghana, Panama
};

export type GroupFixture = { homeTeam: string; awayTeam: string; kickoffAt: number };

export type ReconstructedGroup<F extends GroupFixture> = {
  label: string;
  teams: string[];
  fixtures: F[];
  minKo: number;
};

// Recover the 12 groups from the fixture list via union-find, label them A–L (official letters where
// known, kickoff order for the rest), and return each group with its teams + fixtures, sorted by label.
export function reconstructGroups<F extends GroupFixture>(fixtures: F[]): ReconstructedGroup<F>[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) {
      const next = parent.get(c)!;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  for (const f of fixtures) union(f.homeTeam, f.awayTeam);

  // Bucket fixtures by component.
  const comps = new Map<string, F[]>();
  for (const f of fixtures) {
    const r = find(f.homeTeam);
    if (!comps.has(r)) comps.set(r, []);
    comps.get(r)!.push(f);
  }

  const groups: { teams: string[]; fixtures: F[]; minKo: number }[] = [];
  for (const fxs of comps.values()) {
    const teams = new Set<string>();
    for (const f of fxs) {
      teams.add(f.homeTeam);
      teams.add(f.awayTeam);
    }
    if (teams.size !== 4) continue; // a clean group has exactly four teams (skip any knockout edges)
    groups.push({ teams: [...teams], fixtures: fxs, minKo: Math.min(...fxs.map((f) => f.kickoffAt)) });
  }

  groups.sort((a, b) => a.minKo - b.minKo);

  // Pin official letters where a group contains a listed team; fill the rest in kickoff order.
  const known = groups.map((g) => g.teams.map((t) => GROUP_LETTER[t]).find(Boolean) ?? null);
  const used = new Set(known.filter((x): x is string => x !== null));
  const spare: string[] = [];
  for (let i = 0; i < 26 && spare.length < groups.length; i++) {
    const L = String.fromCharCode(65 + i);
    if (!used.has(L)) spare.push(L);
  }
  let si = 0;
  return groups
    .map((g, i) => ({ label: known[i] ?? spare[si++], ...g }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// The grounding block every pundit reads — the real draw, with a hard "do not deny real teams"
// instruction. Built from the same fixtures the rest of the app uses, so it can never drift.
export function tournamentGroundingText(fixtures: GroupFixture[]): string {
  const groups = reconstructGroups(fixtures);
  if (!groups.length) return "";
  const lines = groups.map((g) => `  Group ${g.label}: ${[...g.teams].sort().join(", ")}`).join("\n");
  return (
    `THE REAL DRAW — all 48 teams below ARE in World Cup 2026 (this is fact). NEVER claim a listed ` +
    `team "isn't in the tournament", "didn't qualify" or doesn't exist — if you rate them poorly, ` +
    `mock them, don't deny them. Only these teams and fixtures are real:\n${lines}`
  );
}
