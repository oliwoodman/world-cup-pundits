import { query } from "./_generated/server";

// Money standings. Bankroll is derived from the immutable bet ledger:
// bankroll = startingBankroll - sum(all stakes) + sum(payouts of settled wins).
export const standings = query({
  args: {},
  handler: async (ctx) => {
    const models = await ctx.db.query("models").collect();
    const rows = [];
    for (const m of models) {
      const bets = await ctx.db
        .query("bets")
        .withIndex("by_model", (q) => q.eq("modelId", m._id))
        .collect();
      let staked = 0;
      let returned = 0;
      let open = 0;
      let won = 0;
      let lost = 0;
      let backing: string | null = null;
      let backingStake = 0;
      for (const b of bets) {
        staked += b.stake;
        if (b.status === "won") {
          returned += b.payout ?? 0;
          won++;
        } else if (b.status === "lost") {
          lost++;
        } else if (b.status === "void") {
          returned += b.payout ?? 0; // refunded stake
        } else if (b.status === "open") {
          open++;
        }
        // their headline tournament-winner pick: the biggest non-losing outright stake.
        if (b.kind === "outright" && b.status !== "lost" && b.stake > backingStake) {
          backing = b.selection;
          backingStake = b.stake;
        }
      }
      const card = await ctx.db
        .query("identityCards")
        .withIndex("by_model", (q) => q.eq("modelId", m._id))
        .first();
      rows.push({
        id: m._id,
        key: m.key,
        displayName: m.displayName,
        emoji: m.emoji,
        color: m.color,
        tagline: m.tagline,
        bettingStyle: m.bettingStyle,
        bankroll: Math.max(0, m.startingBankroll - staked + returned),
        staked,
        returned,
        openBets: open,
        won,
        lost,
        bankrupt: m.startingBankroll - staked + returned <= 0,
        backing,
        mood: card?.mood ?? "neutral",
        riskDial: card?.riskDial ?? 50,
        posture: card?.posture ?? "",
      });
    }
    rows.sort((a, b) => b.bankroll - a.bankroll);
    return rows;
  },
});
