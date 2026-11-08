import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

// Font variables consumed by src/app/tokens.css (--font-sans / --font-mono).
const plexSans = IBM_Plex_Sans({ variable: "--font-plex-sans", subsets: ["latin"], weight: ["400", "500", "600"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "Avon Night Shift",
  description: "Produced-water operations console: detect, price, respond.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <div className="flex-1 flex flex-col min-h-0">{children}</div>
        {/* Required by the challenge README. Keep on every page. */}
        <footer className="shrink-0 h-8 flex items-center justify-center px-4 text-xs text-ink-3 border-t border-line-1">
          © 2026 Avon Corps
        </footer>
      </body>
    </html>
  );
}
