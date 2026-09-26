export type Lang = "en" | "fr" | "de" | "ja";

export const LANGS: { code: Lang; label: string; flag: string }[] = [
  { code: "en", label: "English",  flag: "🇬🇧" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "de", label: "Deutsch",  flag: "🇩🇪" },
  { code: "ja", label: "日本語",   flag: "🇯🇵" },
];

export type Translations = typeof en;

export const en = {
  nav: {
    product: "Product",
    docs:    "Docs",
    github:  "GitHub",
    getStarted: "Get started",
  },
  hero: {
    eyebrow:  "Powered by IBM Bob Shell AI",
    headline: "Your Kubernetes clusters,\nfully understood.",
    sub:      "OpsRadar scans every connected cluster, streams AI findings in real time, and opens commit-ready GitHub PRs — scan to fix PR in under two minutes.",
    cta:      "Run locally — free",
    ctaSub:   "No account. No cloud. Just your kubeconfig.",
    demo:     "Watch demo",
  },
  features: {
    title: "Everything a platform engineer actually needs",
    sub:   "No dashboards that hide complexity. Dense, actionable, done.",
    items: [
      { icon: "⚡", title: "Multi-cluster radar",   body: "Reads every context in your kubeconfig simultaneously. One view across all clusters." },
      { icon: "🤖", title: "Bob AI analysis",        body: "IBM Bob Shell runs a resource audit on every Deployment — over-provisioning, missing probes, unpinned images, security gaps." },
      { icon: "🔀", title: "GitHub source detection",body: "Detects the GitHub repo behind each workload from annotations or image tags. Fetches source manifests for deeper analysis." },
      { icon: "📬", title: "Auto PR generation",     body: "Every finding with a fix produces a unified diff patch. One click opens a real GitHub PR against the source branch." },
      { icon: "📡", title: "Live SSE stream",         body: "Scan progress streams directly to your browser as each goroutine completes. Watch Bob work in parallel." },
      { icon: "🗄️", title: "Local SQLite store",     body: "Zero infrastructure. History, findings, and radar state persist in a single file on your machine." },
    ],
  },
  howItWorks: {
    title: "Scan → diagnose → fix. Under two minutes.",
    steps: [
      { n: "01", title: "Connect",  body: "OpsRadar reads ~/.kube/config. Every context, every cluster — no configuration required." },
      { n: "02", title: "Scan",     body: "Click Scan Now. Parallel goroutines fan out across namespaces while Bob analyses each Deployment manifest." },
      { n: "03", title: "Diagnose", body: "Findings stream live. Severity-coded, detailed, with concrete suggestions and YAML diffs." },
      { n: "04", title: "Fix",      body: "Click Generate PR. OpsRadar creates a branch, commits the patch, and opens the PR on GitHub." },
    ],
  },
  docs: {
    title: "Documentation",
    sections: [
      {
        slug: "quickstart",
        title: "Quickstart",
        content: `## Quickstart

Run OpsRadar locally in 60 seconds.

### Prerequisites

- Go 1.23+
- Node.js 22+
- \`~/.kube/config\` with at least one context
- [IBM Bob Shell](https://bob.ibm.com) installed and in PATH
- (Optional) GitHub personal access token for PR generation

### Run with Docker Compose

\`\`\`bash
git clone https://github.com/your-org/opsradar
cd opsradar
cp .env.example .env          # add GITHUB_TOKEN and GITHUB_REPO
docker compose up
\`\`\`

Open **http://localhost:3000**.

### Run locally (dev mode)

\`\`\`bash
make dev
\`\`\`

This starts the Go API on :8080 and the Next.js dashboard on :3000.`,
      },
      {
        slug: "configuration",
        title: "Configuration",
        content: `## Configuration

All configuration is via environment variables.

| Variable | Default | Description |
|---|---|---|
| \`STORE_PATH\` | \`/data/ops-radar.db\` | SQLite file path |
| \`BOB_BIN\` | \`bob\` | Path to the Bob Shell binary |
| \`GITHUB_TOKEN\` | — | GitHub PAT for PR generation |
| \`GITHUB_REPO\` | — | Default target repo (owner/repo) |
| \`OPS_RADAR_API_KEY\` | — | API key (empty = dev mode, no auth) |
| \`PORT\` | \`8080\` | API server port |
| \`KUBECONFIG\` | \`~/.kube/config\` | Kubeconfig path |`,
      },
      {
        slug: "api",
        title: "API Reference",
        content: `## API Reference

All routes require \`X-API-Key\` header when \`OPS_RADAR_API_KEY\` is set.

### POST /scan

Start a scan across all (or filtered) kubeconfig contexts.

**Body**
\`\`\`json
{ "cluster_name": "my-cluster", "namespace": "" }
\`\`\`

**Response**
\`\`\`json
{ "scan_id": "uuid" }
\`\`\`

---

### GET /scan/:id/stream

Server-sent events stream of scan progress. Each event:

\`\`\`json
{ "task_id": "uuid", "message": "…", "finding": {…}, "done": false }
\`\`\`

---

### GET /radar

Aggregated open findings per namespace from the latest completed scan.

---

### GET /recommendations?scan_id=\`uuid\`

All findings for a scan, sorted by severity.

---

### POST /pr/generate

\`\`\`json
{ "finding_id": "uuid" }
\`\`\`

Returns \`{ "pr_url": "https://github.com/…" }\`.

---

### GET /findings/:id/resolve

Mark a finding resolved (sets \`resolved_at\`).`,
      },
      {
        slug: "github-detection",
        title: "GitHub Detection",
        content: `## GitHub Source Detection

OpsRadar tries to find the GitHub repository behind each Deployment using this priority order:

1. **Annotation** \`github.com/repo\` — e.g. \`myorg/myapp\`
2. **Annotation** \`app.kubernetes.io/source-repo\`
3. **Annotation** \`gitops.source.url\` — full HTTPS URL
4. **Container image** — \`ghcr.io/<org>/<repo>:tag\` parsed automatically

### Annotating your deployments

\`\`\`yaml
metadata:
  annotations:
    github.com/repo: "myorg/myapp"
\`\`\`

Once detected, OpsRadar fetches YAML files from paths matching:
\`deploy/\`, \`k8s/\`, \`kubernetes/\`, \`manifests/\`, \`charts/\`, and common filename patterns.

Bob analyses the **source manifests** (what's in Git), not just the running state, so generated PRs target the right files.`,
      },
    ],
  },
  footer: {
    tagline: "Kubernetes intelligence, AI-powered, locally owned.",
    links: [
      { label: "Docs",    href: "/docs" },
      { label: "GitHub",  href: "https://github.com" },
      { label: "IBM Bob", href: "https://bob.ibm.com" },
    ],
    copy: "© 2025 OpsRadar. Built with IBM Bob Shell.",
  },
};

