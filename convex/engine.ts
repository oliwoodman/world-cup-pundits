import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { DatabaseReader } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { start, vWorkflowId } from "@convex-dev/workflow";
import { vResultValidator } from "@convex-dev/workpool";
import { workflow } from "./workflows";
import { tournamentGroundingText } from "./tournament";

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const DEFAULT_OUTRIGHT =
  "Brazil 5.0, France 5.5, Spain 6.5, England 7.0, Argentina 8.0, Germany 9.0, Portugal 11.0, Netherlands 15.0";

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

const COMMON = (display: string) =>
  `You are ${display}, a football pundit on a chaotic AI panel predicting World Cup 2026 ` +
  `matches and betting fake money. You have a fictional £1000 bankroll for the WHOLE ` +
  `tournament and your only goal is to end with the MOST money. Stay ferociously in ` +
  `character. Be funny and opinionated, and roast the other pundits BY NAME. Keep every ` +
  `message punchy — 2 to 4 sentences. You CAN be persuaded by a genuinely good point, or ` +
  `dig in harder. Never break character, never mention being an AI, never use markdown headings.`;

// Format the research dossier into the prompt block the pundits read.
function dossierBlock(d: NonNullable<Doc<"fixtures">["dossier"]>, homeTeam: string, awayTeam: string): string {
  const lines: string[] = [];
  if (d.homeRank || d.awayRank) lines.push(`FIFA ranking: ${homeTeam} #${d.homeRank ?? "?"} vs ${awayTeam} #${d.awayRank ?? "?"}`);
  if (d.homeForm || d.awayForm) lines.push(`Form (last 5): ${homeTeam} ${d.homeForm || "—"} · ${awayTeam} ${d.awayForm || "—"}`);
  if (d.homeStar || d.awayStar) {
    const s: string[] = [];
    if (d.homeStar) s.push(`${d.homeStar.player} (${d.homeStar.sign})`);
    if (d.awayStar) s.push(`${d.awayStar.player} (${d.awayStar.sign})`);
    lines.push(`Talismen & star signs: ${s.join(" · ")}`);
  }
  if (d.weather) lines.push(`Weather at kickoff: ${d.weather}`);
  if (d.news.length) lines.push(`Latest headlines:\n${d.news.map((n) => `  • [${n.team}] ${n.headline}`).join("\n")}`);
  if (d.funFact) lines.push(d.funFact);
  if (!lines.length) return "";
  return `\n\nTHE DOSSIER (your research desk — use what sharpens your take, mock the rest):\n${lines.join("\n")}`;
}

// The pundit's evolving state, injected into every prompt so the identity card actually drives behaviour.
const stateLine = (posture: string, mood: string, riskDial: number) =>
  posture
    ? `\n\nYOUR CURRENT STATE: ${posture} (mood: ${mood}; risk dial ${riskDial}/100). Bet and argue true to this.`
    : `\n\n(Mood: ${mood}; risk dial ${riskDial}/100 — bet accordingly.)`;

function stripThink(s: string): string {
  return s
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<\/?think>/g, "")
    .trim();
}

function extractJson(raw: string): Record<string, unknown> | null {
  const cleaned = stripThink(raw);
  const s = cleaned.indexOf("{");
  const e = cleaned.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    return JSON.parse(cleaned.slice(s, e + 1));
  } catch {
    return null;
  }
}

function num(x: unknown, fallback = 0): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

const gbp = (n: number) => `£${Math.round(n)}`;

