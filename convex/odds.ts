import { v } from "convex/values";
import {
  ActionCtx,
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";

// The Odds API integration: real fixtures (/events, free), a bulk match-odds snapshot
// (/odds, 3 credits) cached onto each fixture, and the tournament-winner board (1 credit).
// Score polling + settlement lives in scores.ts. All paid calls go through `oddsFetch`,
// which records the remaining-credit gauge and hard-stops below MIN_CREDITS.

const ODDS_BASE = "https://api.the-odds-api.com/v4";
const SPORT = "soccer_fifa_world_cup";
const SPORT_OUTRIGHT = "soccer_fifa_world_cup_winner";
export const PROVIDER = "the-odds-api";
const MIN_CREDITS = 50; // never spend the last 50 credits — leave headroom for scores/settlement

// ---- The Odds API response shapes (only the fields we read) ----------------
type Outcome = { name: string; price: number; point?: number };
type Market = { key: string; outcomes: Outcome[] };
type Bookmaker = { markets: Market[] };
type OddsEvent = {
  id: string;
  commence_time: string; // ISO (we pass dateFormat=iso)
  home_team: string;
  away_team: string;
  bookmakers?: Bookmaker[];
};

type SnapshotInput = {
  externalId: string;
  home: number;
  draw: number;
  away: number;
  over?: number;
  under?: number;
  line?: number;
  outrightBoard?: string;
};

function avg(xs: number[]): number {
  const v = xs.filter((n) => Number.isFinite(n) && n > 0);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
}

// ---- budget gauge ----------------------------------------------------------
export const getBudget = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("apiBudget")
      .withIndex("by_provider", (q) => q.eq("provider", PROVIDER))
      .first();
  },
});

export const recordBudget = internalMutation({
  args: { remaining: v.number(), used: v.number() },
  handler: async (ctx, { remaining, used }) => {
    const existing = await ctx.db
      .query("apiBudget")
      .withIndex("by_provider", (q) => q.eq("provider", PROVIDER))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { remaining, used, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("apiBudget", { provider: PROVIDER, remaining, used, updatedAt: Date.now() });
    }
  },
});

// One guarded call to The Odds API. For paid calls (cost > 0) it first checks the stored
// gauge and returns {skipped:true} if we're below the floor, so we never blow the quota.
// After every call it records `x-requests-remaining`/`x-requests-used` from the headers.
export async function oddsFetch(
  ctx: ActionCtx,
  path: string,
  cost: number,
): Promise<{ skipped: true } | { skipped: false; data: unknown }> {
  const key = process.env.ODDS_API_KEY;
  if (!key) throw new Error("ODDS_API_KEY not set on the Convex deployment");

  if (cost > 0) {
    const budget = await ctx.runQuery(internal.odds.getBudget, {});
    if (budget && budget.remaining < MIN_CREDITS) {
      console.warn(
        `[odds] hard-stop: ${budget.remaining} credits left (< ${MIN_CREDITS}) — skipping paid call ${path}`,
      );
      return { skipped: true };
    }
  }

  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${ODDS_BASE}${path}${sep}apiKey=${key}`, {
    headers: { Accept: "application/json" },
  });

  const remaining = Number(res.headers.get("x-requests-remaining"));
  const used = Number(res.headers.get("x-requests-used"));
  if (Number.isFinite(remaining)) {
    await ctx.runMutation(internal.odds.recordBudget, {
      remaining,
      used: Number.isFinite(used) ? used : 0,
    });
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Odds API HTTP ${res.status} on ${path}: ${text.slice(0, 200)}`);
  }
  return { skipped: false, data: await res.json() };
}

