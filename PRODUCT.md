# Product

## Register

product

## Platform

web

## Users

Primary: DevOps and platform engineers who own and maintain Kubernetes cluster infrastructure. They open OpsRadar during on-call shifts, morning cluster reviews, and pre-release health checks. They are comfortable reading YAML, interpreting resource limits, and acting on findings without hand-holding. They distrust tools that oversimplify.

## Product Purpose

OpsRadar scans a live Kubernetes cluster using Bob Shell AI, streams findings in real time, and generates GitHub PRs with concrete YAML fixes. The product's job is not just to surface what's broken — it's to complete the loop: scan → diagnose → patch. Success means a platform engineer can go from "unknown cluster state" to "open fix PR" in under two minutes, without leaving the browser.

## Positioning

Bob doesn't just flag issues — it fixes them. The unique claim every screen reinforces: AI-generated, commit-ready YAML patches, not a report to action later.

## Brand Personality

Confident, direct, and modern. The interface operates like the engineers who use it: no noise, no hedging, no decoration for its own sake. It knows what it found and it tells you plainly. The tone is that of a senior SRE giving a handoff — authoritative, concise, and already pointing at the fix.

## Anti-references

- **DataDog / generic ops SaaS**: navy left nav, gray card grids, blue primary buttons — the default 2023-era tooling look. OpsRadar should feel like it was designed in 2026 for engineers who've outgrown those dashboards.
- **PagerDuty / incident-management aesthetic**: heavy red, urgency-by-default, alarm-room color temperature. Severity is signal in OpsRadar, not atmosphere.
- **Grafana dark with neon**: dark backgrounds with bright green/cyan metric lines — the observability-dashboard default. OpsRadar is not a metrics viewer; it's an intelligence layer.
- **Startup SaaS landing page**: gradients, hero sections, feature grids, marketing copy. Nothing on any screen should look like it's selling the product.

## Design Principles

**End-to-end ownership.** Every screen leads toward resolution. Surfaces that show findings without a path to fixing them are unfinished. Scan → diagnose → fix PR is the product's spine; the UI reinforces each step in that chain.

**Color is signal, not style.** The severity scale — critical, high, medium, low, clean — is the product's core vocabulary. Color usage that doesn't speak that language should step aside. Red does not appear as decoration.

**Bob is the engine, not the face.** The AI reasoning is the core value, but the product presents Bob's conclusions in ops-native format: findings, YAML diffs, PR links — not as a chatbot or assistant interface. The UI frames Bob's output as trusted intelligence, not a suggestion.

**Density earns trust.** Platform engineers distrust dashboards that simplify away complexity. A readable, data-dense view is more trustworthy than an abstracted one. Show what the AI found, not a summary of a summary.

**First load tells a story.** A new visitor should understand cluster state, where the critical issues are, and what to do next within a single screen's worth of content — no configuration, no onboarding wizard.

## Accessibility & Inclusion

WCAG 2.1 AA. Severity color is never the only encoding — icons or labels accompany every color-based status indicator so colorblind engineers get the same signal. All animations respect `prefers-reduced-motion`.
