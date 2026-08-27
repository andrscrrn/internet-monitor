# Internet Monitor

Monitors your internet connection in the background: pings 1.1.1.1, 8.8.8.8, and 9.9.9.9 every ~2s, checks DNS resolution, and keeps a local history of latency, packet loss, and outages (down to sub-second precision). Includes a local web dashboard with zoom for charts and the outage log.

macOS only.

## Manual use (try it without installing)

```bash
npm start
```

Then open http://localhost:5757

## Installing as a permanent service (auto-starts, always running)

```bash
./scripts/install.sh
```

This creates a LaunchAgent in `~/Library/LaunchAgents` that starts the monitor on login and restarts it if it crashes.

## Uninstalling the service

```bash
./scripts/uninstall.sh
```

## Generating a PDF report (for your ISP)

```bash
npm run report
```

Generates a PDF with an uptime summary, status/latency charts, a day-by-day breakdown, and the detail of every outage (date, start/end time, and duration), using the last 7 days of data. Saved to `reports/internet-report-<date>.pdf`.

For a different period or filename:

```bash
node scripts/report.js --days=30 --out=reports/my-report.pdf
```

## Data

Data is stored in `data/` (one `.jsonl` file per day, plus `outages.jsonl` with the outage log). It's cleaned up automatically after 30 days.