// ---- /events → upsert real fixtures (free) ---------------------------------
export const upsertFixtures = internalMutation({
  args: {
    rows: v.array(
      v.object({
        externalId: v.string(),
        homeTeam: v.string(),
        awayTeam: v.string(),
        kickoffAt: v.number(),
        stage: v.string(),
      }),
    ),
  },
  handler: async (ctx, { rows }) => {
    let inserted = 0;
    let updated = 0;
    for (const r of rows) {
      if (!Number.isFinite(r.kickoffAt)) continue;
      const existing = await ctx.db
        .query("fixtures")
        .filter((q) => q.eq(q.field("externalId"), r.externalId))
        .first();
      if (existing) {
        // refresh kickoff/teams; never touch status, debate bookkeeping, or odds.
        if (existing.status !== "finished") {
          await ctx.db.patch(existing._id, {
            homeTeam: r.homeTeam,
            awayTeam: r.awayTeam,
            kickoffAt: r.kickoffAt,
          });
          updated++;
        }
      } else {
        await ctx.db.insert("fixtures", {
          homeTeam: r.homeTeam,
          awayTeam: r.awayTeam,
          kickoffAt: r.kickoffAt,
          stage: r.stage,
          status: "scheduled",
          externalId: r.externalId,
        });
        inserted++;
      }
    }
    return { inserted, updated };
  },
});

export const syncFixtures = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ skipped: true } | { fetched: number; inserted: number; updated: number }> => {
    const r = await oddsFetch(ctx, `/sports/${SPORT}/events?dateFormat=iso`, 0);
    if (r.skipped) return { skipped: true as const };
    const events = (r.data as OddsEvent[]) ?? [];
    const rows = events.map((e) => ({
      externalId: e.id,
      homeTeam: e.home_team,
      awayTeam: e.away_team,
      kickoffAt: Date.parse(e.commence_time),
      stage: "Group Stage",
    }));
    const res = await ctx.runMutation(internal.odds.upsertFixtures, { rows });
    console.log(`[odds] syncFixtures: ${events.length} events → ${JSON.stringify(res)}`);
    return { fetched: events.length, ...res };
  },
});

