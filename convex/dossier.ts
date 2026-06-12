import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

// The pundits' research dossier: real signals gathered at debate time, cached on the fixture, fed
// into the debate prompt (the models decide what to use) and shown on the match page as "The Dossier".
// Sources: FIFA ranking (built-in) · form (computed from our own results) · news (GNews) · talisman
// star sign (TheSportsDB) · a tongue-in-cheek astro line. (Weather needs venue data — added later;
// API-Football's free plan doesn't cover the 2026 season.)

// FIFA world ranking (approx) for the 48 finalists — a fun tale-of-the-tape input.
const FIFA_RANK: Record<string, number> = {
  Spain: 2, Argentina: 1, France: 3, England: 4, Brazil: 5, Portugal: 6, Netherlands: 7, Belgium: 8,
  Germany: 10, Croatia: 9, Italy: 11, Morocco: 12, Colombia: 13, Uruguay: 14, USA: 16, Mexico: 17,
  Switzerland: 19, Japan: 18, Senegal: 20, Iran: 21, Denmark: 22, Austria: 23, "South Korea": 24,
  Australia: 25, Ecuador: 26, Norway: 28, Turkey: 27, Panama: 30, Egypt: 32, Sweden: 38, Wales: 31,
  Scotland: 36, "Ivory Coast": 40, Canada: 33, Qatar: 35, "Saudi Arabia": 58, Tunisia: 41, Algeria: 37,
  Paraguay: 39, Uzbekistan: 52, Jordan: 64, Iraq: 57, "South Africa": 60, "DR Congo": 56, Ghana: 71,
  "Cape Verde": 70, "Curaçao": 82, Haiti: 90, "New Zealand": 88, "Bosnia & Herzegovina": 74, "Czech Republic": 44,
};

// One recognisable talisman per team — we look up their birthday on TheSportsDB to get a star sign.
const TALISMAN: Record<string, string> = {
  Mexico: "Raul Jimenez", "South Korea": "Son Heung-Min", "South Africa": "Percy Tau", "Czech Republic": "Patrik Schick",
  Canada: "Alphonso Davies", Switzerland: "Granit Xhaka", Qatar: "Akram Afif", "Bosnia & Herzegovina": "Edin Dzeko",
  Brazil: "Vinicius Junior", Morocco: "Achraf Hakimi", Haiti: "Frantzdy Pierrot", Scotland: "Scott McTominay",
  USA: "Christian Pulisic", Paraguay: "Miguel Almiron", Australia: "Mathew Ryan", Turkey: "Hakan Calhanoglu",
  Germany: "Jamal Musiala", "Curaçao": "Leandro Bacuna", Ecuador: "Moises Caicedo", "Ivory Coast": "Sebastien Haller",
  Netherlands: "Virgil van Dijk", Japan: "Takefusa Kubo", Sweden: "Alexander Isak", Tunisia: "Hannibal Mejbri",
  Belgium: "Kevin De Bruyne", Egypt: "Mohamed Salah", Iran: "Mehdi Taremi", "New Zealand": "Chris Wood",
  Spain: "Lamine Yamal", "Cape Verde": "Ryan Mendes", "Saudi Arabia": "Salem Al-Dawsari", Uruguay: "Federico Valverde",
  France: "Kylian Mbappe", Senegal: "Sadio Mane", Iraq: "Aymen Hussein", Norway: "Erling Haaland",
  Argentina: "Lionel Messi", Algeria: "Riyad Mahrez", Austria: "David Alaba", Jordan: "Mousa Al-Tamari",
  Portugal: "Cristiano Ronaldo", Colombia: "Luis Diaz", "DR Congo": "Yoane Wissa", Uzbekistan: "Eldor Shomurodov",
  England: "Jude Bellingham", Croatia: "Luka Modric", Ghana: "Mohammed Kudus", Panama: "Adalberto Carrasquilla",
};

// Date → zodiac sign. Z[month-1] = [last day of the "before" sign, before, from].
const Z: [number, string, string][] = [
  [19, "Capricorn", "Aquarius"], [18, "Aquarius", "Pisces"], [20, "Pisces", "Aries"], [19, "Aries", "Taurus"],
  [20, "Taurus", "Gemini"], [20, "Gemini", "Cancer"], [22, "Cancer", "Leo"], [22, "Leo", "Virgo"],
  [22, "Virgo", "Libra"], [22, "Libra", "Scorpio"], [21, "Scorpio", "Sagittarius"], [21, "Sagittarius", "Capricorn"],
];
function starSign(month: number, day: number): string {
  const [cut, before, from] = Z[month - 1];
  return day <= cut ? before : from;
}

// Silly, deterministic "cosmic angle" — pure entertainment for the pundits to seize or mock.
const SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
const OMENS = [
  "Mercury is in retrograde — expect a defensive howler.",
  "the stars favour an underdog ambush after the hour mark.",
  "a full moon over the host city: chaos and late goals.",
  "the numbers align for a nervy, cagey low-scorer.",
  "cosmic energy says someone bottles a penalty.",
];
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function funFactFor(home: string, away: string): string {
  const h = hash(home + away);
  return `Astro corner (for fun): it's ${SIGNS[h % SIGNS.length]} season and ${OMENS[(h >> 4) % OMENS.length]}`;
}

