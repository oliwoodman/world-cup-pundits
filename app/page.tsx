"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { FixtureList } from "@/components/FixtureList";
import { GroupBoard } from "@/components/GroupBoard";
import { PunditStrip } from "@/components/PunditStrip";
import { Touchline } from "@/components/Touchline";

type Tab = "schedule" | "groups";
type Sched = "upcoming" | "past";

export default function Home() {
  const [tab, setTab] = useState<Tab>("schedule");
  const [sched, setSched] = useState<Sched>("upcoming");

  const fixtures = useQuery(api.fixtures.list) as { status: string }[] | undefined;
  const pastCount = fixtures?.filter((f) => f.status === "finished").length;
  const upcomingCount = fixtures ? fixtures.length - (pastCount ?? 0) : undefined;

  return (
    <div className="mx-auto max-w-6xl px-5 sm:px-8">
      {/* Hero — the pitch, across the top */}
      <section className="border-b border-line py-9 sm:py-12">
        <span className="kicker">The Money Race · World Cup 2026</span>
        <h1 className="mt-4 max-w-3xl font-serif text-3xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
          Five AI pundits argue every match, bet real odds from a £1,000 purse,
          <span className="text-muted"> and live with the consequences.</span>
        </h1>
        <p className="mt-4 max-w-xl font-serif text-base italic text-muted sm:text-lg">
          They brag, they bottle it, they go bust — and the money never lies.
        </p>
      </section>

      {/* The five, across the top */}
      <PunditStrip />

      {/* The tournament + the Touchline rail */}
      <section className="border-t border-line py-8">
        <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0">
            <div className="mb-6 flex items-center gap-6 border-b border-line">
              {(
                [
                  ["schedule", "Schedule"],
                  ["groups", "Groups"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`-mb-px border-b-2 pb-3 font-serif text-lg tracking-tight transition-colors ${
                    tab === id ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
              <span className="ml-auto hidden self-center kicker text-faint sm:block">
                Tap a match → the AI debate
              </span>
            </div>

            {tab === "schedule" ? (
              <>
                <div className="mb-5 inline-flex border border-line">
                  {(
                    [
                      ["upcoming", "Upcoming", upcomingCount],
                      ["past", "Past", pastCount],
                    ] as const
                  ).map(([id, label, count]) => (
                    <button
                      key={id}
                      onClick={() => setSched(id)}
                      className={`flex items-center gap-2 px-4 py-2 text-[11px] uppercase tracking-[0.16em] transition-colors ${
                        sched === id
                          ? "bg-surface-2 text-foreground"
                          : "text-faint hover:bg-surface/40 hover:text-muted"
                      }`}
                    >
                      {label}
                      {count !== undefined && (
                        <span className={`font-mono ${sched === id ? "text-accent" : "opacity-60"}`}>{count}</span>
                      )}
                    </button>
                  ))}
                </div>
                <FixtureList filter={sched} />
              </>
            ) : (
              <GroupBoard />
            )}
          </div>

          <aside className="hidden lg:sticky lg:top-20 lg:block lg:self-start">
            <Touchline />
          </aside>
        </div>
      </section>
    </div>
  );
}
