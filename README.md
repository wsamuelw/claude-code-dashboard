# Claude Code Token Usage Dashboard

A zero-dependency, browser-based dashboard that visualises your Claude Code usage data. Drop your `stats-cache.json` file onto the page to see token consumption trends, model breakdowns, peak usage hours, and session activity — all rendered client-side with no server or backend required.

Built for developers who want to understand how they use Claude Code: which models consume the most tokens, when they're most productive, and how their usage patterns change over time.

![Dashboard](https://github.com/wsamuelw/claude-code-dashboard/raw/main/dashboard-screenshot.png)

## Features

- **Daily token usage trend** — line chart showing consumption over time
- **Tokens by model** — horizontal bar chart ranked by usage
- **Input vs Output vs Cache** — token type breakdown
- **Usage by hour of day** — find your peak productive hours
- **Tool calls trend** — track automation usage over time
- **Sessions per day** — how often you open Claude Code
- **Busiest days** — top 5 most active sessions with details
- **Time range selector** — filter by 7d, 14d, 30d, 90d, or all time
- **Trend indicators** — % change vs previous period on every stat card
- **Sparklines** — mini trend charts in stat cards

## Quick Start

### Option 1: GitHub Pages (live)

1. Visit **https://wsamuelw.github.io/claude-code-dashboard/**
2. Drag `~/.claude/stats-cache.json` onto the page

### Option 2: Local (no server)

1. Double-click `index.html`
2. Drag `~/.claude/stats-cache.json` onto the page

### Option 3: Local server

```bash
cd claude-code-dashboard
python3 -m http.server 8765
# Open http://localhost:8765
# Drop your stats-cache.json onto the page
```

Your data stays in your browser — nothing is uploaded to any server.

## Data Source

`stats-cache.json` contains:

| Field | Description |
|---|---|
| `dailyActivity` | Per-day message count, session count, tool call count |
| `dailyModelTokens` | Per-day token usage broken down by model |
| `modelUsage` | All-time totals per model: input, output, cache read, cost |
| `hourCounts` | Message count by hour of day (usage patterns) |
| `totalSessions` | Total session count |
| `totalMessages` | Total message count |
| `longestSession` | Longest session details |

## Tech Stack

- **HTML/CSS/JS** — vanilla, no build step
- **Chart.js 4.x** — via CDN
- **GitHub Pages** — static hosting with Actions deploy

## Project Structure

```
claude-code-dashboard/
├── index.html              # Dashboard page
├── app.js                  # Data loading + chart rendering
├── stats-cache.json        # Claude Code usage data (not committed)
├── .gitignore              # Ignores stats-cache.json
└── .github/workflows/
    └── deploy.yml          # GitHub Pages deploy action
```

## License

MIT
