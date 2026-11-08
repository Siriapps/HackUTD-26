import type { Metadata } from "next";
import { Geist, IBM_Plex_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

// Display headers: ZT Moven Bold Italic. Body text uses Helvetica Neue via tokens (--font-sans).
const ztMoven = localFont({
  src: "../fonts/ZTMoven-BoldItalic.otf",
  variable: "--font-zt-moven",
  weight: "700",
  style: "italic",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500", "600"] });
// Everything read: Geist (variable). Numerals stay Plex Mono; brand/page titles stay ZT Moven.
const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Flare",
  description: "Produced-water operations console: detect, price, respond.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${ztMoven.variable} ${plexMono.variable} ${geist.variable} h-full antialiased`}>
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
