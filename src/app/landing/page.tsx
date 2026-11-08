import type { Metadata } from "next";
import { Landing } from "./Landing";
import "./landing.css";

export const metadata: Metadata = {
  title: "Flare",
  description: "Flare. Everyone built the alarm. We built the night shift. Detect, price and respond to produced-water failures before the tank trips.",
};

export default function LandingPage() {
  return <Landing />;
}
