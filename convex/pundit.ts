import { v } from "convex/values";
import { query } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// Everything the pundit identity-card page needs: the character, the evolving card,
// derived bankroll + league rank, the full bet ledger (joined to fixtures), the
// tournament-winner picks, and the prediction history (with did-it-land once settled).
export const detail = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const model = await ctx.db
      .query("models")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (!model) return null;

    const models = await ctx.db.query("models").collect();

    // Bankroll for everyone, so we can rank this pundit in the money race.
    const ranked: { id: Id<"models">; bankroll: number }[] = [];
    for (const m of models) {
      const bs = await ctx.db
        .query("bets")
        .withIndex("by_model", (q) => q.eq("modelId", m._id))
        .collect();
      let staked = 0;
      let returned = 0;
      for (const b of bs) {
        staked += b.stake;
        if (b.status === "won" || b.status === "void") returned += b.payout ?? 0;
      }
      ranked.push({ id: m._id, bankroll: m.startingBankroll - staked + returned });
    }
    ranked.sort((a, b) => b.bankroll - a.bankroll);
    const rank = ranked.findIndex((r) => r.id === model._id) + 1;

    // This pundit's bets, newest first.
    const myBets = await ctx.db
      .query("bets")
      .withIndex("by_model", (q) => q.eq("modelId", model._id))
      .collect();
    myBets.sort((a, b) => b.placedAt - a.placedAt);

    let staked = 0;
    let returned = 0;
    let open = 0;
    let won = 0;
    let lost = 0;
    let voided = 0;
    for (const b of myBets) {
      staked += b.stake;
      if (b.status === "won") {
        returned += b.payout ?? 0;
        won++;
      } else if (b.status === "lost") {
        lost++;
      } else if (b.status === "void") {
        returned += b.payout ?? 0;
        voided++;
      } else {
        open++;
      }
    }
    const bankroll = model.startingBankroll - staked + returned;

    // Predictions table has no by_model index; N is small (≤ one row per debate), so collect + filter.
    const myPreds = (await ctx.db.query("predictions").collect()).filter((p) => p.modelId === model._id);

    // Fetch every fixture referenced by a bet or a prediction, once.
    const fixtureIds = new Set<Id<"fixtures">>();
    for (const b of myBets) if (b.fixtureId) fixtureIds.add(b.fixtureId);
    for (const p of myPreds) fixtureIds.add(p.fixtureId);
    const fxMap = new Map<
      string,
      {
        _id: Id<"fixtures">;
        homeTeam: string;
        awayTeam: string;
        kickoffAt: number;
        stage: string;
        status: string;
        homeScore?: number;
        awayScore?: number;
      }
    >();
    for (const fid of fixtureIds) {
      const f = await ctx.db.get(fid);
      if (f) {
        fxMap.set(fid, {
          _id: f._id,
          homeTeam: f.homeTeam,
          awayTeam: f.awayTeam,
          kickoffAt: f.kickoffAt,
          stage: f.stage,
          status: f.status,
          homeScore: f.homeScore,
          awayScore: f.awayScore,
        });
      }
    }

    const bets = myBets.map((b) => ({
      _id: b._id,
      kind: b.kind,
      market: b.market,
      selection: b.selection,
      stake: b.stake,
      odds: b.odds,
      status: b.status,
      payout: b.payout ?? null,
      note: b.note ?? null,
      placedAt: b.placedAt,
      settledAt: b.settledAt ?? null,
      fixture: b.fixtureId ? fxMap.get(b.fixtureId) ?? null : null,
    }));

    const outrights = bets.filter((b) => b.kind === "outright");

    const calls = myPreds
      .map((p) => {
        const f = fxMap.get(p.fixtureId) ?? null;
        let landed: boolean | null = null;
        if (f && f.status === "finished" && f.homeScore != null && f.awayScore != null) {
          const res = f.homeScore > f.awayScore ? "home" : f.awayScore > f.homeScore ? "away" : "draw";
          landed = p.winner === res;
        }
        return {
          _id: p._id,
          winner: p.winner,
          scoreline: p.scoreline,
          confidence: p.confidence,
          trashTalk: p.trashTalk,
          fixture: f,
          landed,
        };
      })
      .sort((a, b) => (b.fixture?.kickoffAt ?? 0) - (a.fixture?.kickoffAt ?? 0));

    const card = await ctx.db
      .query("identityCards")
      .withIndex("by_model", (q) => q.eq("modelId", model._id))
      .first();

    return {
      model: {
        key: model.key,
        displayName: model.displayName,
        color: model.color,
        tagline: model.tagline,
        bettingStyle: model.bettingStyle,
        persona: model.persona,
        modelSlug: model.modelSlug,
      },
      card: card
        ? { posture: card.posture, mood: card.mood, riskDial: card.riskDial, updatedAt: card.updatedAt }
        : null,
      stats: {
        bankroll,
        pl: bankroll - 1000,
        rank,
        total: models.length,
        staked,
        returned,
        open,
        won,
        lost,
        voided,
        betCount: myBets.length,
      },
      outrights,
      bets,
      calls,
    };
  },
});
