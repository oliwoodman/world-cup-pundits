"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { codeFor, fmtKickoff, money, winnerLabel } from "@/lib/format";
import { PunditMark } from "@/components/PunditMark";

type SlimModel = { displayName: string; color: string; key: string } | null;
type RosterModel = { key: string; displayName: string; color: string; tagline: string };
type PredRow = {
  _id: string;
  winner: string;
  scoreline: string;
  confidence: number;
  trashTalk: string;
  keyFactor?: string;
  model: SlimModel;
};
type BetRow = { _id: string; stake: number; selection: string; odds: number; model: SlimModel };
type MsgRow = { _id: string; round: number; content: string; model: SlimModel };
type Star = { player: string; sign: string; url?: string };
type Dossier = {
  homeRank?: number;
  awayRank?: number;
  homeForm?: string;
  awayForm?: string;
  homeStar?: Star;
  awayStar?: Star;
  weather?: string;
  news: { team: string; headline: string; source?: string; url?: string }[];
  funFact?: string;
} | null;

function DossierRow({
  label,
  source,
  sourceHref,
  children,
}: {
  label: string;
  source: string;
  sourceHref?: string;
  children: React.ReactNode;
}) {
  const sourceClass = "shrink-0 font-mono text-[10px] uppercase tracking-wider text-faint/70";
  return (
    <div className="flex items-start gap-3 border-b border-line/60 py-3 text-[13px]">
      <span className="kicker w-20 shrink-0 pt-0.5 text-faint">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
      {sourceHref ? (
        <a
          href={sourceHref}
          target="_blank"
          rel="noopener noreferrer"
          className={`${sourceClass} underline decoration-line underline-offset-2 transition-colors hover:text-foreground`}
        >
          {source} ↗
        </a>
      ) : (
        <span className={sourceClass}>{source}</span>
      )}
    </div>
  );
}

