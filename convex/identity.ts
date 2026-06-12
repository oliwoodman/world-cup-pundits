import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { baseRiskFor } from "./pundits";

// Public admin trigger — recompute every identity card now (deploy key can't run internal fns).
export const refresh = action({
  args: {},
  handler: async (ctx): Promise<unknown> => ctx.runMutation(internal.identity.evolveAll, {}),
});

// Recompute every pundit's identity card from their ledger. Deterministic, no
// network, no randomness. The posture text + mood + risk dial are fed back into the
// next prompt, so a model on tilt argues (and bets) like it's on tilt.
export const evolveAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const models = await ctx.db.query("models").collect();
    for (const m of models) {
      const bets = await ctx.db
        .query("bets")
        .withIndex("by_model", (q) => q.eq("modelId", m._id))
        .collect();

      let staked = 0;
      let returned = 0;
      const allOdds: number[] = [];
      for (const b of bets) {
        staked += b.stake;
        if (b.status === "won" || b.status === "void") returned += b.payout ?? 0;
        if (b.odds > 0) allOdds.push(b.odds);
      }
      const bankroll = m.startingBankroll - staked + returned;
      const pl = bankroll - 1000;
      const avgOdds = allOdds.length ? allOdds.reduce((a, b) => a + b, 0) / allOdds.length : 0;
      const committedFrac = staked / m.startingBankroll; // total ever staked vs the opening purse

      const settled = bets
        .filter((b) => b.status === "won" || b.status === "lost")
        .sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0))
        .slice(0, 6);
      const wins = settled.filter((b) => b.status === "won").length;
      const losses = settled.filter((b) => b.status === "lost").length;

      // Mood from money & form.
      let mood = "neutral";
      if (bankroll <= 0) mood = "desperate";
      else if (pl > 300) mood = "smug";
      else if (pl < -300) mood = "tilting";
      else if (wins >= 3 && wins > losses) mood = "cocky";
      else if (losses >= 3) mood = "rattled";

      // Risk dial: innate appetite, moved by how aggressively they're actually betting
      // (share of bankroll committed + chasing longshots) and by tilt/desperation.
      let risk = baseRiskFor(m.key);
      if (committedFrac >= 0.5) risk += 22;
      else if (committedFrac >= 0.2) risk += 9;
      if (avgOdds >= 8) risk += 14;
      else if (avgOdds >= 4) risk += 6;
      if (pl < -300) risk += 14; // pressing to recover
      if (bankroll <= 0) risk += 22; // nothing left to lose
      if (pl > 300) risk -= 6; // protecting a lead
      const riskDial = Math.max(0, Math.min(100, Math.round(risk)));

      const flavour =
        mood === "smug"
          ? "Insufferable about it."
          : mood === "tilting"
            ? "On tilt and pressing every bet."
            : mood === "cocky"
              ? "Riding a hot streak and loving it."
              : mood === "rattled"
                ? "Shaken, second-guessing every call."
                : "Steady, for now.";
      const posture =
        bankroll <= 0
          ? `Bankrupt — £${Math.round(bankroll)} and chasing losses with nothing to lose.`
          : `£${Math.round(bankroll)} in the bank (${pl >= 0 ? "+" : ""}${Math.round(pl)}). Last 6 settled: ${wins}W-${losses}L. ${flavour}`;

      const card = await ctx.db
        .query("identityCards")
        .withIndex("by_model", (q) => q.eq("modelId", m._id))
        .first();
      const patch = { posture, mood, riskDial, updatedAt: Date.now() };
      if (card) await ctx.db.patch(card._id, patch);
      else await ctx.db.insert("identityCards", { modelId: m._id, ...patch });
    }
    return { evolved: models.length };
  },
});
