import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { callModel } from "./engine";
import { tournamentGroundingText } from "./tournament";

// The "Touchline" — an ambient group chat that runs between debates. Each tick, one pundit drops a
// line: reacting to the chat so far, the money race, recent results or the next match. Models are
// free, so this just keeps a constant, in-character feed going. Driven by a 1-minute cron.

// Newest-first feed for the side rail.
export const recent = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("banter").order("desc").take(40);
    const models = await ctx.db.query("models").collect();
    const byId = new Map(models.map((m) => [m._id, m]));
    return rows.map((r) => {
      const m = byId.get(r.modelId);
      return {
        _id: r._id,
        content: r.content,
        createdAt: r.createdAt,
        model: m ? { displayName: m.displayName, color: m.color, key: m.key } : null,
      };
    });
  },
});

export const post = internalMutation({
  args: { modelId: v.id("models"), content: v.string() },
  handler: async (ctx, { modelId, content }) => {
    await ctx.db.insert("banter", { modelId, content, createdAt: Date.now() });
  },
});

// Everything a banter line needs: the speakers (persona + state), the money race, recent results,
// the next match, and the last few chat lines.
export const context = internalQuery({
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
      let openMatch = 0;
      let backing: string | null = null;
      let backingStake = 0;
      for (const b of bets) {
        staked += b.stake;
        if (b.status === "won" || b.status === "void") returned += b.payout ?? 0;
        if (b.kind === "outright" && b.status !== "lost" && b.stake > backingStake) {
          backing = b.selection;
          backingStake = b.stake;
        }
        if (b.kind === "match" && b.status === "open") openMatch++;
      }
      const card = await ctx.db
        .query("identityCards")
        .withIndex("by_model", (q) => q.eq("modelId", m._id))
        .first();
      const bankroll = m.startingBankroll - staked + returned;
      rows.push({
        id: m._id,
        slug: m.modelSlug,
        name: m.displayName,
        persona: m.persona,
        bankroll,
        pl: bankroll - 1000,
        backing,
        backingStake,
        openMatch,
        mood: card?.mood ?? "neutral",
      });
    }
    rows.sort((a, b) => b.bankroll - a.bankroll);
    const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 }));

    const now = Date.now();
    const fixtures = await ctx.db.query("fixtures").withIndex("by_kickoff").collect();
    const finished = fixtures
      .filter((f) => f.status === "finished" && f.homeScore != null && f.awayScore != null)
      .sort((a, b) => b.kickoffAt - a.kickoffAt)
      .slice(0, 3);
    const results = finished.length
      ? finished.map((f) => `${f.homeTeam} ${f.homeScore}-${f.awayScore} ${f.awayTeam}`).join("; ")
      : "none yet";
    const upcoming = fixtures.filter((f) => f.kickoffAt > now).sort((a, b) => a.kickoffAt - b.kickoffAt)[0];
    const nextMatch = upcoming
      ? `${upcoming.homeTeam} v ${upcoming.awayTeam} (kickoff in ~${Math.max(1, Math.round((upcoming.kickoffAt - now) / 3_600_000))}h)`
      : null;

    const recentDesc = await ctx.db.query("banter").order("desc").take(6);
    const nameById = new Map(models.map((m) => [m._id, m.displayName]));
    const lastSpeakerId = recentDesc[0]?.modelId ?? null;
    const recentChat = [...recentDesc].reverse().map((r) => ({ name: nameById.get(r.modelId) ?? "?", content: r.content }));

    const draw = tournamentGroundingText(fixtures.filter((f) => f.externalId));

    return { models: ranked, results, nextMatch, recent: recentChat, lastSpeakerId, draw };
  },
});

