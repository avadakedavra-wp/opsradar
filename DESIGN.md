---
name: OpsRadar
description: Kubernetes operations intelligence — scan, diagnose, and fix in one command.
colors:
  command: "#4f46e5"
  ink: "#171717"
  canvas: "#ffffff"
  surface: "#f9fafb"
  border: "#e5e7eb"
  muted: "#6b7280"
  terminal-bg: "#030712"
  terminal-ink: "#86efac"
  severity-critical: "#dc2626"
  severity-high: "#f97316"
  severity-medium: "#facc15"
  severity-low: "#3b82f6"
  severity-clean: "#22c55e"
typography:
  display:
    fontFamily: "Geist, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "clamp(1.5rem, 3.5vw, 2rem)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Geist, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Geist, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Geist, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.2
  mono:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.command}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "#4338ca"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  button-resolve:
    backgroundColor: "#f0fdf4"
    textColor: "#15803d"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  badge-critical:
    backgroundColor: "{colors.severity-critical}"
    textColor: "#ffffff"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  badge-medium:
    backgroundColor: "{colors.severity-medium}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
---

# Design System: OpsRadar

## 1. Overview

**Creative North Star: "The Ops Room"**

OpsRadar's visual system is built around one question: what would a mission-control display for Kubernetes look like if it didn't compromise on clarity? The Ops Room metaphor demands that every pixel earns its place. Information density is a feature, not a problem to design around. The interface is calm at rest and decisive under pressure — it doesn't shout "critical" through aggressive color; it presents state clearly and lets severity speak through the established scale.

The design takes explicit cues from Vercel's dashboard: dark-capable precision, bold status indicators, a confident absence of decoration. It rejects the ops-tooling defaults — no DataDog navy-gray card grids, no PagerDuty alarm-red atmosphere, no Grafana neon metric lines. This is an intelligence layer, not a metrics viewer. What differentiates it is that Bob doesn't just flag issues — it generates fix PRs. Every screen should reinforce that the loop is closed here, not handed off.

Typography is Geist throughout: geometric, clean, built for screens. Geist Mono carries the terminal and diff content — the most technically rich surfaces in the product. Color is restrained to one command color (indigo) and one semantic scale (severity). Everything else is neutrals.

**Key Characteristics:**
- White canvas with tonal surfaces — no shadows, no texture, no warmth
- Command Indigo as the single action voice — used sparingly, never decorative
- Severity scale as the product's core language — five values, always consistent
- Geist Sans for UI copy, Geist Mono for machine output
- Flat elevation: surfaces separate by tint, not shadow

## 2. Colors

One action color. Five severity states. Everything else neutral.

### Primary
- **Command Indigo** (`#4f46e5`): The single action color. Primary buttons, hyperlinks, and active navigation states. Appears on at most one primary CTA per screen. Its scarcity is its authority.

### Neutral
- **Hard Ink** (`#171717`): Primary body text. Maximum contrast, no warm offset.
- **Zero Canvas** (`#ffffff`): Body background. True white — no cream, no warmth, no tint.
- **Lifted Surface** (`#f9fafb`): Slightly elevated backgrounds — hover states on list items, section backgrounds that need separation from canvas.
- **Steel Rule** (`#e5e7eb`): Dividers, card borders, timeline lines. The structural skeleton.
- **Muted Lead** (`#6b7280`): Secondary text, timestamps, helper labels. Never used for primary content.

### Severity (Semantic)
The product's core vocabulary. These colors appear only as severity indicators — never decoratively.

- **Alert Red** (`#dc2626`): Critical findings. Maximum urgency. Use with a text label; never rely on color alone.
- **Warning Orange** (`#f97316`): High severity.
- **Caution Yellow** (`#facc15`): Medium severity. Paired with dark text (`#171717`) for contrast.
- **Notice Blue** (`#3b82f6`): Low severity.
- **Clear Green** (`#22c55e`): Clean — no findings. The goal state.

