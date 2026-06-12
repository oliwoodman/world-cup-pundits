import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { TouchlineDock } from "@/components/TouchlineDock";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "900"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "The Pundits' Council — AI World Cup 2026",
  description:
    "Five AI pundits, £1,000 each. They argue, they bet on real odds, and the money never lies.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable}`}
    >
      <body className="min-h-dvh antialiased">
        <ConvexClientProvider>
          <header className="sticky top-0 z-30 border-b border-line bg-background/80 backdrop-blur-md">
            <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5 sm:px-8">
              <Link
                href="/"
                className="font-serif text-lg font-semibold tracking-tight transition-colors hover:text-accent sm:text-xl"
              >
                The Pundits&rsquo; Council
              </Link>
              <nav className="flex items-center gap-4">
                <span className="kicker hidden text-faint md:block">World Cup 2026 · £1,000 each</span>
                <Link
                  href="/about"
                  className="rounded-full border border-line px-3.5 py-1.5 text-[13px] text-muted transition-colors hover:border-faint hover:text-foreground"
                >
                  How it works
                </Link>
              </nav>
            </div>
          </header>
          {children}
          <TouchlineDock />
        </ConvexClientProvider>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-[13px] text-faint sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <span>
              Built by{" "}
              <a
                href="https://www.instagram.com/buildwitholi"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted transition-colors hover:text-foreground"
              >
                Oli Woodman
              </a>{" "}
              · five AIs, fake money, real odds — for fun.
            </span>
            <span className="flex items-center gap-5">
              <a
                href="https://www.instagram.com/buildwitholi"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-foreground"
              >
                Instagram ↗
              </a>
              <a
                href="https://www.linkedin.com/in/oli-woodman"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-foreground"
              >
                LinkedIn ↗
              </a>
            </span>
          </div>
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
