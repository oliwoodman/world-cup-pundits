import { v } from "convex/values";
import { internalMutation, mutation, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";

type Outcome = { status: "won" | "lost" | "void"; payout: number };

// Adjudicate one bet against the final score. Tolerant parsing; when we can't
// confidently decide, we VOID (refund the stake) rather than wrongly take money.
function decideBet(bet: Doc<"bets">, homeScore: number, awayScore: number, homeTeam: string, awayTeam: string): Outcome {
  const result = homeScore > awayScore ? "home" : awayScore > homeScore ? "away" : "draw";
  const total = homeScore + awayScore;
  const sel = bet.selection.toLowerCase();
  const market = bet.market.toLowerCase();
  const home = homeTeam.toLowerCase();
  const away = awayTeam.toLowerCase();
  const won: Outcome = { status: "won", payout: bet.stake * bet.odds };
  const lost: Outcome = { status: "lost", payout: 0 };
  const refunded: Outcome = { status: "void", payout: bet.stake };

  // Correct score, e.g. "2-1"
  if (market.includes("score") || /\d\s*[-–]\s*\d/.test(sel)) {
    const m = sel.match(/(\d+)\s*[-–]\s*(\d+)/);
    if (m) return Number(m[1]) === homeScore && Number(m[2]) === awayScore ? won : lost;
  }

  // Totals / over-under, e.g. "Over 2.5"
  if (
    market.includes("total") ||
    market.includes("over") ||
    market.includes("under") ||
    sel.includes("over") ||
    sel.includes("under")
  ) {
    const m = sel.match(/(\d+(?:\.\d+)?)/);
    if (m) {
      const line = Number(m[1]);
      if (sel.includes("over")) return total > line ? won : total < line ? lost : refunded;
      if (sel.includes("under")) return total < line ? won : total > line ? lost : refunded;
    }
  }

  // Match result (1X2 / moneyline / h2h) and generic team-name fallback
  const mentionsHome = sel.includes(home);
  const mentionsAway = sel.includes(away);
  if (sel.includes("draw") || sel.includes("tie")) return result === "draw" ? won : lost;
  if (mentionsHome && !mentionsAway) return result === "home" ? won : lost;
  if (mentionsAway && !mentionsHome) return result === "away" ? won : lost;

  return refunded; // can't adjudicate (e.g. handicap) — refund the stake
}

async function doSettle(ctx: MutationCtx, fixtureId: Id<"fixtures">, homeScore: number, awayScore: number) {
  const fixture = await ctx.db.get(fixtureId);
  if (!fixture) return { settled: 0 };
  await ctx.db.patch(fixtureId, { status: "finished", homeScore, awayScore });

  const bets = await ctx.db
    .query("bets")
    .withIndex("by_fixture", (q) => q.eq("fixtureId", fixtureId))
    .collect();

  let settled = 0;
  for (const b of bets) {
    if (b.status !== "open") continue; // idempotent: safe to re-run
    if (b.kind === "outright") continue; // outrights settle at tournament end
    const outcome = decideBet(b, homeScore, awayScore, fixture.homeTeam, fixture.awayTeam);
    await ctx.db.patch(b._id, { status: outcome.status, payout: outcome.payout, settledAt: Date.now() });
    settled++;
  }

  // Re-evolve every pundit's identity card off the new P&L.
  await ctx.scheduler.runAfter(0, internal.identity.evolveAll, {});
  return { settled };
}

// Internal (called by the score-polling cron).
export const settleFixture = internalMutation({
  args: { fixtureId: v.id("fixtures"), homeScore: v.number(), awayScore: v.number() },
  handler: async (ctx, { fixtureId, homeScore, awayScore }) => doSettle(ctx, fixtureId, homeScore, awayScore),
});

// Public admin override — enter a result by hand (dashboard/CLI).
export const enterResult = mutation({
  args: { fixtureId: v.id("fixtures"), homeScore: v.number(), awayScore: v.number() },
  handler: async (ctx, { fixtureId, homeScore, awayScore }) => doSettle(ctx, fixtureId, homeScore, awayScore),
});

// Settle outright tournament-winner bets at the end / on elimination.
export const settleOutright = mutation({
  args: { winner: v.optional(v.string()), eliminated: v.array(v.string()) },
  handler: async (ctx, { winner, eliminated }) => {
    const bets = await ctx.db
      .query("bets")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .collect();
    const elim = eliminated.map((t) => t.toLowerCase());
    let settled = 0;
    for (const b of bets) {
      if (b.kind !== "outright") continue;
      const pick = b.selection.toLowerCase();
      if (winner && pick.includes(winner.toLowerCase())) {
        await ctx.db.patch(b._id, { status: "won", payout: b.stake * b.odds, settledAt: Date.now() });
        settled++;
      } else if (elim.some((t) => pick.includes(t))) {
        await ctx.db.patch(b._id, { status: "lost", payout: 0, settledAt: Date.now() });
        settled++;
      }
    }
    await ctx.scheduler.runAfter(0, internal.identity.evolveAll, {});
    return { settled };
  },
});
