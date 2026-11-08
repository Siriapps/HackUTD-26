---
name: Flare
description: Night-shift operator console for a produced-water network; dark control room, glowing category colours, mono numerals.
colors:
  surface-0: "#070b14"
  surface-1: "#0c1220"
  surface-2: "#121a2b"
  surface-3: "#1a2438"
  line-1: "rgb(148 163 196 / 0.1)"
  line-2: "rgb(148 163 196 / 0.2)"
  text-1: "#e8edf7"
  text-2: "#a3afc7"
  text-3: "#7c89a6"
  cat-failure: "#ffab2e"
  cat-leak: "#22d3ee"
  cat-degradation: "#a78bfa"
  ok: "#3ddc97"
  cat-failure-mark: "#c98319"
  cat-leak-mark: "#1497b5"
  cat-degradation-mark: "#8e6cf0"
  ok-mark: "#13a078"
  warn: "#ffd84d"
  shutdown: "#ff5a5f"
  accent: "#5b8def"
  accent-hover: "#7aa3f5"
  focus: "#9db4ff"
typography:
  body:
    fontFamily: "Geist, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.35
  heading:
    fontFamily: "ZT Moven Bold Italic"
    fontSize: "1.25rem"
    fontWeight: 700
    fontStyle: italic
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  numeral:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.3
  numeral-hero:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "2.1875rem"
    fontWeight: 500
    lineHeight: 1.1
rounded:
  sm: "4px"
  md: "6px"
  lg: "10px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  panel:
    backgroundColor: "{colors.surface-1}"
    rounded: "{rounded.lg}"
    padding: "16px"
  card:
    backgroundColor: "{colors.surface-2}"
    rounded: "{rounded.md}"
    padding: "12px"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface-0}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-1}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  chip-category:
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
---

# Flare design system

Tokens live in `src/app/tokens.css` (CSS variables + Tailwind v4 `@theme`). W4 owns colour and type; W2 owns layout.
Add tokens freely; never rename one. Product name in the UI: **Flare**. Headers use ZT Moven Bold Italic; body text uses Helvetica Neue.

## Overview

A night-shift control room. The judge's screen is an operator console (Operate mode): dense, calm, trustworthy at
3 a.m. Near-black navy surfaces recede; the only things that glow are the ones that need a decision. Brand lives in
precision: tabular numerals, exact thresholds, category colour used with discipline. One dark theme by design.

## Colors

| Role | Token | Use |
|---|---|---|
| Page | `--surface-0` | app background, 3D scene background |
| Panel | `--surface-1` | sidebars, map chrome, panels |
| Card / input | `--surface-2` | alert rows, inputs, chart surface |
| Hover / popover | `--surface-3` | hover rows, menus, tooltips |
| Borders | `--line-1`, `--line-2` | structure (1px); `line-2` for focused/selected |
| Text | `--text-1/2/3` | primary / secondary / muted labels (all >= 4.9:1 on `surface-2`) |

Category colours carry one meaning each and nothing else:

| Meaning | Ink (text, chips, glows) | Chart mark | Soft fill |
|---|---|---|---|
| pump_failure | `--cat-failure` amber | `--cat-failure-mark` | `--cat-failure-soft` |
| pipeline_leak | `--cat-leak` cyan | `--cat-leak-mark` | `--cat-leak-soft` |
| pump_degradation | `--cat-degradation` violet | `--cat-degradation-mark` | `--cat-degradation-soft` |
| healthy / resolved | `--ok` green | `--ok-mark` | `--ok-soft` |

Tank limits use their own pair: `--warn` (warning line, yellow) and `--shutdown` (shutdown line, red). They never
colour an event; an event is amber/cyan/violet. `--accent` (steel blue) is for buttons, links and selection and is not
a category. `--focus` is the keyboard ring.

Chart rules (from the dataviz method): series use the `-mark` steps on `surface-1/2` (validated: all adjacent pairs
CVD dE >= 9.8, normal-vision dE >= 18.9, >= 5:1 contrast). Green is a status, not a series; do not put it next to cyan as a
line. Text in charts wears text tokens, never the series colour. One y-axis per chart. Event spans use the `-soft`
fill. Tailwind: `text-cat-failure`, `bg-cat-leak-soft`, `stroke-cat-degradation-mark`, `text-warn`, `bg-surface-1`,
`text-ink-2`, `border-line-1`, `ring-focus`. Raw variables also work: `text-(--text-2)`.