export const fr: Translations = {
  nav: { product: "Produit", docs: "Documentation", github: "GitHub", getStarted: "Commencer" },
  hero: {
    eyebrow:  "Propulsé par IBM Bob Shell AI",
    headline: "Vos clusters Kubernetes,\ntotalement maîtrisés.",
    sub:      "OpsRadar analyse chaque cluster connecté, diffuse les résultats en temps réel et ouvre des PRs GitHub prêtes à fusionner — de l'analyse au correctif en moins de deux minutes.",
    cta:      "Lancer en local — gratuit",
    ctaSub:   "Aucun compte. Aucun cloud. Juste votre kubeconfig.",
    demo:     "Voir la démo",
  },
  features: { title: "Tout ce dont un ingénieur plateforme a besoin", sub: "Pas de tableaux de bord qui masquent la complexité.", items: en.features.items },
  howItWorks: { title: "Analyser → Diagnostiquer → Corriger. En moins de deux minutes.", steps: en.howItWorks.steps },
  docs: en.docs,
  footer: { ...en.footer, copy: "© 2025 OpsRadar. Construit avec IBM Bob Shell." },
};

export const de: Translations = {
  nav: { product: "Produkt", docs: "Dokumentation", github: "GitHub", getStarted: "Loslegen" },
  hero: {
    eyebrow:  "Powered by IBM Bob Shell AI",
    headline: "Ihre Kubernetes-Cluster,\nvollständig verstanden.",
    sub:      "OpsRadar scannt jeden verbundenen Cluster, streamt KI-Erkenntnisse in Echtzeit und öffnet commit-fertige GitHub-PRs — in unter zwei Minuten.",
    cta:      "Lokal ausführen — kostenlos",
    ctaSub:   "Kein Konto. Keine Cloud. Nur Ihre kubeconfig.",
    demo:     "Demo ansehen",
  },
  features: { title: "Alles, was ein Platform Engineer wirklich braucht", sub: "Keine Dashboards, die Komplexität verstecken.", items: en.features.items },
  howItWorks: { title: "Scannen → Diagnostizieren → Beheben. In unter zwei Minuten.", steps: en.howItWorks.steps },
  docs: en.docs,
  footer: { ...en.footer, copy: "© 2025 OpsRadar. Gebaut mit IBM Bob Shell." },
};

export const ja: Translations = {
  nav: { product: "製品", docs: "ドキュメント", github: "GitHub", getStarted: "始める" },
  hero: {
    eyebrow:  "IBM Bob Shell AI 搭載",
    headline: "すべてのKubernetesクラスタを、\n完全に把握する。",
    sub:      "OpsRadarは接続されたすべてのクラスタをスキャンし、AIによる発見をリアルタイムでストリーミング配信、コミット可能なGitHub PRを自動生成します。スキャンから修正まで2分以内。",
    cta:      "ローカルで無料実行",
    ctaSub:   "アカウント不要。クラウド不要。kubeconfigだけ。",
    demo:     "デモを見る",
  },
  features: { title: "プラットフォームエンジニアが本当に必要なもの", sub: "複雑さを隠すダッシュボードは不要。", items: en.features.items },
  howItWorks: { title: "スキャン → 診断 → 修正。2分以内。", steps: en.howItWorks.steps },
  docs: en.docs,
  footer: { ...en.footer, copy: "© 2025 OpsRadar. IBM Bob Shell で構築。" },
};

export const translations: Record<Lang, Translations> = { en, fr, de, ja };
