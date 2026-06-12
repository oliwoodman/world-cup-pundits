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

// Headlines via the GNews API (falls back to nothing if the key/quota is unavailable). We keep each
// article's URL so readers can click through and check the source.
async function fetchTeamNews(team: string): Promise<{ headline: string; url?: string }[]> {
  const key = process.env.GNEWS_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(
      `https://gnews.io/api/v4/search?q=${encodeURIComponent(`${team} World Cup`)}&lang=en&max=2&apikey=${key}`,
    );
    if (!res.ok) return [];
    const j = await res.json();
    return (j.articles ?? [])
      .map((a: { title?: string; url?: string }) => ({ headline: a.title, url: a.url }))
      .filter((a: { headline?: string }) => a.headline)
      .slice(0, 2);
  } catch {
    return [];
  }
}

// Talisman + star sign via TheSportsDB. We keep the player's TheSportsDB page so the birthday (and
// therefore the star sign) can be verified.
async function fetchStar(team: string): Promise<{ player: string; sign: string; url?: string } | null> {
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
    return {
      player: p.strPlayer ?? player,
      sign: starSign(mm, dd),
      url: p.idPlayer ? `https://www.thesportsdb.com/player/${p.idPlayer}` : undefined,
    };
  } catch {
    return null;
  }
}

// ---- Weather (Open-Meteo, keyless) ----------------------------------------
// The 16 host stadiums → coordinates. Keyed by a distinctive lowercase substring of the venue name
// as TheSportsDB writes it (e.g. Houston's NRG Stadium is listed under its old name "Reliant").
const VENUE_COORDS: { key: string; lat: number; lon: number }[] = [
  { key: "azteca", lat: 19.3029, lon: -99.1505 }, // Estadio Azteca, Mexico City
  { key: "akron", lat: 20.6818, lon: -103.4625 }, // Estadio Akron, Guadalajara
  { key: "bbva", lat: 25.6692, lon: -100.2444 }, // Estadio BBVA, Monterrey
  { key: "bmo", lat: 43.6332, lon: -79.4185 }, // BMO Field, Toronto
  { key: "bc place", lat: 49.2768, lon: -123.1119 }, // BC Place, Vancouver
  { key: "mercedes", lat: 33.7553, lon: -84.4006 }, // Mercedes-Benz Stadium, Atlanta
  { key: "gillette", lat: 42.0909, lon: -71.2643 }, // Gillette Stadium, Boston
  { key: "at&t", lat: 32.7473, lon: -97.0945 }, // AT&T Stadium, Dallas
  { key: "nrg", lat: 29.6847, lon: -95.4107 }, // NRG Stadium, Houston
  { key: "reliant", lat: 29.6847, lon: -95.4107 }, // (TheSportsDB's old name for NRG)
  { key: "arrowhead", lat: 39.0489, lon: -94.4839 }, // Arrowhead Stadium, Kansas City
  { key: "sofi", lat: 33.9535, lon: -118.3392 }, // SoFi Stadium, Los Angeles
  { key: "hard rock", lat: 25.958, lon: -80.2389 }, // Hard Rock Stadium, Miami
  { key: "metlife", lat: 40.8128, lon: -74.0742 }, // MetLife Stadium, New York/NJ
  { key: "lincoln financial", lat: 39.9008, lon: -75.1675 }, // Lincoln Financial Field, Philadelphia
  { key: "levi", lat: 37.403, lon: -121.9698 }, // Levi's Stadium, SF Bay Area
  { key: "lumen", lat: 47.5952, lon: -122.3316 }, // Lumen Field, Seattle
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// WMO weather code → short description (https://open-meteo.com/en/docs).
function describeCode(code: number): string {
  if (code === 0) return "clear skies";
  if (code <= 2) return "partly cloudy";
  if (code === 3) return "overcast";
  if (code <= 48) return "foggy";
  if (code <= 57) return "drizzle";
  if (code <= 67) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "rain showers";
  if (code <= 86) return "snow showers";
  return "thunderstorms";
}

// Find the fixture's stadium on TheSportsDB (real venue), map it to coordinates.
async function fetchVenueCoords(home: string, away: string): Promise<{ lat: number; lon: number } | null> {
  const key = process.env.THESPORTSDB_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`https://www.thesportsdb.com/api/v1/json/${key}/eventsseason.php?id=4429&s=2026`);
    if (!res.ok) return null;
    const j = await res.json();
    const events: { strHomeTeam?: string; strAwayTeam?: string; strVenue?: string }[] = j.events ?? [];
    const want = new Set([norm(home), norm(away)]);
    const ev = events.find((e) => {
      const h = norm(e.strHomeTeam ?? "");
      const a = norm(e.strAwayTeam ?? "");
      return want.has(h) && want.has(a) && h !== a;
    });
    if (!ev?.strVenue) return null;
    const v = ev.strVenue.toLowerCase();
    const hit = VENUE_COORDS.find((c) => v.includes(c.key));
    return hit ? { lat: hit.lat, lon: hit.lon } : null;
  } catch {
    return null;
  }
}