// ---- shared tournament context (what every pundit "knows") -----------------
// The money race (derived bankrolls, ranked) — the same source the leaderboard uses.
async function moneyRace(db: DatabaseReader) {
  const models = await db.query("models").collect();
  const rows: { id: Id<"models">; name: string; bankroll: number; open: number; backing: string | null; backingStake: number }[] = [];
  for (const m of models) {
    const bets = await db.query("bets").withIndex("by_model", (q) => q.eq("modelId", m._id)).collect();
    let staked = 0;
    let returned = 0;
    let open = 0;
    let backing: string | null = null;
    let backingStake = 0;
    for (const b of bets) {
      staked += b.stake;
      if (b.status === "won" || b.status === "void") returned += b.payout ?? 0;
      if (b.status === "open") open += b.stake;
      if (b.kind === "outright" && b.status !== "lost" && b.stake > backingStake) {
        backing = b.selection;
        backingStake = b.stake;
      }
    }
    rows.push({ id: m._id, name: m.displayName, bankroll: Math.max(0, m.startingBankroll - staked + returned), open, backing, backingStake });
  }
  rows.sort((a, b) => b.bankroll - a.bankroll);
  return rows;
}

// One team's tournament record so far, from finished results.
async function teamRecord(db: DatabaseReader, team: string) {
  const fixtures = await db.query("fixtures").withIndex("by_kickoff").collect();
  let p = 0, w = 0, d = 0, l = 0, gf = 0, ga = 0;
  for (const f of fixtures) {
    if (f.status !== "finished" || f.homeScore == null || f.awayScore == null) continue;
    let forGoals: number, against: number;
    if (f.homeTeam === team) [forGoals, against] = [f.homeScore, f.awayScore];
    else if (f.awayTeam === team) [forGoals, against] = [f.awayScore, f.homeScore];
    else continue;
    p++; gf += forGoals; ga += against;
    if (forGoals > against) w++; else if (forGoals < against) l++; else d++;
  }
  return { p, w, d, l, gf, ga };
}

// The briefing every pundit gets: the stakes of the whole game, the live money race,
// their own standing, and recent results — so decisions are informed, not blind.
async function buildBriefing(db: DatabaseReader, modelId: Id<"models">): Promise<string> {
  const race = await moneyRace(db);
  const myRank = race.findIndex((r) => r.id === modelId) + 1;
  const me = race.find((r) => r.id === modelId);
  const raceLines = race
    .map((r, i) => `  ${i + 1}. ${r.name} ${gbp(r.bankroll)}${r.backing ? ` — backs ${r.backing} for the Cup (${gbp(r.backingStake)})` : " — no Cup bet"}`)
    .join("\n");

  const fixtures = await db.query("fixtures").withIndex("by_kickoff").collect();
  const results = fixtures
    .filter((f) => f.status === "finished" && f.homeScore != null && f.awayScore != null)
    .sort((a, b) => b.kickoffAt - a.kickoffAt)
    .slice(0, 6);
  const resultsText = results.length
    ? results.map((f) => `${f.homeTeam} ${f.homeScore}-${f.awayScore} ${f.awayTeam}`).join("; ")
    : "None yet — the tournament has only just kicked off.";

  const myLine = me
    ? `YOU are ${me.name}: ${gbp(me.bankroll)} in the bank (rank ${myRank} of ${race.length}), ${gbp(me.open)} riding on open bets.`
    : "";

  const draw = tournamentGroundingText(fixtures.filter((f) => f.externalId));

  return (
    `THE GAME — World Cup 2026: 48 teams, 12 groups, then knockouts — well over 100 matches. You hold ` +
    `ONE £1000 bankroll for the WHOLE tournament, and dozens of matches are still to come. Your ONLY aim ` +
    `is to finish with the MOST money of the five pundits. Pace it: blow the lot early and you spend the ` +
    `tournament as a broke spectator; sit on it and you lose to whoever compounds. Going bust ends you.\n` +
    (draw ? `${draw}\n` : "") +
    `THE MONEY RACE right now:\n${raceLines}\n` +
    `${myLine}\n` +
    `RESULTS SO FAR: ${resultsText}\n` +
    `THE FLOOR: you can only ever stake money you actually have — never more than your current ` +
    `bankroll. If you hit £0 you are BANKRUPT and OUT: no more bets for the rest of the tournament, ` +
    `you just watch. So protect your downside; the aim is to finish with as much money as possible, ` +
    `not to go down in flames.`
  );
}

