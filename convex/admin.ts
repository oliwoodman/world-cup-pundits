import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { baseRiskFor } from "./pundits";

// One-shot launch cleanup. Wipes all debate/betting history and the leftover sample fixtures
// (those with no externalId), then resets every pundit's identity card to opening state — so the
// money race starts fresh at £1000 against ONLY the real World Cup fixtures + odds.
//
// DESTRUCTIVE and irreversible. Keeps `models` and the real (externalId) fixtures + their odds.
// By default it ALSO deletes the real fixtures' debate/bet history (since bankroll is derived from
// the bets ledger, this is what resets everyone to £1000). Run from the dashboard/CLI when ready:
//   npx convex run admin:resetForLaunch '{"confirm":"RESET"}'
export const resetForLaunch = mutation({
  args: { confirm: v.string() },
  handler: async (ctx, { confirm }) => {
    if (confirm !== "RESET") {
      throw new Error('Refusing to reset. Pass {"confirm":"RESET"} to proceed.');
    }

    // 1. Clear the ledger + transcripts + predictions (resets all bankrolls to £1000).
    for (const table of ["bets", "predictions", "debateMessages", "debates"] as const) {
      const rows = await ctx.db.query(table).collect();
      for (const r of rows) await ctx.db.delete(r._id);
    }

    // 2. Drop the leftover sample fixtures (no externalId). Real fixtures + odds stay.
    let removedFixtures = 0;
    const fixtures = await ctx.db.query("fixtures").collect();
    for (const f of fixtures) {
      if (f.externalId) {
        // clear any stale scheduling/debate bookkeeping on real fixtures so the dispatcher
        // can (re)schedule cleanly and statuses read "scheduled" again.
        await ctx.db.patch(f._id, {
          status: f.status === "finished" ? "finished" : "scheduled",
          debateScheduledId: undefined,
          debateScheduledAt: undefined,
          debateWorkflowId: undefined,
        });
      } else {
        await ctx.db.delete(f._id);
        removedFixtures++;
      }
    }

    // 3. Reset identity cards to opening posture — risk dial back to each pundit's innate appetite
    //    (never a flat 50), so a fresh board already reflects character.
    const now = Date.now();
    const cards = await ctx.db.query("identityCards").collect();
    for (const c of cards) {
      const m = await ctx.db.get(c.modelId);
      await ctx.db.patch(c._id, {
        posture: "Opening day. £1000 in the bank. Everything to prove.",
        mood: "neutral",
        riskDial: m ? baseRiskFor(m.key) : 50,
        updatedAt: now,
      });
    }

    return { reset: true, removedFixtures, cardsReset: cards.length };
  },
});
