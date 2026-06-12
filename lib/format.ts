const CODES: Record<string, string> = {
  Brazil: "BRA",
  Germany: "GER",
  Mexico: "MEX",
  Croatia: "CRO",
  Argentina: "ARG",
  Nigeria: "NGA",
  France: "FRA",
  Japan: "JPN",
  Spain: "ESP",
  England: "ENG",
  Portugal: "POR",
  Netherlands: "NED",
};

// 3-letter country code (FIFA-style) instead of flag emojis.
export const codeFor = (team: string): string =>
  CODES[team] ?? team.slice(0, 3).toUpperCase();

// Single serif initial for a pundit's brand mark.
export const monogramFor = (name: string): string => (name.trim()[0] ?? "?").toUpperCase();

export const money = (n: number): string =>
  (n < 0 ? "−£" : "£") + Math.abs(Math.round(n)).toLocaleString("en-GB");

export const signedMoney = (n: number): string =>
  (n >= 0 ? "+£" : "−£") + Math.abs(Math.round(n)).toLocaleString("en-GB");

export type Kickoff = { time: string; day: string; rel: string };

export function fmtKickoff(ms: number): Kickoff {
  const d = new Date(ms);
  const now = Date.now();
  const diff = ms - now;

  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  const today = new Date(now);
  const tomorrow = new Date(now + 86_400_000);
  let day = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  if (d.toDateString() === today.toDateString()) day = "Today";
  else if (d.toDateString() === tomorrow.toDateString()) day = "Tomorrow";

  let rel = "";
  if (diff > 0 && diff < 3_600_000) rel = `in ${Math.max(1, Math.round(diff / 60_000))} min`;
  else if (diff > 0 && diff < 86_400_000) rel = `in ${Math.round(diff / 3_600_000)}h`;

  return { time, day, rel };
}

export function winnerLabel(winner: string, home: string, away: string): string {
  if (winner === "home") return home;
  if (winner === "away") return away;
  return "Draw";
}

// 1 → "1st", 2 → "2nd" …
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

// Short calendar date, e.g. "12 Jun".
export const shortDate = (ms: number): string =>
  new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