// One raw chat call. Throws on HTTP/network error (so callers can retry).
async function rawChat(
  slug: string,
  messages: ChatMsg[],
  opts: { maxTokens: number; temperature: number; json: boolean },
): Promise<string> {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw new Error("NVIDIA_API_KEY not set on the Convex deployment");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const body: Record<string, unknown> = {
      model: slug,
      messages,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      top_p: 0.95,
      stream: false,
    };
    if (opts.json) body.response_format = { type: "json_object" };
    const res = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    const data = await res.json();
    const m = data?.choices?.[0]?.message ?? {};
    let content: string = (m.content ?? "").trim();
    if (!content) content = (m.reasoning_content ?? "").trim();
    return stripThink(content);
  } finally {
    clearTimeout(timer);
  }
}

// A debate message: retries transient errors internally, never throws.
export async function callModel(slug: string, messages: ChatMsg[]): Promise<string> {
  for (let i = 0; i < 3; i++) {
    try {
      const out = await rawChat(slug, messages, { maxTokens: 380, temperature: 1.0, json: false });
      if (out) return out;
    } catch {
      // transient — retry
    }
  }
  return "";
}

// A structured lock call. response_format json + strip-think + ONE re-ask. Returns parsed or null.
async function callModelJson(slug: string, messages: ChatMsg[]): Promise<Record<string, unknown> | null> {
  let useJson = true;
  let convo = messages;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await rawChat(slug, convo, { maxTokens: 700, temperature: 0.4, json: useJson });
      const parsed = extractJson(raw);
      if (parsed) return parsed;
      // got a reply but it wasn't JSON — re-ask, firmly.
      convo = [
        ...messages,
        { role: "assistant", content: raw.slice(0, 200) },
        {
          role: "user",
          content:
            "That was not valid JSON. Reply with ONLY the JSON object — no prose, no roleplay, no asterisks, no markdown fences.",
        },
      ];
    } catch (e) {
      const status = (e as Error & { status?: number }).status;
      if (status === 400 && useJson) {
        useJson = false; // this model rejects response_format — fall back to prompt-only
      }
      // otherwise transient — loop and retry
    }
  }
  return null;
}

// ---- data access ----------------------------------------------------------
export const createDebate = internalMutation({
  args: { fixtureId: v.id("fixtures") },
  handler: async (ctx, { fixtureId }): Promise<{ debateId: Id<"debates">; modelIds: Id<"models">[] }> => {
    const debateId = await ctx.db.insert("debates", {
      fixtureId,
      status: "running",
      startedAt: Date.now(),
    });
    await ctx.db.patch(fixtureId, { status: "debating" });
    const models = await ctx.db.query("models").collect();
    const ids = models.map((m) => m._id);
    // shuffle speaking order (Math.random is fine in a mutation; the workflow body never does this)
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return { debateId, modelIds: ids };
  },
});

