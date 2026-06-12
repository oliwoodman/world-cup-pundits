"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PunditMark } from "@/components/PunditMark";
import { RiskDial } from "@/components/RiskDial";
import { money, signedMoney, ordinal, shortDate, winnerLabel } from "@/lib/format";

type Fixture = {
  _id: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: number;
  stage: string;
  status: string;
  homeScore?: number;
  awayScore?: number;
} | null;

type Bet = {
  _id: string;
  kind: string;
  market: string;
  selection: string;
  stake: number;
  odds: number;
  status: string;
  payout: number | null;
  note: string | null;
  fixture: Fixture;
};

type Call = {
  _id: string;
  winner: string;
  scoreline: string;
  confidence: number;
  trashTalk: string;
  fixture: Fixture;
  landed: boolean | null;
};

type Detail = {
  model: {
    key: string;
    displayName: string;
    color: string;
    tagline: string;
    bettingStyle: string;
    persona: string;
    modelSlug: string;
  };
  card: { posture: string; mood: string; riskDial: number; updatedAt: number } | null;
  stats: {
    bankroll: number;
    pl: number;
    rank: number;
    total: number;
    staked: number;
    returned: number;
    open: number;
    won: number;
    lost: number;
    voided: number;
    betCount: number;
  };
  outrights: Bet[];
  bets: Bet[];
  calls: Call[];
};

const MOOD_TONE: Record<string, string> = {
  smug: "text-accent",
  cocky: "text-accent",
  neutral: "text-muted",
  tilting: "text-down",
  desperate: "text-down",
  rattled: "text-down",
};

function betPL(b: Bet): number | null {
  if (b.status === "won") return (b.payout ?? 0) - b.stake;
  if (b.status === "lost") return -b.stake;
  if (b.status === "void") return 0;
  return null; // open
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "won"
      ? "border-up/40 text-up"
      : status === "lost"
        ? "border-down/40 text-down"
        : status === "void"
          ? "border-line text-faint"
          : "border-accent/40 text-accent";
  const label = status === "open" ? "Open" : status[0].toUpperCase() + status.slice(1);
  return <span className={`shrink-0 border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${tone}`}>{label}</span>;
}

