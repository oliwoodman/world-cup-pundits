import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { oddsFetch } from "./odds";

// Score polling + settlement. The /scores call costs 2 credits, so the cron only spends it when a
// real fixture has plausibly finished (kicked off > FULL_TIME_MS ago) but isn't settled. One call
// returns every recent game, so a single poll settles many — and it also UPSERTS any completed game
// we never ingested (the Odds API /events feed only lists upcoming games, so openers that kicked off
// before our first sync would otherwise be missing). Pass {force:true} to poll regardless (backfill).

const FULL_TIME_MS = 110 * 60 * 1000; // ~90 min + stoppage + half-time before a result is realistic

type ScoreEntry = { name: string; score: string | null };
type ScoreEvent = {
  id: string;
  completed: boolean;
  commence_time: string;
  home_team: string;
  away_team: string;
  scores: ScoreEntry[] | null;
};

export const fixturesAwaitingResult = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const fixtures = await ctx.db.query("fixtures").withIndex("by_kickoff").collect();
    return fixtures
      .filter((f) => f.externalId && f.status !== "finished" && now - f.kickoffAt > FULL_TIME_MS)
      .map((f) => ({ _id: f._id, externalId: f.externalId as string }));
  },
});

function parseScore(e: ScoreEvent): { home: number; away: number } | null {
  if (!e.scores) return null;
  const find = (team: string) => e.scores!.find((s) => s.name === team)?.score;
  const home = Number(find(e.home_team));
  const away = Number(find(e.away_team));
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return { home, away };
}

// Find a fixture by its Odds API id, or create it (so completed games we never had get added).
export const findOrCreateFixture = internalMutation({
  args: {
    externalId: v.string(),
    homeTeam: v.string(),
    awayTeam: v.string(),
    commenceTime: v.string(),
  },
  handler: async (ctx, a) => {
    const existing = await ctx.db
      .query("fixtures")
      .filter((q) => q.eq(q.field("externalId"), a.externalId))
      .first();
    if (existing) return { fixtureId: existing._id, created: false };
    const fixtureId = await ctx.db.insert("fixtures", {
      homeTeam: a.homeTeam,
      awayTeam: a.awayTeam,
      kickoffAt: Date.parse(a.commenceTime) || Date.now(),
      stage: "Group Stage",
      status: "scheduled",
      externalId: a.externalId,
    });
    return { fixtureId, created: true };
  },
});

export const syncScores = internalAction({
  args: { force: v.optional(v.boolean()) },
  handler: async (
    ctx,
    { force },
  ): Promise<{ skipped: string } | { settled: number; created: number; returned: number }> => {
    const pending = await ctx.runQuery(internal.scores.fixturesAwaitingResult, {});
    if (!force && pending.length === 0) return { skipped: "no fixtures awaiting result" as const };

    const r = await oddsFetch(ctx, `/sports/soccer_fifa_world_cup/scores?daysFrom=3&dateFormat=iso`, 2);
    if (r.skipped) return { skipped: "budget" as const };

    const events = (r.data as ScoreEvent[]) ?? [];
    let settled = 0;
    let created = 0;
    for (const e of events) {
      if (!e.completed) continue;
      const score = parseScore(e);
      if (!score) continue;
      const { fixtureId, created: wasCreated } = await ctx.runMutation(internal.scores.findOrCreateFixture, {
        externalId: e.id,
        homeTeam: e.home_team,
        awayTeam: e.away_team,
        commenceTime: e.commence_time,
      });
      if (wasCreated) created++;
      // settleFixture is idempotent: only marks finished + settles still-open bets.
      await ctx.runMutation(internal.settlement.settleFixture, {
        fixtureId,
        homeScore: score.home,
        awayScore: score.away,
      });
      settled++;
    }
    console.log(`[scores] ${events.length} games returned, ${settled} settled, ${created} newly added`);
    return { settled, created, returned: events.length };
  },
});

// Public admin trigger (the deploy key can't run internal fns directly). Pass {force:true} to backfill.
export const runSyncScores = action({
  args: { force: v.optional(v.boolean()) },
  handler: async (ctx, { force }): Promise<unknown> =>
    ctx.runAction(internal.scores.syncScores, { force }),
});