export const getTurnContext = internalQuery({
  args: { debateId: v.id("debates"), modelId: v.id("models") },
  handler: async (ctx, { debateId, modelId }) => {
    const debate = await ctx.db.get(debateId);
    const model = await ctx.db.get(modelId);
    if (!debate || !model) throw new Error("debate or model missing");
    const fixture = await ctx.db.get(debate.fixtureId);
    if (!fixture) throw new Error("fixture missing");

    const snap = fixture.oddsSnapshot;
    const odds = snap
      ? { home: snap.home, draw: snap.draw, away: snap.away }
      : { home: 2.3, draw: 3.3, away: 3.1 };
    const outright = snap?.outrightBoard ?? DEFAULT_OUTRIGHT;

    const homeRec = await teamRecord(ctx.db, fixture.homeTeam);
    const awayRec = await teamRecord(ctx.db, fixture.awayTeam);
    const fmtRec = (t: string, r: typeof homeRec) =>
      `${t}: P${r.p} ${r.w}W-${r.d}D-${r.l}L (${r.gf}-${r.ga})`;
    const formLine =
      homeRec.p || awayRec.p
        ? `Form so far — ${fmtRec(fixture.homeTeam, homeRec)} · ${fmtRec(fixture.awayTeam, awayRec)}`
        : "Form — neither side has played a match yet.";

    const briefing = await buildBriefing(ctx.db, modelId);
    const race = await moneyRace(ctx.db);
    const myBankroll = race.find((r) => r.id === modelId)?.bankroll ?? 0;
    const dossierText = fixture.dossier ? dossierBlock(fixture.dossier, fixture.homeTeam, fixture.awayTeam) : "";
    const context =
      `FIXTURE: ${fixture.homeTeam} vs ${fixture.awayTeam} — World Cup 2026, ${fixture.stage}\n` +
      `Match odds (decimal): ${fixture.homeTeam} ${odds.home} | Draw ${odds.draw} | ${fixture.awayTeam} ${odds.away}\n` +
      `${formLine}\n` +
      `Outright tournament-winner odds (decimal): ${outright}\n\n` +
      briefing +
      dossierText;

    const card = await ctx.db
      .query("identityCards")
      .withIndex("by_model", (q) => q.eq("modelId", modelId))
      .first();

    const msgs = await ctx.db
      .query("debateMessages")
      .withIndex("by_debate_seq", (q) => q.eq("debateId", debateId))
      .collect();
    const names = new Map((await ctx.db.query("models").collect()).map((m) => [m._id, m.displayName]));
    const transcript = msgs.map((x) => `${names.get(x.modelId) ?? "?"}: ${x.content}`).join("\n\n");

    return {
      context,
      model: { slug: model.modelSlug, displayName: model.displayName, persona: model.persona },
      posture: card?.posture ?? "",
      mood: card?.mood ?? "neutral",
      riskDial: card?.riskDial ?? 50,
      bankroll: myBankroll,
      transcript,
    };
  },
});

export const addMessage = internalMutation({
  args: {
    debateId: v.id("debates"),
    modelId: v.id("models"),
    round: v.number(),
    seq: v.number(),
    content: v.string(),
  },
  handler: async (ctx, a) => {
    await ctx.db.insert("debateMessages", a);
  },
});

export const lockPrediction = internalMutation({
  args: {
    debateId: v.id("debates"),
    fixtureId: v.id("fixtures"),
    modelId: v.id("models"),
    winner: v.string(),
    scoreline: v.string(),
    confidence: v.number(),
    trashTalk: v.string(),
    keyFactor: v.optional(v.string()),
    dedupeKey: v.string(),
  },
  handler: async (ctx, a) => {
    const existing = await ctx.db
      .query("predictions")
      .withIndex("by_dedupe", (q) => q.eq("dedupeKey", a.dedupeKey))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        winner: a.winner,
        scoreline: a.scoreline,
        confidence: a.confidence,
        trashTalk: a.trashTalk,
        keyFactor: a.keyFactor,
      });
      return;
    }
    await ctx.db.insert("predictions", a);
  },
});

export const placeBet = internalMutation({
  args: {
    modelId: v.id("models"),
    kind: v.string(),
    fixtureId: v.optional(v.id("fixtures")),
    market: v.string(),
    selection: v.string(),
    stake: v.number(),
    odds: v.number(),
    note: v.optional(v.string()),
    dedupeKey: v.string(),
  },
  handler: async (ctx, a) => {
    const existing = await ctx.db
      .query("bets")
      .withIndex("by_dedupe", (q) => q.eq("dedupeKey", a.dedupeKey))
      .first();
    if (existing) return;
    await ctx.db.insert("bets", {
      modelId: a.modelId,
      kind: a.kind,
      fixtureId: a.fixtureId,
      market: a.market,
      selection: a.selection,
      stake: a.stake,
      odds: a.odds,
      note: a.note,
      status: "open",
      placedAt: Date.now(),
      dedupeKey: a.dedupeKey,
    });
  },
});

export const finishDebate = internalMutation({
  args: { debateId: v.id("debates"), fixtureId: v.id("fixtures") },
  handler: async (ctx, { debateId, fixtureId }) => {
    await ctx.db.patch(debateId, { status: "locked", lockedAt: Date.now() });
    const fx = await ctx.db.get(fixtureId);
    if (fx && fx.status === "debating") await ctx.db.patch(fixtureId, { status: "locked" });
  },
});

