"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { money, signedMoney } from "@/lib/format";
import { PunditMark } from "@/components/PunditMark";

type Row = {
  id: string;
  key: string;
  color: string;
  displayName: string;
  tagline: string;
  bankrupt: boolean;
  bankroll: number;
  backing: string | null;
};

const MOOD = "text-faint";

export function PunditStrip() {
  const rows = useQuery(api.leaderboard.standings) as Row[] | undefined;

  return (
    <section className="py-6">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="kicker">The Money Race</h2>
        <span className="kicker text-faint">Tap a pundit</span>
      </div>

      {rows === undefined ? (
        <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-36 animate-pulse bg-surface-2" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-px overflow-hidden border border-line bg-line sm:grid-cols-5">
          {rows.map((r, i) => {
            const pl = r.bankroll - 1000;
            const up = pl >= 0;
            return (
              <Link
                key={r.id}
                href={`/pundit/${r.key}`}
                className="group flex flex-col bg-surface p-4 transition-colors hover:bg-surface-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-faint tabular-nums">#{i + 1}</span>
                  {r.bankrupt && <span className="kicker text-down">Bust</span>}
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <PunditMark name={r.displayName} color={r.color} size={34} />
                  <div className="min-w-0">
                    <div className="truncate font-serif text-[15px] font-medium leading-tight">
                      {r.displayName}
                    </div>
                    <div className="truncate text-[11px] text-faint">{r.tagline}</div>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="font-mono text-xl tabular-nums leading-none">{money(r.bankroll)}</div>
                  <div className={`mt-1 font-mono text-[11px] tabular-nums ${up ? "text-up" : "text-down"}`}>
                    {signedMoney(pl)}
                  </div>
                </div>

                <div className="mt-3 border-t border-line pt-2">
                  <span className="kicker !tracking-[0.12em] text-faint">Cup pick</span>
                  <div className={`mt-0.5 truncate text-[13px] ${r.backing ? "font-serif" : MOOD}`}>
                    {r.backing ? (
                      <span style={{ color: r.color }}>◆ {r.backing}</span>
                    ) : (
                      "—"
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