// ---- /odds → consensus snapshot per fixture (3 credits) --------------------
function buildSnapshot(e: OddsEvent, outrightBoard: string | undefined): SnapshotInput | null {
  const homePrices: number[] = [];
  const drawPrices: number[] = [];
  const awayPrices: number[] = [];
  // collect totals over/under prices grouped by line, to pick the modal line.
  const overByLine = new Map<number, number[]>();
  const underByLine = new Map<number, number[]>();

  for (const bk of e.bookmakers ?? []) {
    for (const mk of bk.markets ?? []) {
      if (mk.key === "h2h") {
        for (const o of mk.outcomes ?? []) {
          if (o.name === e.home_team) homePrices.push(Number(o.price));
          else if (o.name === e.away_team) awayPrices.push(Number(o.price));
          else if (o.name.toLowerCase() === "draw") drawPrices.push(Number(o.price));
        }
      } else if (mk.key === "totals") {
        for (const o of mk.outcomes ?? []) {
          if (o.point == null) continue;
          const map = o.name.toLowerCase() === "over" ? overByLine : o.name.toLowerCase() === "under" ? underByLine : null;
          if (!map) continue;
          const arr = map.get(o.point) ?? [];
          arr.push(Number(o.price));
          map.set(o.point, arr);
        }
      }
    }
  }

  const home = avg(homePrices);
  const draw = avg(drawPrices);
  const away = avg(awayPrices);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null; // no usable h2h

  // pick the most-quoted totals line (typically 2.5), then average its over/under.
  let line: number | undefined;
  let over: number | undefined;
  let under: number | undefined;
  let best = -1;
  for (const [ln, prices] of overByLine.entries()) {
    if (prices.length > best) {
      best = prices.length;
      line = ln;
      over = avg(prices);
      under = avg(underByLine.get(ln) ?? []);
    }
  }

  return {
    externalId: e.id,
    home: round2(home),
    draw: Number.isFinite(draw) ? round2(draw) : round2(home * 1.3 + 1),
    away: round2(away),
    over: Number.isFinite(over as number) ? round2(over as number) : undefined,
    under: Number.isFinite(under as number) ? round2(under as number) : undefined,
    line,
    outrightBoard,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const applyOddsSnapshots = internalMutation({
  args: {
    snaps: v.array(
      v.object({
        externalId: v.string(),
        home: v.number(),
        draw: v.number(),
        away: v.number(),
        over: v.optional(v.number()),
        under: v.optional(v.number()),
        line: v.optional(v.number()),
        outrightBoard: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { snaps }) => {
    const now = Date.now();
    let matched = 0;
    for (const s of snaps) {
      const fixture = await ctx.db
        .query("fixtures")
        .filter((q) => q.eq(q.field("externalId"), s.externalId))
        .first();
      if (!fixture || fixture.status === "finished") continue;
      await ctx.db.patch(fixture._id, {
        oddsSnapshot: {
          home: s.home,
          draw: s.draw,
          away: s.away,
          over: s.over,
          under: s.under,
          line: s.line,
          outrightBoard: s.outrightBoard,
          fetchedAt: now,
        },
      });
      matched++;
    }
    return { matched };
  },
});

// Fetch the tournament-winner board as a compact "Team odds, ..." string (1 credit).
async function fetchOutrightBoard(ctx: ActionCtx): Promise<string | undefined> {
  try {
    const r = await oddsFetch(
      ctx,
      `/sports/${SPORT_OUTRIGHT}/odds?regions=eu&markets=outrights&oddsFormat=decimal`,
      1,
    );
    if (r.skipped) return undefined;
    const events = (r.data as OddsEvent[]) ?? [];
    const tally = new Map<string, number[]>();
    for (const e of events) {
      for (const bk of e.bookmakers ?? []) {
        for (const mk of bk.markets ?? []) {
          if (mk.key !== "outrights") continue;
          for (const o of mk.outcomes ?? []) {
            const arr = tally.get(o.name) ?? [];
            arr.push(Number(o.price));
            tally.set(o.name, arr);
          }
        }
      }
    }
    const board = [...tally.entries()]
      .map(([team, prices]) => ({ team, odds: avg(prices) }))
      .filter((x) => Number.isFinite(x.odds))
      .sort((a, b) => a.odds - b.odds)
      .slice(0, 12)
      .map((x) => `${x.team} ${round2(x.odds)}`)
      .join(", ");
    return board || undefined;
  } catch (e) {
    console.warn("[odds] outright board fetch failed:", e);
    return undefined;
  }
}

export const syncOdds = internalAction({
  args: { withOutright: v.optional(v.boolean()) },
  handler: async (
    ctx,
    { withOutright },
  ): Promise<{ skipped: true } | { fetched: number; snapshots: number; matched: number }> => {
    const board = withOutright === false ? undefined : await fetchOutrightBoard(ctx);
    const r = await oddsFetch(
      ctx,
      `/sports/${SPORT}/odds?regions=eu&markets=h2h,totals&oddsFormat=decimal&dateFormat=iso`,
      3,
    );
    if (r.skipped) return { skipped: true as const };
    const events = (r.data as OddsEvent[]) ?? [];
    const snaps = events.map((e) => buildSnapshot(e, board)).filter((s): s is SnapshotInput => s !== null);
    const res = await ctx.runMutation(internal.odds.applyOddsSnapshots, { snaps });
    console.log(`[odds] syncOdds: ${events.length} events, ${snaps.length} snapshots → ${JSON.stringify(res)}`);
    return { fetched: events.length, snapshots: snaps.length, ...res };
  },
});

// ---- public admin triggers (the deploy key can't run internal fns directly) ----
export const runSyncFixtures = action({
  args: {},
  handler: async (ctx): Promise<unknown> => ctx.runAction(internal.odds.syncFixtures, {}),
});

export const runSyncOdds = action({
  args: { withOutright: v.optional(v.boolean()) },
  handler: async (ctx, { withOutright }): Promise<unknown> =>
    ctx.runAction(internal.odds.syncOdds, { withOutright }),
});

// ---- public status (dashboard/CLI) -----------------------------------------
export const status = query({
  args: {},
  handler: async (ctx) => {
    const budget = await ctx.db
      .query("apiBudget")
      .withIndex("by_provider", (q) => q.eq("provider", PROVIDER))
      .first();
    const fixtures = await ctx.db.query("fixtures").collect();
    const real = fixtures.filter((f) => f.externalId);
    return {
      provider: PROVIDER,
      creditsRemaining: budget?.remaining ?? null,
      creditsUsed: budget?.used ?? null,
      budgetUpdatedAt: budget?.updatedAt ?? null,
      fixtures: fixtures.length,
      realFixtures: real.length,
      withOdds: real.filter((f) => f.oddsSnapshot).length,
      sampleFixtures: fixtures.length - real.length,
    };
  },
});