### Terminal
- **Ops Dark** (`#030712`): The background for the scan log stream and diff patches. The darkest surface in the system — a deliberate contrast pocket for machine output.
- **Trace Green** (`#86efac`): Default log output text on Ops Dark. The system's one nod to terminal tradition, contained to the log pane.

### Named Rules
**The One Command Rule.** Command Indigo appears on ≤1 primary action per screen. Its job is to say "do this" — use it twice and it no longer means anything.

**The Signal Rule.** Severity colors appear only on severity indicators. A red element that isn't a severity badge is a design error. Never reach for `severity-critical` as emphasis on non-severity content.

## 3. Typography

**Display Font:** Geist (with -apple-system, BlinkMacSystemFont, sans-serif fallback)
**Body Font:** Geist (same stack)
**Mono Font:** Geist Mono (with ui-monospace, SFMono-Regular, monospace fallback)

**Character:** Geist's geometric precision suits an ops tool: clean strokes, consistent metrics, excellent legibility at small sizes. The mono companion is the technical anchor — log output, diffs, and YAML patches always use Geist Mono, never Geist Sans, so machine content is immediately distinguishable from UI copy.

### Hierarchy
- **Display** (700, clamp(1.5rem, 3.5vw, 2rem), lh 1.1, ls -0.02em): Page-level headings. Used on the main radar view title and scan result summaries. Not used on every page.
- **Headline** (600, 1.125rem, lh 1.3, ls -0.01em): Section heads within a page (`h2`). Namespace Radar, Recent Scans, Recommendations.
- **Body** (400, 0.875rem, lh 1.6): Default prose. Finding descriptions, detail text, explanatory copy. Max line length 65–72ch.
- **Label** (600, 0.75rem, lh 1.2): UI metadata — scan status, finding count, timestamps. Always paired with a value, never used as a heading.
- **Mono** (400, 0.75rem, lh 1.5): All machine output — log lines, diff patches, YAML, scan IDs. Never used for UI copy.