export default function PunditPage() {
  const params = useParams<{ key: string }>();
  const data = useQuery(api.pundit.detail, { key: params.key }) as Detail | null | undefined;

  if (data === undefined) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
        <div className="h-64 animate-pulse rounded bg-surface-2" />
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
        <p className="text-muted">Pundit not found.</p>
        <Link href="/" className="font-serif italic text-accent">
          Return to the Council
        </Link>
      </div>
    );
  }

  const { model, card, stats, outrights, bets, calls } = data;
  const up = stats.pl >= 0;
  const color = model.color;
  const matchBets = bets.filter((b) => b.kind !== "outright");

  return (
    <div className="mx-auto max-w-3xl px-5 pb-20 sm:px-8">
      <header className="py-8">
        <Link href="/" className="kicker transition-colors hover:text-foreground">
          ← The Council
        </Link>
      </header>

      {/* The identity card */}
      <section className="relative overflow-hidden border border-line bg-surface/50">
        <div className="h-1 w-full" style={{ background: color }} />
        <div className="grid gap-8 p-6 sm:grid-cols-[1fr_auto] sm:p-8">
          <div className="min-w-0">
            <div className="flex items-center gap-4">
              <PunditMark name={model.displayName} color={color} size={60} />
              <div className="min-w-0">
                <h1 className="font-serif text-4xl font-semibold leading-none tracking-tight">
                  {model.displayName}
                </h1>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="kicker" style={{ color }}>
                    {model.tagline}
                  </span>
                  {card && (
                    <span className={`kicker ${MOOD_TONE[card.mood] ?? "text-muted"}`}>· {card.mood}</span>
                  )}
                </div>
              </div>
            </div>

            {card?.posture && (
              <p className="mt-5 font-serif text-[17px] italic leading-snug text-muted">
                &ldquo;{card.posture}&rdquo;
              </p>
            )}

            <div className="mt-6 flex items-end gap-5">
              <div>
                <div className="kicker">Bankroll</div>
                <div className="font-mono text-4xl tabular-nums">{money(stats.bankroll)}</div>
              </div>
              <div className={`pb-1 font-mono text-lg tabular-nums ${up ? "text-up" : "text-down"}`}>
                {signedMoney(stats.pl)}
              </div>
            </div>
            <div className="mt-2 kicker text-faint">
              {ordinal(stats.rank)} of {stats.total} in the money race
            </div>
          </div>

          <div className="flex flex-col items-center justify-center border-line sm:border-l sm:pl-8">
            <RiskDial value={card?.riskDial ?? 50} color={color} />
            <div className="kicker mt-1">Risk appetite</div>
          </div>
        </div>
      </section>

      {/* Stat strip */}
      <div className="mt-px grid grid-cols-2 border border-line sm:grid-cols-4">
        {[
          { label: "Staked", value: money(stats.staked) },
          { label: "Returned", value: money(stats.returned) },
          { label: "Record", value: `${stats.won}W–${stats.lost}L` },
          { label: "Open bets", value: String(stats.open) },
        ].map((s, i) => (
          <div
            key={s.label}
            className={`p-4 ${i % 2 === 0 ? "border-r border-line" : ""} ${i < 2 ? "border-b border-line sm:border-b-0" : ""} sm:border-r sm:last:border-r-0`}
          >
            <div className="kicker">{s.label}</div>
            <div className="mt-1 font-mono text-lg tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Ethos */}
      <section className="py-10">
        <h2 className="mb-4 font-serif text-2xl font-semibold tracking-tight">The Ethos</h2>
        <p className="font-serif text-lg italic" style={{ color }}>
          {model.bettingStyle}
        </p>
        <p className="mt-3 leading-relaxed text-muted">{model.persona}</p>
        <p className="mt-4 kicker text-faint">Model · {model.modelSlug}</p>
      </section>

      {/* Backing for the Cup */}
      <section className="pb-10">
        <h2 className="mb-4 font-serif text-2xl font-semibold tracking-tight">Backing for the Cup</h2>
        {outrights.length === 0 ? (
          <p className="text-muted">
            No outright wager yet — {model.displayName} is playing the matches, not the trophy.
          </p>
        ) : (
          <div className="space-y-px">
            {outrights.map((b) => (
              <div key={b._id} className="border-t border-line py-4 first:border-t-0">
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="font-serif text-xl">{b.selection}</div>
                    <div className="kicker mt-0.5 text-faint">to win the World Cup @ {b.odds}</div>
                  </div>
                  <div className="text-right font-mono text-sm tabular-nums text-muted">
                    {money(b.stake)} → {money(b.stake * b.odds)}
                  </div>
                  <StatusPill status={b.status} />
                </div>
                {b.note && (
                  <p className="mt-2 border-l-2 pl-3 font-serif text-[14px] italic text-muted" style={{ borderColor: color }}>
                    {b.note}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* The Ledger */}
      <section className="pb-10">
        <h2 className="mb-4 font-serif text-2xl font-semibold tracking-tight">The Ledger</h2>
        {matchBets.length === 0 ? (
          <p className="text-muted">No match bets settled or placed yet.</p>
        ) : (
          <div className="border-t border-line">
            {matchBets.map((b) => {
              const pl = betPL(b);
              const f = b.fixture;
              const row = (
                <div className="flex items-center gap-3 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-serif text-[15px]">
                      {f ? `${f.homeTeam} v ${f.awayTeam}` : "Match"}
                    </div>
                    <div className="mt-0.5 text-[12px] text-faint">
                      <span className="text-muted">{b.selection}</span> · {money(b.stake)} @ {b.odds}
                      {f ? ` · ${shortDate(f.kickoffAt)}` : ""}
                    </div>
                  </div>
                  {pl !== null && b.status !== "void" && (
                    <span className={`font-mono text-[13px] tabular-nums ${pl >= 0 ? "text-up" : "text-down"}`}>
                      {signedMoney(pl)}
                    </span>
                  )}
                  <StatusPill status={b.status} />
                </div>
              );
              return f ? (
                <Link
                  key={b._id}
                  href={`/match/${f._id}`}
                  className="block border-b border-line transition-colors hover:bg-surface/50"
                >
                  {row}
                </Link>
              ) : (
                <div key={b._id} className="border-b border-line">
                  {row}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent Calls */}
      {calls.length > 0 && (
        <section>
          <h2 className="mb-4 font-serif text-2xl font-semibold tracking-tight">Recent Calls</h2>
          <div className="space-y-px">
            {calls.map((c) => {
              const f = c.fixture;
              return (
                <div key={c._id} className="border-t border-line py-4 first:border-t-0">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-serif text-[15px]">
                        {f ? `${f.homeTeam} v ${f.awayTeam}` : "Match"}
                      </div>
                      <div className="mt-0.5 text-[12px] text-muted">
                        {f ? winnerLabel(c.winner, f.homeTeam, f.awayTeam) : c.winner}{" "}
                        <span className="font-mono tabular-nums text-faint">{c.scoreline}</span> · {c.confidence}% sure
                      </div>
                    </div>
                    {c.landed === null ? (
                      <span className="kicker text-faint">Pending</span>
                    ) : c.landed ? (
                      <span className="kicker text-up">✓ Landed</span>
                    ) : (
                      <span className="kicker text-down">✗ Missed</span>
                    )}
                  </div>
                  {c.trashTalk && (
                    <p className="mt-2 border-l-2 pl-3 font-serif text-[14px] italic text-muted" style={{ borderColor: color }}>
                      {c.trashTalk}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