// Open-Meteo forecast for kickoff (keyless). Returns a short human line, or null if unavailable.
async function fetchWeather(home: string, away: string, kickoffAt: number): Promise<string | null> {
  const coords = await fetchVenueCoords(home, away);
  if (!coords) return null;
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}` +
      `&hourly=temperature_2m,weather_code,wind_speed_10m&timezone=GMT&forecast_days=3`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = await res.json();
    const times: string[] = j.hourly?.time ?? [];
    const temps: number[] = j.hourly?.temperature_2m ?? [];
    const codes: number[] = j.hourly?.weather_code ?? [];
    const winds: number[] = j.hourly?.wind_speed_10m ?? [];
    if (!times.length) return null;
    // pick the hour nearest kickoff (Open-Meteo times are GMT, "YYYY-MM-DDTHH:00")
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const diff = Math.abs(Date.parse(times[i] + "Z") - kickoffAt);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    }
    if (bestDiff > 6 * 3600 * 1000) return null; // kickoff outside the forecast horizon
    const temp = Math.round(temps[best]);
    const cond = describeCode(codes[best] ?? 0);
    const wind = winds[best] ?? 0;
    const windNote = wind >= 30 ? ", blustery" : wind >= 18 ? ", breezy" : "";
    return `${cond.charAt(0).toUpperCase() + cond.slice(1)}, ${temp}°C${windNote} at kickoff.`;
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
    return { homeTeam: f.homeTeam, awayTeam: f.awayTeam, kickoffAt: f.kickoffAt, homeForm: form(f.homeTeam), awayForm: form(f.awayTeam) };
  },
});

export const saveDossier = internalMutation({
  args: {
    fixtureId: v.id("fixtures"),
    homeRank: v.optional(v.number()),
    awayRank: v.optional(v.number()),
    homeForm: v.optional(v.string()),
    awayForm: v.optional(v.string()),
    weather: v.optional(v.string()),
    homeStar: v.optional(v.object({ player: v.string(), sign: v.string(), url: v.optional(v.string()) })),
    awayStar: v.optional(v.object({ player: v.string(), sign: v.string(), url: v.optional(v.string()) })),
    news: v.array(v.object({ team: v.string(), headline: v.string(), source: v.optional(v.string()), url: v.optional(v.string()) })),
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
    const [homeStar, awayStar, weather] = await Promise.all([
      fetchStar(fx.homeTeam),
      fetchStar(fx.awayTeam),
      fetchWeather(fx.homeTeam, fx.awayTeam, fx.kickoffAt),
    ]);
    const news = [
      ...homeNews.map((h) => ({ team: fx.homeTeam, headline: h.headline, source: "GNews", url: h.url })),
      ...awayNews.map((h) => ({ team: fx.awayTeam, headline: h.headline, source: "GNews", url: h.url })),
    ];
    await ctx.runMutation(internal.dossier.saveDossier, {
      fixtureId,
      homeRank: FIFA_RANK[fx.homeTeam],
      awayRank: FIFA_RANK[fx.awayTeam],
      homeForm: fx.homeForm || undefined,
      awayForm: fx.awayForm || undefined,
      weather: weather ?? undefined,
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
