import { mutation } from "./_generated/server";
import { PUNDITS } from "./pundits";

// Idempotent seed: 5 pundits + identity cards + a few sample fixtures.
export const run = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("models").first();
    if (existing) return { seeded: false, reason: "already seeded" };

    const now = Date.now();
    for (const p of PUNDITS) {
      const modelId = await ctx.db.insert("models", {
        key: p.key,
        displayName: p.displayName,
        modelSlug: p.modelSlug,
        emoji: p.emoji,
        color: p.color,
        tagline: p.tagline,
        persona: p.persona,
        bettingStyle: p.bettingStyle,
        startingBankroll: 1000,
      });
      await ctx.db.insert("identityCards", {
        modelId,
        posture: "Opening day. £1000 in the bank. Everything to prove.",
        mood: "neutral",
        riskDial: 50,
        updatedAt: now,
      });
    }

    const min = 60 * 1000;
    const hour = 60 * min;
    const day = 24 * hour;
    const fixtures = [
      { homeTeam: "Mexico", awayTeam: "Croatia", kickoffAt: now + 35 * min, stage: "Group A" },
      { homeTeam: "Brazil", awayTeam: "Germany", kickoffAt: now + 3 * hour, stage: "Group E" },
      { homeTeam: "Argentina", awayTeam: "Nigeria", kickoffAt: now + day, stage: "Group D" },
      { homeTeam: "France", awayTeam: "Japan", kickoffAt: now + 2 * day, stage: "Group C" },
    ];
    for (const f of fixtures) {
      await ctx.db.insert("fixtures", { ...f, status: "scheduled" });
    }
    return { seeded: true, models: PUNDITS.length, fixtures: fixtures.length };
  },
});
