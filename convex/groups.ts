import { query } from "./_generated/server";
import { reconstructGroups } from "./tournament";

// The group stage, reconstructed from the live fixtures — no hardcoded draw. Group recovery + the
// official A–L letters live in `tournament.ts` (shared with the pundit grounding); here we just build
// each group's live mini-table (from finished results) and its fixtures, ready for the wall-chart.

type Standing = {
  team: string;
  p: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
};

export const list = query({
  args: {},
  handler: async (ctx) => {
    const fixtures = (await ctx.db.query("fixtures").withIndex("by_kickoff").collect()).filter(
      (f) => f.externalId,
    );

    // Latest debate status per fixture, for the badges.
    const debByFixture = new Map<string, { status: string; startedAt: number }>();
    for (const d of await ctx.db.query("debates").collect()) {
      const prev = debByFixture.get(d.fixtureId);
      if (!prev || d.startedAt > prev.startedAt) debByFixture.set(d.fixtureId, { status: d.status, startedAt: d.startedAt });
    }

    return reconstructGroups(fixtures).map((g) => {
      const table = new Map<string, Standing>();
      for (const t of g.teams) table.set(t, { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 });
      for (const f of g.fixtures) {
        if (f.status !== "finished" || f.homeScore == null || f.awayScore == null) continue;
        const h = table.get(f.homeTeam)!;
        const a = table.get(f.awayTeam)!;
        h.p++;
        a.p++;
        h.gf += f.homeScore;
        h.ga += f.awayScore;
        a.gf += f.awayScore;
        a.ga += f.homeScore;
        if (f.homeScore > f.awayScore) {
          h.w++;
          h.pts += 3;
          a.l++;
        } else if (f.homeScore < f.awayScore) {
          a.w++;
          a.pts += 3;
          h.l++;
        } else {
          h.d++;
          a.d++;
          h.pts++;
          a.pts++;
        }
      }
      for (const r of table.values()) r.gd = r.gf - r.ga;

      const standings = [...table.values()].sort(
        (x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.team.localeCompare(y.team),
      );
      const groupFixtures = g.fixtures
        .map((f) => ({
          _id: f._id,
          homeTeam: f.homeTeam,
          awayTeam: f.awayTeam,
          kickoffAt: f.kickoffAt,
          status: f.status,
          homeScore: f.homeScore ?? null,
          awayScore: f.awayScore ?? null,
          debateStatus: debByFixture.get(f._id)?.status ?? null,
        }))
        .sort((a, b) => a.kickoffAt - b.kickoffAt);

      return { label: g.label, minKo: g.minKo, standings, fixtures: groupFixtures };
    });
  },
});
