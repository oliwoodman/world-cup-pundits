"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PunditMark } from "@/components/PunditMark";
import { TouchlineFeed, type Msg } from "@/components/Touchline";

// Mobile-only Touchline: a floating bubble in the bottom corner that flashes each new line as it
// pings in, and opens a slide-up sheet with the full feed on tap. Hidden on lg+ (the rail shows there).
export function TouchlineDock() {
  const msgs = useQuery(api.banter.recent) as Msg[] | undefined;
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Msg | null>(null);
  const lastIdRef = useRef<string | null>(null);

  const latest = msgs && msgs.length > 0 ? msgs[0] : null;

  // Flash a transient preview when a genuinely new line arrives (and the sheet is closed).
  useEffect(() => {
    if (!latest) return;
    if (lastIdRef.current === null) {
      lastIdRef.current = latest._id; // first load — don't flash the backlog
      return;
    }
    if (latest._id !== lastIdRef.current) {
      lastIdRef.current = latest._id;
      if (!open) {
        setPreview(latest);
        const t = setTimeout(() => setPreview(null), 5500);
        return () => clearTimeout(t);
      }
    }
  }, [latest, open]);

  // Lock body scroll while the sheet is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      {/* Ping: the newest line, briefly, above the bubble */}
      {preview && !open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-24 right-4 z-40 flex max-w-[78vw] items-start gap-2 rounded-2xl rounded-br-sm border border-line bg-surface px-3 py-2.5 text-left shadow-lg animate-fade-up"
        >
          <PunditMark name={preview.model?.displayName} color={preview.model?.color} size={22} />
          <span className="min-w-0">
            <span className="font-serif text-[12px] font-medium" style={{ color: preview.model?.color ?? undefined }}>
              {preview.model?.displayName ?? "?"}
            </span>
            <span className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-foreground/90">{preview.content}</span>
          </span>
        </button>
      )}

      {/* The bubble */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Open the Touchline"
        className="fixed bottom-6 right-4 z-40 flex items-center gap-2.5 rounded-full border border-line bg-surface/95 px-4 py-3 shadow-lg backdrop-blur transition-colors hover:border-faint"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-up opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-up" />
        </span>
        <span className="kicker">Touchline</span>
        {latest && <PunditMark name={latest.model?.displayName} color={latest.model?.color} size={22} />}
      </button>

      {/* The sheet */}
      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[82vh] flex-col rounded-t-2xl border-t border-line bg-background animate-slide-up">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="flex items-center gap-1.5 kicker">
                Touchline
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-up" />
                <span className="text-faint">live</span>
              </span>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-muted transition-colors hover:text-foreground"
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 pb-8">
              <TouchlineFeed msgs={msgs} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
