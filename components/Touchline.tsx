"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { PunditMark } from "@/components/PunditMark";

export type Msg = {
  _id: string;
  content: string;
  createdAt: number;
  model: { displayName: string; color: string; key: string } | null;
};

export function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

// The scrollable list of lines — shared by the desktop rail and the mobile dock.
export function TouchlineFeed({ msgs }: { msgs: Msg[] | undefined }) {
  if (msgs === undefined) {
    return (
      <>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded bg-surface-2" />
        ))}
      </>
    );
  }
  if (msgs.length === 0) {
    return <p className="text-[13px] italic text-faint">The pundits are warming up…</p>;
  }
  return (
    <>
      {msgs.map((m) => (
        <div key={m._id} className="flex gap-2.5 animate-fade-up">
          <PunditMark name={m.model?.displayName} color={m.model?.color} size={26} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <Link
                href={`/pundit/${m.model?.key ?? ""}`}
                className="font-serif text-[13px] font-medium hover:underline"
                style={{ color: m.model?.color ?? undefined }}
              >
                {m.model?.displayName ?? "?"}
              </Link>
              <span className="kicker !text-[0.5rem] text-faint">{ago(m.createdAt)}</span>
            </div>
            <p className="mt-0.5 text-[13px] leading-snug text-foreground/90">{m.content}</p>
          </div>
        </div>
      ))}
    </>
  );
}

// The desktop side rail.
export function Touchline() {
  const msgs = useQuery(api.banter.recent) as Msg[] | undefined;

  return (
    <section className="flex max-h-[80vh] flex-col border border-line bg-surface/40">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="kicker">Touchline</span>
        <span className="flex items-center gap-1.5 kicker text-faint">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-up" />
          live
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <TouchlineFeed msgs={msgs} />
      </div>
    </section>
  );
}
