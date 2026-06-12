"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { codeFor, fmtKickoff } from "@/lib/format";

type Standing = {
  team: string;
  p: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
};
type GFixture = {
  _id: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: number;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  debateStatus: string | null;
};
type Group = { label: string; minKo: number; standings: Standing[]; fixtures: GFixture[] };

function fixtureBadge(f: GFixture): { text: string; tone: string } {
  if (f.status === "finished") return { text: "FT", tone: "text-faint" };
  if (f.status === "live") return { text: "LIVE", tone: "text-down" };
  if (f.debateStatus === "running") return { text: "Arguing", tone: "text-accent" };
  if (f.debateStatus === "locked") return { text: "Picks in", tone: "text-accent" };
  const { rel } = fmtKickoff(f.kickoffAt);
  return { text: rel || fmtKickoff(f.kickoffAt).time, tone: "text-faint" };
}

function GroupCard({ g }: { g: Group }) {
  const anyPlayed = g.standings.some((s) => s.p > 0);
  return (
    <div className="flex flex-col border border-line bg-surface/40">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="font-serif text-base font-semibold tracking-tight">Group {g.label}</span>
        <span className="kicker text-faint">{anyPlayed ? "Table" : "To play"}</span>
      </div>

      {/* Mini-table */}
      <div className="px-4 pt-3">
        <div className="flex items-center gap-2 pb-1.5 text-[10px] uppercase tracking-[0.14em] text-faint">
          <span className="w-4" />
          <span className="flex-1">Team</span>
          <span className="w-6 text-right">P</span>
          <span className="w-7 text-right">GD</span>
          <span className="w-7 text-right">Pts</span>
        </div>
        {g.standings.map((s, i) => (
          <div
            key={s.team}
            className={`flex items-center gap-2 border-t border-line/60 py-1.5 ${i < 2 ? "" : "opacity-70"}`}
          >
            <span className={`w-4 text-center font-mono text-[11px] tabular-nums ${i < 2 ? "text-accent" : "text-faint"}`}>
              {i + 1}
            </span>
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
              <span className="kicker !tracking-[0.1em] text-faint">{codeFor(s.team)}</span>
              <span className="truncate text-[13px]">{s.team}</span>
            </span>
            <span className="w-6 text-right font-mono text-[12px] tabular-nums text-muted">{s.p}</span>
            <span className="w-7 text-right font-mono text-[12px] tabular-nums text-muted">
              {s.gd > 0 ? `+${s.gd}` : s.gd}
            </span>
            <span className="w-7 text-right font-mono text-[13px] tabular-nums">{s.pts}</span>
          </div>
        ))}
      </div>

      {/* Fixtures */}
      <div className="mt-3 border-t border-line">
        {g.fixtures.map((f) => {
          const badge = fixtureBadge(f);
          const showScore = f.status === "finished" || f.status === "live";
          return (
            <Link
              key={f._id}
              href={`/match/${f._id}`}
              className="group flex items-center gap-2 border-b border-line/60 px-4 py-2 last:border-b-0 transition-colors hover:bg-surface/60"
            >
              <span className="flex-1 truncate text-[12.5px]">
                {codeFor(f.homeTeam)}{" "}
                {showScore && <span className="font-mono tabular-nums">{f.homeScore ?? 0}</span>}
                <span className="text-faint"> v </span>
                {showScore && <span className="font-mono tabular-nums">{f.awayScore ?? 0}</span>}{" "}
                {codeFor(f.awayTeam)}
              </span>
              <span className={`kicker !text-[0.55rem] ${badge.tone}`}>{badge.text}</span>
              <span className="text-faint transition-transform group-hover:translate-x-0.5">→</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function GroupBoard() {
  const groups = useQuery(api.groups.list) as Group[] | undefined;

  if (groups === undefined) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-72 animate-pulse rounded bg-surface-2" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map((g) => (
        <GroupCard key={g.label} g={g} />
      ))}
    </div>
  );
}