// ---- the per-turn step actions (the only places that call NVIDIA) ----------
export const runOneTurn = internalAction({
  args: {
    debateId: v.id("debates"),
    modelId: v.id("models"),
    round: v.number(),
    seq: v.number(),
  },
  handler: async (ctx, { debateId, modelId, round, seq }) => {
    const inp = await ctx.runQuery(internal.engine.getTurnContext, { debateId, modelId });
    const sys =
      COMMON(inp.model.displayName) +
      "\n\n" +
      inp.model.persona +
      stateLine(inp.posture, inp.mood, inp.riskDial);

    let user: string;
    if (round === 1) {
      user =
        inp.context +
        "\n\nGive your OPENING take on this match: who wins, a rough scoreline, and WHY — in your voice. 2-4 sentences.";
      if (inp.transcript) user += "\n\nThe panel so far:\n" + inp.transcript;
    } else {
      user =
        inp.context +
        "\n\nHere is everything the panel has said:\n" +
        inp.transcript +
        "\n\nNow RESPOND: attack the weak takes, defend yours, and if someone actually changed " +
        "your mind, admit it (in character). Name names. 2-4 sentences.";
    }

    let text = await callModel(inp.model.slug, [
      { role: "system", content: sys },
      { role: "user", content: user },
    ]);
    if (!text) text = `[${inp.model.displayName} is having connection issues and stays suspiciously quiet.]`;

    await ctx.runMutation(internal.engine.addMessage, { debateId, modelId, round, seq, content: text });
  },
});

export const runLockTurn = internalAction({
  args: { debateId: v.id("debates"), fixtureId: v.id("fixtures"), modelId: v.id("models") },
  handler: async (ctx, { debateId, fixtureId, modelId }) => {
    const inp = await ctx.runQuery(internal.engine.getTurnContext, { debateId, modelId });
    const sys =
      COMMON(inp.model.displayName) + "\n\n" + inp.model.persona + stateLine(inp.posture, inp.mood, inp.riskDial);
    const user =
      inp.context +
      "\n\nThe argument is over. Here is the full panel:\n" +
      inp.transcript +
      "\n\nLOCK your decisions for THIS match. Stake from YOUR CURRENT bankroll (shown above) — not the " +
      "opening £1000 — and remember there are many more matches to bet. You MAY also place one " +
      "outright tournament-winner bet if you fancy it. Reply with ONLY a JSON object (json), no prose, " +
      "no roleplay, no asterisks, exactly this shape:\n" +
      '{"match_prediction":{"winner":"home|away|draw","score":"<homeGoals>-<awayGoals>","confidence":<0-100>},' +
      '"match_bets":[{"selection":"<what>","market":"<market>","stake":<gbp>,"odds":<decimal>}],' +
      '"outright_bet":{"team":"<team or empty>","odds":<decimal>,"stake":<gbp>},' +
      '"key_factor":"<the ONE thing from the dossier/odds that swung you most — a few words, e.g. \'Morocco\'s form\', \'the rain\', \'value vs the odds\'>",' +
      '"trash_talk":"<one cocky closing line>"}';

    const parsed = await callModelJson(inp.model.slug, [
      { role: "system", content: sys },
      { role: "user", content: user },
    ]);
    if (!parsed) return; // graceful: this pundit "sat this one out" (shown explicitly in the UI)

    const mp = (parsed.match_prediction ?? {}) as Record<string, unknown>;
    await ctx.runMutation(internal.engine.lockPrediction, {
      debateId,
      fixtureId,
      modelId,
      winner: String(mp.winner ?? "draw"),
      scoreline: String(mp.score ?? "?"),
      confidence: Math.max(0, Math.min(100, Math.round(num(mp.confidence, 50)))),
      trashTalk: String(parsed.trash_talk ?? ""),
      keyFactor: parsed.key_factor ? String(parsed.key_factor).slice(0, 80) : undefined,
      dedupeKey: `${debateId}:${modelId}`,
    });

    // THE FLOOR: a pundit can only stake money it actually has. Once bankrupt (£0) it's out of the
    // betting entirely — the prediction stands, but no money changes hands. Otherwise every bet is
    // clamped to the bankroll left this turn, so a pundit can bust to exactly £0 but never go negative.
    let remaining = inp.bankroll;
    if (remaining <= 0) return; // bankrupt — out of the betting for good

    const ob = (parsed.outright_bet ?? {}) as Record<string, unknown>;
    const obStake = Math.min(Math.round(num(ob.stake, 0)), remaining);
    if (ob.team && String(ob.team).trim() && obStake > 0) {
      await ctx.runMutation(internal.engine.placeBet, {
        modelId,
        kind: "outright",
        market: "outright_winner",
        selection: String(ob.team),
        stake: obStake,
        odds: num(ob.odds, 0) || 5.0,
        dedupeKey: `${debateId}:${modelId}:outright_winner:${String(ob.team)}`,
      });
      remaining -= obStake;
    }

    const mbs = Array.isArray(parsed.match_bets) ? (parsed.match_bets as Record<string, unknown>[]) : [];
    for (const b of mbs) {
      if (remaining <= 0) break; // out of money — no more bets this turn
      const stake = Math.min(Math.round(num(b.stake, 0)), remaining);
      if (stake <= 0) continue;
      const market = String(b.market ?? "match_result");
      const selection = String(b.selection ?? "?");
      await ctx.runMutation(internal.engine.placeBet, {
        modelId,
        kind: "match",
        fixtureId,
        market,
        selection,
        stake,
        odds: num(b.odds, 0) || 2.0,
        dedupeKey: `${debateId}:${modelId}:${market}:${selection}`,
      });
      remaining -= stake;
    }
  },
});