### Named Rules
**The Mono / Sans Divide.** If the content is human-authored UI copy, it is Geist Sans. If it was produced by a machine (Bob's output, a diff patch, a Kubernetes resource name, a log line), it is Geist Mono. The division is semantic, not stylistic.

## 4. Elevation

This system is flat. Surfaces separate from each other via background tint (`canvas` → `surface` → `terminal-bg`), never via shadow. The single exception is the radar heatmap cells, which carry a Tailwind `shadow` (0 1px 3px 0 rgb(0 0 0 / 0.1)) to give the colored severity tiles slight physical presence.

No card in a list, no input field, no navigation bar uses box-shadow for decoration. Shadow on those elements reads as generic SaaS UI — the first pattern to avoid per PRODUCT.md.

### Shadow Vocabulary
- **Tile Lift** (`0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)`): Heatmap cells only. Gives the severity tiles a slight material quality without floating them off the page.

### Named Rules
**The Flat-by-Default Rule.** Shadow is not a surface separator. Every time a shadow is added to a card or container, ask: can a background tint (`surface`) carry the separation instead? It almost always can.

## 5. Components

### Buttons
Tight, instrument-panel feel. Padding is functional, not generous. The primary button is the only element that carries Command Indigo as a fill.

- **Shape:** Gently curved (8px radius — `rounded-md` equivalent)
- **Primary** (`bg: #4f46e5`, `text: #ffffff`, `padding: 8px 16px`): The single most important action on the screen. Max one per view.
- **Hover:** Darkens to `#4338ca`. No transform, no glow.
- **Ghost / Secondary** (`bg: #f9fafb`, `text: #171717`, `border: 1px solid #e5e7eb`): Non-destructive secondary actions — "Open PR ↗", copy buttons.
- **Resolve** (`bg: #f0fdf4`, `text: #15803d`, `border: 1px solid #bbf7d0`): The mark-resolved action. Green-tinted to echo the clean/resolved state.
- **Disabled:** `opacity: 0.5`. No color change.

### Severity Badges
- **Style:** Pill shape (full radius), `text-xs font-semibold`, uppercase not used.
- **Critical / High / Low:** Color fill with white text. Medium uses yellow fill with `#171717` dark text for contrast.
- **Dual encoding:** Badge always carries both the color fill and the text label. Color alone is never sufficient.

### Cards / Containers
The core list container for findings and scan entries.

- **Corner Style:** 12px radius (`rounded-xl`) for cards; 8px for smaller containers.
- **Background:** Canvas (`#ffffff`) with a 1px `#e5e7eb` border. No shadow.
- **Hover State:** Background shifts to `#f9fafb` (Lifted Surface) on interactive list items.
- **Internal Padding:** 16px (`p-4`).

### Terminal Pane
The signature component — the most visually distinctive surface in the system.

- **Background:** Ops Dark (`#030712`), 12px radius, 1px `#1f2937` (gray-800) border.
- **Text:** Trace Green (`#86efac`) default; severity-colored variants for critical (`#f87171`), high (`#fb923c`), medium (`#fbbf24`) log events.
- **Font:** Geist Mono, 0.75rem.
- **Overflow:** `overflow-y: auto` with auto-scroll on new lines.

### Navigation
Minimal horizontal top bar.

- **Style:** White background, 1px bottom border in `#e5e7eb`, sticky.
- **Logo:** `font-bold text-lg tracking-tight`. No color treatment.
- **Nav links:** `text-sm text-gray-600`. Hover: `text-gray-900`. No underline, no active indicator beyond convention.

### Radar Heatmap Cells (Signature Component)
The product's most distinctive visual element.

- **Shape:** 12px radius tiles in a responsive auto-fit grid.
- **Background:** Filled with the severity color of the worst finding in that namespace.
- **Text:** White for all severity levels. `font-semibold text-sm` for the namespace name, `text-xs opacity-80` for the finding count.
- **Monospace counts:** `font-mono text-xs` for the C/H/M/L breakdown.
- **Tile Lift shadow:** Applied to every cell for slight material presence.

## 6. Do's and Don'ts

### Do:
- **Do** use Command Indigo (`#4f46e5`) for exactly one primary CTA per screen. When in doubt, the action is a ghost button, not indigo.
- **Do** pair severity colors with a text label. Color is never the only indicator of severity.
- **Do** use Geist Mono for all machine-produced content: log lines, YAML, diff patches, scan IDs, resource names.
- **Do** separate surfaces with background tint (`#f9fafb`) rather than box-shadow.
- **Do** use `border-radius: 12px` for cards and `8px` for buttons. Stop there.
- **Do** keep body text in Hard Ink (`#171717`), not Muted Lead. Ops content is primary content.
- **Do** encode dual signals on severity: color AND label AND (where space allows) an icon.

### Don't:
- **Don't** use `border-left` or `border-right` greater than 1px as a colored stripe on cards, callouts, or alerts.
- **Don't** use gradient text (`background-clip: text`). Severity is solid color; everything else is ink.
- **Don't** design for the DataDog / generic SaaS aesthetic: no navy left nav, no gray card grids, no blue-primary-button-everywhere.
- **Don't** use the PagerDuty alarm-room aesthetic — no heavy red atmosphere, no urgency-by-default background tints.
- **Don't** reference the Grafana dark mode visual language — no dark backgrounds with neon green/cyan metric lines outside the terminal pane.
- **Don't** make any screen look like a startup SaaS landing page: no gradients in hero sections, no feature grids, no marketing copy.
- **Don't** add `box-shadow` to cards or navigation. Flat-by-default; use `#f9fafb` tonal shift instead.
- **Don't** use `border-radius` above 12px on cards or above 8px on buttons. Anything rounder reads as generic SaaS.
- **Don't** use severity colors outside of severity indicators. Red on a button, orange on a chart axis — these violate the Signal Rule.
- **Don't** mute body content to gray-600 for "visual hierarchy." Hard Ink is required for primary reading content.
