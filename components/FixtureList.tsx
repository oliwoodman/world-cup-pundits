"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { codeFor, fmtKickoff } from "@/lib/format";

type Fixture = {
  _id: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: number;
  stage: string;
  status: string;
  homeScore?: number;
  awayScore?: number;
  debateStatus: string | null;
};

function statusText(f: Fixture): { label: string; tone: "muted" | "accent" | "down" } {
  if (f.status === "finished") return { label: "Full time", tone: "muted" };
  if (f.status === "live") return { label: "Live", tone: "down" };
  if (f.debateStatus === "running") return { label: "Pundits arguing", tone: "accent" };
  if (f.debateStatus === "locked") return { label: "Predictions in", tone: "accent" };
  const { rel } = fmtKickoff(f.kickoffAt);
  return { label: rel || "Upcoming", tone: "muted" };
}

function Team({ team, score, show, align }: { team: string; score?: number; show: boolean; align: "l" | "r" }) {
  return (
    <div className={`flex items-baseline gap-2 ${align === "r" ? "flex-row-reverse text-right" : ""}`}>
      <span className="kicker !tracking-[0.15em] text-faint">{codeFor(team)}</span>
      <span className="font-serif text-lg">{team}</span>
      {show && <span className="ml-1 font-mono text-lg tabular-nums">{score ?? 0}</span>}
    </div>
  );
}

export function FixtureList({ filter = "upcoming" }: { filter?: "upcoming" | "past" }) {
  const fixtures = useQuery(api.fixtures.list) as Fixture[] | undefined;

  if (fixtures === undefined) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded bg-surface-2" />
        ))}
      </div>
    );
  }

  // Past = finished games (most recent first); Upcoming = everything still to play (soonest first).
  const subset = fixtures
    .filter((f) => (filter === "past" ? f.status === "finished" : f.status !== "finished"))
    .sort((a, b) => (filter === "past" ? b.kickoffAt - a.kickoffAt : a.kickoffAt - b.kickoffAt));

  if (subset.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-faint">
        {filter === "past" ? "No matches have finished yet." : "No upcoming matches scheduled."}
      </p>
    );
  }

  const groups = new Map<string, Fixture[]>();
  for (const f of subset) {
    const { day } = fmtKickoff(f.kickoffAt);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(f);
  }

  const toneClass = { muted: "text-muted", accent: "text-accent", down: "text-down" } as const;

  return (
    <div className="space-y-8">
      {[...groups.entries()].map(([day, list]) => (
        <div key={day}>
          <h3 className="mb-3 font-serif text-lg font-medium text-muted">{day}</h3>
          <div className="border-t border-line">
            {list.map((f) => {
              const { time } = fmtKickoff(f.kickoffAt);
              const showScore = f.status === "finished" || f.status === "live";
              const st = statusText(f);
              return (
                <Link
                  key={f._id}
                  href={`/match/${f._id}`}
                  className="group flex items-center gap-4 border-b border-line py-4 transition-colors hover:bg-surface/50"
                >
                  <div className="w-12 shrink-0 text-center">
                    <div className="font-mono text-sm tabular-nums">{time}</div>
                    <div className="kicker !text-[0.55rem] !tracking-[0.12em]">
                      {f.stage.replace("Group ", "GRP ")}
                    </div>
                  </div>
                  <div className="flex-1 space-y-1">
                    <Team team={f.homeTeam} score={f.homeScore} show={showScore} align="l" />
                    <Team team={f.awayTeam} score={f.awayScore} show={showScore} align="l" />
                  </div>
                  <div className="w-28 shrink-0 text-right">
                    <span className={`kicker ${toneClass[st.tone]}`}>{st.label}</span>
                  </div>
                  <span className="text-faint transition-transform group-hover:translate-x-0.5">→</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