// ---- the durable workflow --------------------------------------------------
export const debateWorkflow = workflow.define({
  args: { fixtureId: v.id("fixtures") },
  handler: async (step, { fixtureId }): Promise<void> => {
    // Gather the research dossier first, so every turn reads it from the fixture.
    await step.runAction(internal.dossier.assembleForFixture, { fixtureId });
    const setup = await step.runMutation(internal.engine.createDebate, { fixtureId });
    let seq = 0;
    // Round 1 + Round 2 — sequential so each model reads the panel so far.
    for (const round of [1, 2]) {
      for (const modelId of setup.modelIds) {
        await step.runAction(internal.engine.runOneTurn, {
          debateId: setup.debateId,
          modelId,
          round,
          seq: seq++,
        });
      }
    }
    // Lock predictions + bets.
    for (const modelId of setup.modelIds) {
      await step.runAction(internal.engine.runLockTurn, {
        debateId: setup.debateId,
        fixtureId,
        modelId,
      });
    }
    await step.runMutation(internal.engine.finishDebate, { debateId: setup.debateId, fixtureId });
  },
});

export const onDebateComplete = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({ fixtureId: v.id("fixtures") }),
  },
  handler: async (ctx, { result, context }) => {
    if (result.kind === "success") return;
    const debate = await ctx.db
      .query("debates")
      .withIndex("by_fixture", (q) => q.eq("fixtureId", context.fixtureId))
      .order("desc")
      .first();
    if (debate) await ctx.db.patch(debate._id, { status: "failed" });
    await ctx.db.patch(context.fixtureId, { status: "debate_failed" });
  },
});

// ---- the tournament-winner ante -------------------------------------------
// Each pundit locks ONE "who wins the whole thing" outright bet (or passes), given the
// current real outright board. Idempotent per model via the dedupe key, so it represents a
// one-time opening call — re-run with {force:true} to let them re-pick (e.g. after a shake-up).
const anteDedupe = (modelId: Id<"models">) => `outright_ante:${modelId}`;