## Typography

IBM Plex Sans for everything that is read; IBM Plex Mono for everything that is measured. Plex is an engineering
family (instrument panels, not marketing), so one family carries headings, labels and body; the mono is the second
voice reserved for numerals: readings, costs, countdowns, timestamps, asset ids. Use the `num` utility
(`font-mono tabular-nums`) so columns of numbers align and countdowns do not jitter.

Scale (14px base, ratio ~1.2, fixed rem): `text-xs` 11, `text-sm` 12, `text-base` 14, `text-lg` 17, `text-xl` 20,
`text-2xl` 24, `text-3xl` 29, `text-4xl` 35. Headings are weight 600, tracking -0.01em, sentence case. Labels are
`text-sm` weight 500 in `--text-2`, sentence case, never all caps, never a kicker above a heading. Hero numerals (the
countdown, a cost) are `text-4xl` mono weight 500 with the unit in `text-sm` `--text-3` beside them. Body measure
<= 75ch; tables may run wider.

## Layout

Desktop console at 1440 and 1024: top bar, alerts column left (~360px), map centre, fleet/handoff right (~320px).
Dense: 8px gutters inside rows, 12px inside cards, 16px between panels, 24px between regions. Alerts list is the
densest thing on screen and reads top to bottom in SPEC order. `/field` is mobile-first (375px), big type, one column.
Responsive behaviour is structural (collapse columns), not fluid type. Footer "© 2026 Avon Corps" on every page.

## Elevation & Depth

Structure comes from borders and surface steps, not shadows: a panel is `surface-1` with a `line-1` border; a card
inside it is `surface-2`. Hover raises to `surface-3`. The one shadow, `--shadow-pop`, is for things that float
(menus, tooltips). No glass, no blur, no gradient washes. Glow belongs to the 3D twin and to the live countdown
only (an amber pulse on a failed pump).

## Shapes

Instrument-panel radii: `--r-sm` 4px on inputs and chips' inner corners, `--r-md` 6px on buttons and cards,
`--r-lg` 10px on panels, `--r-pill` on category chips and status dots. Nothing larger; no fully rounded cards.

## Components

- Panel: `bg-surface-1 border border-line-1 rounded-lg p-4`; title `text-lg` 600, no eyebrow.
- Card / alert row: `bg-surface-2 border border-line-1 rounded-md p-3`; selected: `border-line-2`; hover: `bg-surface-3`.
- Category chip: `rounded-full px-2 py-0.5 text-sm font-medium` with `bg-cat-*-soft text-cat-*`; includes the
  category word, never colour alone.
- Countdown: hero numeral mono; turns `--shutdown` when hours to limit < 1, `--warn` when the tank is past the warning
  line, else `--text-1`. Label "to shutdown" in `--text-3`.
- Buttons: primary `bg-accent text-surface-0 hover:bg-accent-hover`; secondary `bg-surface-2 border-line-1
  hover:bg-surface-3`; destructive uses `--shutdown` text on `--shutdown-soft`. Every control has hover, focus
  (`--ring`), active, disabled (opacity .5, no hover) and loading states.
- Forms: inputs `bg-surface-2 border-line-1 rounded-sm`, focus `--ring`; sliders use `accent-color` (already set).
- Empty state: one sentence saying what will appear here and the action that fills it. Loading: skeleton blocks in
  `surface-2`, never a centred spinner in content.
- Motion: 150-220 ms, `--ease-out`, state changes only. The 3D twin animates continuously (flow particles, fault
  pulse) because it shows live state; everything else is still until it changes. Respect `prefers-reduced-motion`.

## Do's and Don'ts

- Do derive every label, limit and price from the loaded dataset; tokens style them, never supply them.
- Do keep category colour for category meaning; warn/shutdown for tank limits; accent for actions.
- Do put every number in `num` so columns align; keep the unit in `--text-3`.
- Don't use all caps labels, kickers, numbered section markers, gradient text, glass panels or coloured left borders.
- Don't add a light theme, Comic Sans, or any decorative motion.
- Don't colour an alert by severity ad hoc; order carries urgency (SPEC order), colour carries category.