// Headlines via the GNews API (falls back to nothing if the key/quota is unavailable).
async function fetchTeamNews(team: string): Promise<string[]> {
  const key = process.env.GNEWS_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(
      `https://gnews.io/api/v4/search?q=${encodeURIComponent(`${team} World Cup`)}&lang=en&max=2&apikey=${key}`,
    );
    if (!res.ok) return [];
    const j = await res.json();
    return (j.articles ?? []).map((a: { title?: string }) => a.title).filter(Boolean).slice(0, 2);
  } catch {
    return [];
  }
}

// Talisman + star sign via TheSportsDB.
async function fetchStar(team: string): Promise<{ player: string; sign: string } | null> {
  const key = process.env.THESPORTSDB_KEY;
  const player = TALISMAN[team];
  if (!key || !player) return null;
  try {
    const res = await fetch(
      `https://www.thesportsdb.com/api/v1/json/${key}/searchplayers.php?p=${encodeURIComponent(player)}`,
    );
    if (!res.ok) return null;
    const j = await res.json();
    const p = j.player?.[0];
    if (!p?.dateBorn) return null;
    const [, mm, dd] = String(p.dateBorn).split("-").map(Number);
    if (!mm || !dd) return null;
    return { player: p.strPlayer ?? player, sign: starSign(mm, dd) };
  } catch {
    return null;
  }
}

// Teams + their last-5 form, computed from our own finished results (keyless, tournament-accurate).
export const getFixtureContext = internalQuery({
  args: { fixtureId: v.id("fixtures") },
  handler: async (ctx, { fixtureId }) => {
    const f = await ctx.db.get(fixtureId);
    if (!f) return null;
    const fixtures = await ctx.db.query("fixtures").withIndex("by_kickoff").collect();
    const form = (team: string): string =>
      fixtures
        .filter((x) => x.status === "finished" && x.homeScore != null && x.awayScore != null && (x.homeTeam === team || x.awayTeam === team))
        .sort((a, b) => a.kickoffAt - b.kickoffAt)
        .slice(-5)
        .map((x) => {
          const home = x.homeTeam === team;
          const gf = (home ? x.homeScore : x.awayScore) as number;
          const ga = (home ? x.awayScore : x.homeScore) as number;
          return gf > ga ? "W" : gf < ga ? "L" : "D";
        })
        .join("");
    return { homeTeam: f.homeTeam, awayTeam: f.awayTeam, homeForm: form(f.homeTeam), awayForm: form(f.awayTeam) };
  },
});

export const saveDossier = internalMutation({
  args: {
    fixtureId: v.id("fixtures"),
    homeRank: v.optional(v.number()),
    awayRank: v.optional(v.number()),
    homeForm: v.optional(v.string()),
    awayForm: v.optional(v.string()),
    homeStar: v.optional(v.object({ player: v.string(), sign: v.string() })),
    awayStar: v.optional(v.object({ player: v.string(), sign: v.string() })),
    news: v.array(v.object({ team: v.string(), headline: v.string(), source: v.optional(v.string()) })),
    funFact: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const { fixtureId, ...rest } = a;
    await ctx.db.patch(fixtureId, { dossier: { ...rest, builtAt: Date.now() } });
  },
});

// Gather the dossier for a fixture. Never throws — partial data is fine.
export const assembleForFixture = internalAction({
  args: { fixtureId: v.id("fixtures") },
  handler: async (ctx, { fixtureId }): Promise<{ ok: boolean; headlines: number }> => {
    const fx = await ctx.runQuery(internal.dossier.getFixtureContext, { fixtureId });
    if (!fx) return { ok: false, headlines: 0 };
    // News sequentially (GNews free tier rate-limits concurrent calls); star lookups can be parallel.
    const homeNews = await fetchTeamNews(fx.homeTeam);
    const awayNews = await fetchTeamNews(fx.awayTeam);
    const [homeStar, awayStar] = await Promise.all([fetchStar(fx.homeTeam), fetchStar(fx.awayTeam)]);
    const news = [
      ...homeNews.map((h) => ({ team: fx.homeTeam, headline: h, source: "GNews" })),
      ...awayNews.map((h) => ({ team: fx.awayTeam, headline: h, source: "GNews" })),
    ];
    await ctx.runMutation(internal.dossier.saveDossier, {
      fixtureId,
      homeRank: FIFA_RANK[fx.homeTeam],
      awayRank: FIFA_RANK[fx.awayTeam],
      homeForm: fx.homeForm || undefined,
      awayForm: fx.awayForm || undefined,
      homeStar: homeStar ?? undefined,
      awayStar: awayStar ?? undefined,
      news,
      funFact: funFactFor(fx.homeTeam, fx.awayTeam),
    });
    return { ok: true, headlines: news.length };
  },
});

// Public trigger (CLI/admin testing).
export const runAssemble = action({
  args: { fixtureId: v.id("fixtures") },
  handler: async (ctx, { fixtureId }): Promise<unknown> =>
    ctx.runAction(internal.dossier.assembleForFixture, { fixtureId }),
});