// Parse "France 5.7, Spain 5.7, England 8.2" → Map(team→odds), keyed lowercase.
function parseBoard(board: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const part of board.split(",")) {
    const m = part.trim().match(/^(.+?)\s+([\d.]+)$/);
    if (m) {
      const odds = Number(m[2]);
      if (Number.isFinite(odds) && odds > 1) map.set(m[1].trim().toLowerCase(), odds);
    }
  }
  return map;
}

export const getAnteContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    const models = await ctx.db.query("models").collect();
    // Use the most recent outright board cached on any fixture snapshot, else the mock.
    let board = DEFAULT_OUTRIGHT;
    let newest = 0;
    for (const f of await ctx.db.query("fixtures").collect()) {
      const snap = f.oddsSnapshot;
      if (snap?.outrightBoard && snap.fetchedAt > newest) {
        board = snap.outrightBoard;
        newest = snap.fetchedAt;
      }
    }
    const out = [];
    for (const m of models) {
      const bets = await ctx.db
        .query("bets")
        .withIndex("by_model", (q) => q.eq("modelId", m._id))
        .collect();
      let staked = 0;
      let returned = 0;
      let hasAnte = false;
      for (const b of bets) {
        staked += b.stake;
        if (b.status === "won" || b.status === "void") returned += b.payout ?? 0;
        if (b.dedupeKey === anteDedupe(m._id)) hasAnte = true;
      }
      const card = await ctx.db
        .query("identityCards")
        .withIndex("by_model", (q) => q.eq("modelId", m._id))
        .first();
      out.push({
        id: m._id,
        slug: m.modelSlug,
        displayName: m.displayName,
        persona: m.persona,
        bettingStyle: m.bettingStyle,
        bankroll: m.startingBankroll - staked + returned,
        posture: card?.posture ?? "",
        mood: card?.mood ?? "neutral",
        riskDial: card?.riskDial ?? 50,
        briefing: await buildBriefing(ctx.db, m._id),
        hasAnte,
      });
    }
    return { board, models: out };
  },
});

// Admin trigger — run the ante for every pundit who hasn't picked yet.
export const runOutrightAnte = action({
  args: { force: v.optional(v.boolean()) },
  handler: async (ctx, { force }): Promise<{ picks: number; skipped: number }> => {
    const { board, models } = await ctx.runQuery(internal.engine.getAnteContext, {});
    const boardMap = parseBoard(board);

    // Run all pundits concurrently — each isolated, so one slow/failed model can't abort the batch.
    const results = await Promise.all(
      models.map(async (m): Promise<"pick" | "skipped"> => {
        if (m.hasAnte && !force) return "skipped";
        try {
          const sys =
            COMMON(m.displayName) +
            "\n\n" +
            m.persona +
            "\n\nYour betting ethos: " +
            m.bettingStyle +
            stateLine(m.posture, m.mood, m.riskDial);
          const cap = Math.floor(m.bankroll * 0.5);
          const user =
            `${m.briefing}\n\n` +
            `THE ANTE-POST MARKET — back who LIFTS THE TROPHY.\n` +
            `Tournament-winner odds (decimal): ${board}\n\n` +
            `Whatever you stake here is locked away from match betting until the final, so you must keep ` +
            `something back for the matches. You may stake UP TO HALF your bankroll on this — a maximum of ` +
            `£${cap} — sized to YOUR character (a disciplined head risks little, a degenerate pushes the ` +
            `full half). Pick exactly ONE team to win the whole thing, or pass if nothing offers value. ` +
            `Reply with ONLY a JSON object, no prose: ` +
            `{"team":"<team name exactly as listed, or empty to pass>","odds":<decimal>,"stake":<gbp up to ${cap}, 0 to pass>,"reason":"<one cocky line on why them>"}`;

          const parsed = await callModelJson(m.slug, [
            { role: "system", content: sys },
            { role: "user", content: user },
          ]);
          if (!parsed) return "skipped";

          const team = String(parsed.team ?? "").trim();
          const stake = num(parsed.stake, 0);
          if (!team || stake <= 0) return "skipped";

          // Ground the odds in the real board where we can; else trust the model, clamped.
          const stated = num(parsed.odds, 0);
          const odds = boardMap.get(team.toLowerCase()) ?? (stated > 1.1 ? Math.min(stated, 151) : 21);
          // Hard cap: no more than half the bankroll on a single outright (keeps everyone liquid for matches).
          const finalStake = Math.min(Math.round(stake), Math.max(0, cap));
          if (finalStake <= 0) return "skipped";

          await ctx.runMutation(internal.engine.placeBet, {
            modelId: m.id,
            kind: "outright",
            market: "outright_winner",
            selection: team,
            stake: finalStake,
            odds,
            note: String(parsed.reason ?? "").slice(0, 240),
            dedupeKey: anteDedupe(m.id),
          });
          return "pick";
        } catch (e) {
          console.warn(`[ante] ${m.displayName} failed:`, e);
          return "skipped";
        }
      }),
    );

    const picks = results.filter((r) => r === "pick").length;
    // Re-evolve identity cards so the risk dials reflect the new stakes immediately.
    await ctx.runMutation(internal.identity.evolveAll, {});
    return { picks, skipped: results.length - picks };
  },
});