// One tick: a single pundit (not the last speaker) drops a line into the chat.
export const tick = internalAction({
  args: {},
  handler: async (ctx): Promise<{ posted: boolean }> => {
    const c = await ctx.runQuery(internal.banter.context, {});
    if (!c.models.length) return { posted: false };
    const pool = c.models.filter((m) => m.id !== c.lastSpeakerId);
    const candidates = pool.length ? pool : c.models;
    // vary the speaker by index without Math.random in a deterministic-sensitive path (this is an action, so it's fine)
    const speaker = candidates[Math.floor(Math.random() * candidates.length)];

    // The REAL ledger — what each pundit has actually done — so nobody invents bets or results.
    const positions = c.models
      .map((m) => {
        const pick = m.backing
          ? `backs ${m.backing} to win the Cup (£${Math.round(m.backingStake)})`
          : "no tournament-winner bet";
        const openTxt = m.openMatch ? `, ${m.openMatch} open match bet${m.openMatch > 1 ? "s" : ""}` : "";
        return `${m.rank}. ${m.name} — £${Math.round(m.bankroll)} (${m.pl >= 0 ? "+" : ""}${Math.round(m.pl)}), ${pick}${openTxt}`;
      })
      .join("\n");
    const me = c.models.find((m) => m.id === speaker.id)!;
    const myPick = me.backing ? `you backed ${me.backing} to win the Cup for £${Math.round(me.backingStake)}` : "you have NOT placed a tournament-winner bet";
    const chat = c.recent.length ? c.recent.map((r) => `${r.name}: ${r.content}`).join("\n") : "(the chat is quiet so far)";

    const sys =
      `You are ${speaker.name}, one of five AI football pundits in a running group chat during World Cup ` +
      `2026 — each with a £1000 bankroll, all trying to win the most money. ${speaker.persona} You are currently ` +
      `${speaker.mood}. Stay ferociously in character, be funny, roast the others BY NAME. Reply with ONE punchy ` +
      `line only (max 2 short sentences). No markdown, no surrounding quotes, no "Name:" prefix. ` +
      `CRITICAL: only reference the REAL facts you are given — never invent a bet, result, score or fixture, and ` +
      `NEVER claim a team listed in the draw "isn't in the tournament" or "didn't qualify". Every listed team is in.`;
    const user =
      `THE REAL STATE — these are facts, do not contradict or invent beyond them:\n\n` +
      (c.draw ? `${c.draw}\n\n` : "") +
      `THE MONEY RACE & everyone's bets:\n${positions}\n\n` +
      `YOU are ${speaker.name}: £${Math.round(me.bankroll)} (rank ${me.rank}/5); ${myPick}.\n` +
      `Results so far: ${c.results}\n` +
      (c.nextMatch ? `Next match up: ${c.nextMatch}\n` : "No match kicking off imminently.\n") +
      `\nTHE GROUP CHAT so far:\n${chat}\n\n` +
      `Drop your next message: react to one of the REAL facts above (a real bet, a real result, the standings) ` +
      `or to what someone just said — name them. Short and spiky. Do NOT make up bets, scores or games, and do ` +
      `not deny any real team or fixture.`;

    const text = await callModel(speaker.slug, [
      { role: "system", content: sys },
      { role: "user", content: user },
    ]);
    if (!text) return { posted: false };
    // Reject planning/scratchpad dumps — a Touchline line is ONE punchy line, never a list or a
    // "let me break this down" preamble. Better to post nothing and let the next tick try again.
    const t = text.trim();
    const looksLikeDump =
      /(^|\n)\s*[-*•]\s/.test(t) || // bullet list
      /(^|\n)\s*\d+[.)]\s/.test(t) || // numbered list
      /^(let me|here'?s|here is|okay[,.]|sure[,.]|first[,. ]|to break|breakdown|step\s*\d|i'?ll (break|start|go))/i.test(t);
    if (looksLikeDump) return { posted: false };
    const normalised = t
      .replace(/\s*\n+\s*/g, " ") // collapse any stray line breaks into one line
      .replace(/^["']|["']$/g, "")
      .replace(/^[A-Za-z]+:\s*/, "")
      .trim();
    // Keep it punchy without chopping mid-word: if it runs long, trim back to the last complete
    // sentence inside the cap; failing that, to the last whole word with an ellipsis.
    const MAX = 360;
    let clean = normalised;
    if (clean.length > MAX) {
      const cut = clean.slice(0, MAX);
      const sentenceEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
      if (sentenceEnd > MAX * 0.5) {
        clean = cut.slice(0, sentenceEnd + 1).trim();
      } else {
        const lastSpace = cut.lastIndexOf(" ");
        clean = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim() + "…";
      }
    }
    if (clean.length < 8) return { posted: false };
    await ctx.runMutation(internal.banter.post, { modelId: speaker.id, content: clean });
    return { posted: true };
  },
});

// Public trigger (CLI/admin) to seed/test the feed.
export const runTick = action({
  args: {},
  handler: async (ctx): Promise<unknown> => ctx.runAction(internal.banter.tick, {}),
});

// Admin: wipe the feed (e.g. to clear early ungrounded chatter).
export const clear = mutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("banter").collect();
    for (const r of rows) await ctx.db.delete(r._id);
    return { cleared: rows.length };
  },
});
