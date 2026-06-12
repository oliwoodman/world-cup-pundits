import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { start } from "@convex-dev/workflow";

const PRE_KICKOFF_MS = 30 * 60 * 1000; // fire the debate 30 min before kickoff
const WINDOW_MS = 35 * 60 * 1000; // consider fixtures kicking off within the next 35 min

// Cron-driven dispatcher: for each upcoming fixture not yet scheduled, schedule its
// debate at (kickoff - 30 min), exactly once. Patching debateScheduledId in the same
// transaction makes it idempotent across overlapping cron ticks.
export const scheduleUpcomingDebates = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const fixtures = await ctx.db.query("fixtures").withIndex("by_kickoff").collect();
    let scheduled = 0;
    for (const f of fixtures) {
      if (f.debateScheduledId) continue; // already scheduled
      if (f.status !== "scheduled") continue; // only fresh fixtures
      if (f.kickoffAt <= now) continue; // already kicked off
      if (f.kickoffAt - now > WINDOW_MS) continue; // not soon enough yet
      const fireAt = Math.max(f.kickoffAt - PRE_KICKOFF_MS, now);
      const scheduledId = await ctx.scheduler.runAt(
        fireAt,
        internal.dispatcher.startDebateForFixture,
        { fixtureId: f._id },
      );
      await ctx.db.patch(f._id, { debateScheduledId: scheduledId, debateScheduledAt: fireAt });
      scheduled++;
    }
    return { scheduled };
  },
});

// Runs at (kickoff - 30 min): starts the durable debate workflow once.
export const startDebateForFixture = internalMutation({
  args: { fixtureId: v.id("fixtures") },
  handler: async (ctx, { fixtureId }) => {
    const f = await ctx.db.get(fixtureId);
    if (!f) return;
    if (f.debateWorkflowId) return; // already started
    const workflowId = await start(
      ctx,
      internal.engine.debateWorkflow,
      { fixtureId },
      { onComplete: internal.engine.onDebateComplete, context: { fixtureId } },
    );
    await ctx.db.patch(fixtureId, { debateWorkflowId: workflowId });
  },
});