// Transparency: exactly what a pundit "sees" for a fixture (system prompt + match context).
export const briefingPreview = query({
  args: { fixtureId: v.id("fixtures"), modelKey: v.string() },
  handler: async (ctx, { fixtureId, modelKey }) => {
    const model = await ctx.db
      .query("models")
      .withIndex("by_key", (q) => q.eq("key", modelKey))
      .first();
    const fixture = await ctx.db.get(fixtureId);
    if (!model || !fixture) return null;
    const snap = fixture.oddsSnapshot;
    const odds = snap ? { home: snap.home, draw: snap.draw, away: snap.away } : { home: 2.3, draw: 3.3, away: 3.1 };
    const outright = snap?.outrightBoard ?? DEFAULT_OUTRIGHT;
    const card = await ctx.db
      .query("identityCards")
      .withIndex("by_model", (q) => q.eq("modelId", model._id))
      .first();
    const homeRec = await teamRecord(ctx.db, fixture.homeTeam);
    const awayRec = await teamRecord(ctx.db, fixture.awayTeam);
    const fmtRec = (t: string, r: typeof homeRec) => `${t}: P${r.p} ${r.w}W-${r.d}D-${r.l}L (${r.gf}-${r.ga})`;
    const formLine =
      homeRec.p || awayRec.p
        ? `Form so far — ${fmtRec(fixture.homeTeam, homeRec)} · ${fmtRec(fixture.awayTeam, awayRec)}`
        : "Form — neither side has played a match yet.";
    const briefing = await buildBriefing(ctx.db, model._id);
    const dossierText = fixture.dossier ? dossierBlock(fixture.dossier, fixture.homeTeam, fixture.awayTeam) : "";
    const system = COMMON(model.displayName) + "\n\n" + model.persona + stateLine(card?.posture ?? "", card?.mood ?? "neutral", card?.riskDial ?? 50);
    const matchContext =
      `FIXTURE: ${fixture.homeTeam} vs ${fixture.awayTeam} — World Cup 2026, ${fixture.stage}\n` +
      `Match odds (decimal): ${fixture.homeTeam} ${odds.home} | Draw ${odds.draw} | ${fixture.awayTeam} ${odds.away}\n` +
      `${formLine}\n` +
      `Outright tournament-winner odds (decimal): ${outright}\n\n` +
      briefing +
      dossierText;
    return { system, matchContext };
  },
});

// Manual trigger (CLI/admin) — kicks off the durable debate workflow for a fixture.
export const runDebateNow = mutation({
  args: { fixtureId: v.id("fixtures") },
  handler: async (ctx, { fixtureId }): Promise<{ workflowId: string }> => {
    const workflowId = await start(
      ctx,
      internal.engine.debateWorkflow,
      { fixtureId },
      { onComplete: internal.engine.onDebateComplete, context: { fixtureId } },
    );
    return { workflowId };
  },
});