export default function MatchPage() {
  const params = useParams<{ fixtureId: string }>();
  const fixtureId = params.fixtureId as Id<"fixtures">;
  const data = useQuery(api.match.detail, { fixtureId });

  if (data === undefined) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
        <div className="h-48 animate-pulse rounded bg-surface-2" />
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
        <p className="text-muted">Match not found.</p>
        <Link href="/" className="font-serif italic text-accent">
          Return to the Council
        </Link>
      </div>
    );
  }

  const fixture = data.fixture;
  const dossier = (fixture as unknown as { dossier?: Dossier }).dossier ?? null;
  const debate = data.debate as { status: string } | null;
  const roster = data.roster as unknown as RosterModel[];
  const predictions = data.predictions as unknown as PredRow[];
  const bets = data.bets as unknown as BetRow[];
  const messages = data.messages as unknown as MsgRow[];
  const { time, day } = fmtKickoff(fixture.kickoffAt);
  const showScore = fixture.status === "finished" || fixture.status === "live";

  const hasDebate = debate !== null && predictions.length > 0;
  const debateRunning = debate?.status === "running";
  const lock = fmtKickoff(fixture.kickoffAt - 30 * 60 * 1000);

  const predByKey = new Map(predictions.map((p) => [p.model?.key ?? "", p]));

  return (
    <div className="mx-auto max-w-3xl px-5 pb-20 sm:px-8">
      <header className="border-b border-line py-8">
        <Link href="/" className="kicker transition-colors hover:text-foreground">
          ← The Council
        </Link>

        <div className="mt-8 text-center">
          <div className="kicker">
            {fixture.stage} · {day} {time}
          </div>
          <div className="mt-4 flex items-center justify-center gap-5 sm:gap-10">
            <div className="flex-1 text-right">
              <div className="font-serif text-3xl font-semibold sm:text-4xl">{fixture.homeTeam}</div>
              <div className="kicker mt-1">{codeFor(fixture.homeTeam)}</div>
            </div>
            <div className="font-mono text-3xl tabular-nums text-muted sm:text-4xl">
              {showScore ? `${fixture.homeScore ?? 0}–${fixture.awayScore ?? 0}` : "v"}
            </div>
            <div className="flex-1 text-left">
              <div className="font-serif text-3xl font-semibold sm:text-4xl">{fixture.awayTeam}</div>
              <div className="kicker mt-1">{codeFor(fixture.awayTeam)}</div>
            </div>
          </div>
        </div>
      </header>

      {/* The Dossier — what the pundits were handed, with sources */}
      {dossier &&
        (dossier.homeRank ||
          dossier.homeForm ||
          dossier.awayForm ||
          dossier.homeStar ||
          dossier.awayStar ||
          dossier.news.length > 0 ||
          dossier.weather ||
          dossier.funFact) && (
          <section className="border-b border-line py-6">
            <div className="mb-4 flex items-baseline justify-between">
              <div className="kicker">The Dossier · what the pundits were handed</div>
              <div className="kicker text-faint">sourced</div>
            </div>
            <div className="border-t border-line/60">
              {(dossier.homeRank || dossier.awayRank) && (
                <DossierRow label="FIFA rank" source="FIFA" sourceHref="https://inside.fifa.com/fifa-world-ranking/men">
                  <span className="font-serif">{fixture.homeTeam}</span>{" "}
                  <span className="font-mono text-muted">#{dossier.homeRank ?? "?"}</span>
                  <span className="text-faint"> · </span>
                  <span className="font-serif">{fixture.awayTeam}</span>{" "}
                  <span className="font-mono text-muted">#{dossier.awayRank ?? "?"}</span>
                </DossierRow>
              )}
              {(dossier.homeStar || dossier.awayStar) && (
                <DossierRow label="Talismen" source="TheSportsDB" sourceHref="https://www.thesportsdb.com">
                  {[dossier.homeStar, dossier.awayStar].filter(Boolean).map((s, i) => (
                    <span key={i}>
                      {i > 0 && <span className="text-faint"> · </span>}
                      {s!.url ? (
                        <a
                          href={s!.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline decoration-line underline-offset-2 transition-colors hover:text-accent"
                        >
                          {s!.player}
                        </a>
                      ) : (
                        s!.player
                      )}{" "}
                      <span className="text-muted">({s!.sign})</span>
                    </span>
                  ))}
                </DossierRow>
              )}
              {(dossier.homeForm || dossier.awayForm) && (
                <DossierRow label="Form · L5" source="Results">
                  <span className="font-serif">{codeFor(fixture.homeTeam)}</span>{" "}
                  <span className="font-mono">{dossier.homeForm || "—"}</span>
                  <span className="text-faint"> · </span>
                  <span className="font-serif">{codeFor(fixture.awayTeam)}</span>{" "}
                  <span className="font-mono">{dossier.awayForm || "—"}</span>
                </DossierRow>
              )}
              {dossier.weather && (
                <DossierRow label="Weather" source="Open-Meteo" sourceHref="https://open-meteo.com">
                  <span className="font-serif">{dossier.weather}</span>
                </DossierRow>
              )}
              {dossier.news.length > 0 && (
                <DossierRow label="On the wire" source="GNews" sourceHref="https://gnews.io">
                  <ul className="space-y-1.5">
                    {dossier.news.map((n, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="kicker mt-0.5 shrink-0 !tracking-[0.1em] text-faint">{codeFor(n.team)}</span>
                        {n.url ? (
                          <a
                            href={n.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-foreground/90 underline decoration-line underline-offset-2 transition-colors hover:text-accent"
                          >
                            {n.headline}
                          </a>
                        ) : (
                          <span className="text-foreground/90">{n.headline}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </DossierRow>
              )}
            </div>
            {dossier.funFact && (
              <p className="mt-3 border-l-2 border-line pl-3 font-serif text-[13px] italic text-faint">
                {dossier.funFact}
              </p>
            )}
          </section>
        )}

      {/* The verdict — all five pundits */}
      <section className="py-10">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-serif text-2xl font-semibold tracking-tight">The Verdict</h2>
          {debateRunning && <span className="kicker text-accent">Pundits arguing now</span>}
        </div>

        {fixture.status === "finished" && !hasDebate ? (
          <div className="border border-line bg-surface/40 px-6 py-10 text-center">
            <div className="kicker">No verdict on the record</div>
            <p className="mx-auto mt-4 max-w-md font-serif text-xl italic leading-snug text-muted">
              The pundits didn&rsquo;t get to this one — it kicked off before the Council was up and
              running. The result&rsquo;s in the books, but nobody put their money on it.
            </p>
          </div>
        ) : !hasDebate && !debateRunning ? (
          <div className="border border-line bg-surface/40 px-6 py-10 text-center">
            <div className="kicker">Awaiting the council</div>
            <p className="mx-auto mt-4 max-w-md font-serif text-xl italic leading-snug text-muted">
              The five pundits convene about 30 minutes before kickoff to argue this one out and lock
              their bets. Nobody&rsquo;s called it yet.
            </p>
            <p className="mt-3 kicker text-faint">
              Predictions lock ~{lock.time} · {day}
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-x-6 gap-y-3">
              {roster.map((m) => (
                <div key={m.key} className="flex items-center gap-2 opacity-70">
                  <PunditMark name={m.displayName} color={m.color} size={26} />
                  <span className="font-serif text-sm">{m.displayName}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
        <div className="space-y-px">
          {roster.map((m) => {
            const p = predByKey.get(m.key);
            const myBets = bets.filter((b) => b.model?.key === m.key);
            return (
              <div key={m.key} className="border-t border-line py-5 first:border-t-0">
                <div className="flex items-center gap-3">
                  <PunditMark name={m.displayName} color={m.color} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="font-serif text-[17px] font-medium">{m.displayName}</div>
                    <div className="text-[11px] text-faint">{m.tagline}</div>
                  </div>
                  <div className="text-right">
                    {p ? (
                      <>
                        <div className="font-serif text-base">
                          {winnerLabel(p.winner, fixture.homeTeam, fixture.awayTeam)}{" "}
                          <span className="font-mono text-sm text-muted tabular-nums">
                            {p.scoreline}
                          </span>
                        </div>
                        <div className="kicker mt-0.5">{p.confidence}% sure</div>
                      </>
                    ) : (
                      <span className="kicker text-faint">
                        {debateRunning ? "Yet to lock" : "Sat this one out"}
                      </span>
                    )}
                  </div>
                </div>

                {p?.trashTalk && (
                  <p className="mt-3 border-l-2 pl-4 font-serif text-[15px] italic text-muted" style={{ borderColor: m.color }}>
                    {p.trashTalk}
                  </p>
                )}

                {p?.keyFactor && (
                  <div className="mt-2.5 flex items-center gap-2 pl-1 text-[11px]">
                    <span className="text-faint">↳ leaned on</span>
                    <span
                      className="border border-line bg-surface/60 px-2 py-0.5 uppercase tracking-[0.1em]"
                      style={{ color: m.color }}
                    >
                      {p.keyFactor}
                    </span>
                  </div>
                )}

                {myBets.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2 pl-1">
                    {myBets.map((b) => (
                      <span
                        key={b._id}
                        className="border border-line bg-surface/60 px-2.5 py-1 text-[12px]"
                      >
                        <span className="font-mono tabular-nums">{money(b.stake)}</span>{" "}
                        {b.selection}{" "}
                        <span className="text-faint">@ {b.odds}</span>
                      </span>
                    ))}
                  </div>
                ) : p ? (
                  <p className="mt-2 pl-1 text-[12px] text-faint">No stake placed.</p>
                ) : null}
              </div>
            );
          })}
        </div>
        )}
      </section>

      {/* The argument */}
      {messages.length > 0 && (
        <section>
          <h2 className="mb-6 font-serif text-2xl font-semibold tracking-tight">The Argument</h2>
          <div className="space-y-5">
            {messages.map((m, i) => (
              <div
                key={m._id}
                className="animate-fade-up border-l-2 pl-4"
                style={{ borderColor: m.model?.color ?? "var(--color-line)", animationDelay: `${Math.min(i * 70, 700)}ms` }}
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <PunditMark name={m.model?.displayName} color={m.model?.color} size={22} />
                  <span className="font-serif text-sm font-medium" style={{ color: m.model?.color ?? undefined }}>
                    {m.model?.displayName}
                  </span>
                  <span className="kicker !text-[0.55rem]">Round {m.round}</span>
                </div>
                <p className="font-serif text-[15px] leading-relaxed text-foreground/90">
                  {m.content}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
