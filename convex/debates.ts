import { v } from "convex/values";
import { query } from "./_generated/server";

// Most recent debates with their fixture, for listing.
export const recent = query({
  args: {},
  handler: async (ctx) => {
    const debates = await ctx.db.query("debates").order("desc").take(20);
    const out = [];
    for (const d of debates) {
      const fixture = await ctx.db.get(d.fixtureId);
      out.push({ ...d, fixture });
    }
    return out;
  },
});

// A single debate with its ordered transcript + locked predictions, model info attached.
export const withMessages = query({
  args: { debateId: v.id("debates") },
  handler: async (ctx, { debateId }) => {
    const debate = await ctx.db.get(debateId);
    if (!debate) return null;
    const fixture = await ctx.db.get(debate.fixtureId);
    const messages = await ctx.db
      .query("debateMessages")
      .withIndex("by_debate_seq", (q) => q.eq("debateId", debateId))
      .collect();
    const predictions = await ctx.db
      .query("predictions")
      .withIndex("by_debate", (q) => q.eq("debateId", debateId))
      .collect();

    const models = await ctx.db.query("models").collect();
    const byId = new Map(models.map((m) => [m._id, m]));
    const slim = (id: typeof models[number]["_id"]) => {
      const m = byId.get(id);
      return m ? { displayName: m.displayName, emoji: m.emoji, color: m.color } : null;
    };

    return {
      debate,
      fixture,
      messages: messages.map((x) => ({ ...x, model: slim(x.modelId) })),
      predictions: predictions.map((x) => ({ ...x, model: slim(x.modelId) })),
    };
  },
});

// Latest debate id for a fixture (for linking a fixture -> its debate).
export const latestForFixture = query({
  args: { fixtureId: v.id("fixtures") },
  handler: async (ctx, { fixtureId }) => {
    return await ctx.db
      .query("debates")
      .withIndex("by_fixture", (q) => q.eq("fixtureId", fixtureId))
      .order("desc")
      .first();
  },
});
