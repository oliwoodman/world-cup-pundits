import { action } from "./_generated/server";

// One-off connectivity probes for the external data APIs. Public so the deploy key can run it.
// Run: npx convex run probes:probeAll

async function tryFetch(
  url: string,
  opts?: RequestInit,
): Promise<{ ok: boolean; status: number; json: any; text: string; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { ok: res.ok, status: res.status, json, text: text.slice(0, 280) };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: "", error: String(e) };
  } finally {
    clearTimeout(timer);
  }
}

export const probeAll = action({
  args: {},
  handler: async (): Promise<Record<string, unknown>> => {
    const out: Record<string, unknown> = {};

    // --- GNews ---
    const gkey = process.env.GNEWS_API_KEY;
    if (!gkey) out.gnews = { configured: false };
    else {
      const r = await tryFetch(
        `https://gnews.io/api/v4/search?q=${encodeURIComponent("Brazil World Cup")}&lang=en&max=2&apikey=${gkey}`,
      );
      out.gnews = {
        configured: true,
        ok: r.ok,
        status: r.status,
        totalArticles: r.json?.totalArticles,
        sample: r.json?.articles?.[0]?.title ?? r.json?.errors ?? r.text,
      };
    }

    // --- API-Football (API-Sports direct) ---
    const fkey = process.env.API_FOOTBALL_KEY;
    if (!fkey) out.apiFootball = { configured: false };
    else {
      const r = await tryFetch(`https://v3.football.api-sports.io/status`, {
        headers: { "x-apisports-key": fkey },
      });
      out.apiFootball = {
        configured: true,
        ok: r.ok,
        status: r.status,
        account: r.json?.response?.account,
        subscription: r.json?.response?.subscription,
        requests: r.json?.response?.requests,
        errors: r.json?.errors && Object.keys(r.json.errors).length ? r.json.errors : undefined,
        raw: r.json ? undefined : r.text,
      };
    }

    // --- TheSportsDB ---
    const skey = process.env.THESPORTSDB_KEY;
    if (!skey) out.sportsdb = { configured: false };
    else {
      const r = await tryFetch(
        `https://www.thesportsdb.com/api/v1/json/${skey}/searchplayers.php?p=${encodeURIComponent("Lionel Messi")}`,
      );
      const p = r.json?.player?.[0];
      out.sportsdb = {
        configured: true,
        ok: r.ok,
        status: r.status,
        sample: p
          ? { name: p.strPlayer, born: p.dateBorn, nationality: p.strNationality, team: p.strTeam }
          : r.text,
      };
    }

    // --- Open-Meteo (keyless) ---
    const r = await tryFetch(
      `https://api.open-meteo.com/v1/forecast?latitude=25.67&longitude=-100.31&current=temperature_2m,precipitation,wind_speed_10m`,
    );
    out.openMeteo = { keyless: true, ok: r.ok, status: r.status, sample: r.json?.current ?? r.text };

    return out;
  },
});

// Probe the API-Football World Cup fixtures so we can build the matcher (league/season, team
// names as the API spells them, venue shape, ids). Run: npx convex run probes:probeFootballFixtures
export const probeFootballFixtures = action({
  args: {},
  handler: async (): Promise<Record<string, unknown>> => {
    const key = process.env.API_FOOTBALL_KEY;
    if (!key) return { configured: false };
    const r = await tryFetch(`https://v3.football.api-sports.io/fixtures?league=1&season=2026`, {
      headers: { "x-apisports-key": key },
    });
    const arr = r.json?.response ?? [];
    const samples = arr.slice(0, 6).map((f: any) => ({
      afFixtureId: f.fixture?.id,
      date: f.fixture?.date,
      venue: f.fixture?.venue,
      home: { id: f.teams?.home?.id, name: f.teams?.home?.name },
      away: { id: f.teams?.away?.id, name: f.teams?.away?.name },
    }));
    const allTeams = new Set<string>();
    for (const f of arr) {
      if (f.teams?.home?.name) allTeams.add(f.teams.home.name);
      if (f.teams?.away?.name) allTeams.add(f.teams.away.name);
    }
    return {
      ok: r.ok,
      status: r.status,
      count: arr.length,
      errors: r.json?.errors && Object.keys(r.json.errors).length ? r.json.errors : undefined,
      teamNames: [...allTeams].sort(),
      samples,
    };
  },
});
