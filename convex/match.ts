import { v } from "convex/values";
import { query } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// Everything the match detail page needs: the fixture, its latest debate,
// the ordered transcript, the locked predictions, every bet placed on it,
// and the full pundit roster (so the page can show all five, including those
// who didn't lock a bet).
export const detail = query({
  args: { fixtureId: v.id("fixtures") },
  handler: async (ctx, { fixtureId }) => {
    const fixture = await ctx.db.get(fixtureId);
    if (!fixture) return null;

    const debate = await ctx.db
      .query("debates")
      .withIndex("by_fixture", (q) => q.eq("fixtureId", fixtureId))
      .order("desc")
      .first();

    const models = await ctx.db.query("models").collect();
    const byId = new Map(models.map((m) => [m._id, m] as const));
    const slim = (id: Id<"models">) => {
      const m = byId.get(id);
      return m ? { displayName: m.displayName, color: m.color, key: m.key } : null;
    };

    const msgs = debate
      ? await ctx.db
          .query("debateMessages")
          .withIndex("by_debate_seq", (q) => q.eq("debateId", debate._id))
          .collect()
      : [];
    const messages = msgs.map((x) => ({ ...x, model: slim(x.modelId) }));

    const preds = debate
      ? await ctx.db
          .query("predictions")
          .withIndex("by_debate", (q) => q.eq("debateId", debate._id))
          .collect()
      : [];
    const predictions = preds.map((x) => ({ ...x, model: slim(x.modelId) }));

    const betDocs = await ctx.db
      .query("bets")
      .withIndex("by_fixture", (q) => q.eq("fixtureId", fixtureId))
      .collect();
    const bets = betDocs.map((x) => ({ ...x, model: slim(x.modelId) }));

    const roster = models.map((m) => ({
      key: m.key,
      displayName: m.displayName,
      color: m.color,
      tagline: m.tagline,
    }));

    return { fixture, debate, messages, predictions, bets, roster };
  },
});
