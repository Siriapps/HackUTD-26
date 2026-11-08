import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Avon Night Shift",
  description: "Produced-water operations console: detect, price, respond.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <div className="flex-1 flex flex-col">{children}</div>
        {/* Required by the challenge README. Keep on every page. */}
        <footer className="px-4 py-2 text-xs opacity-60 text-center">© 2026 Avon Corps</footer>
      </body>
    </html>
  );
}
