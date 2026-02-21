# Beetcast

Bandcamp-to-Podcast converter. Scrapes episode metadata from Bandcamp, merges tracks into single MP3 files with chapter markers, and serves a proper podcast RSS feed.

## Prerequisites

- [mise](https://mise.jdx.dev/) (installs Node 24 + pnpm)
- [ffmpeg](https://ffmpeg.org/) (audio processing)

## Quick Start

```bash
mise install
pnpm install
pnpm dev          # Start backend + frontend dev server
```

## Configuration

Edit `podcasts.json` to add or modify podcast sources:

```json
{
  "omsbpodcast": {
    "bandcampUrl": "https://omsbpodcast.bandcamp.com",
    "title": "(((OPENmind/SATURATEDbrain)))",
    "author": "OPENmind/SATURATEDbrain",
    "bitrate": 96,
    "channels": 1
  }
}
```

The key (e.g. `omsbpodcast`) becomes the URL slug for the podcast feed.

### Scheduled Refresh

Beetcast automatically discovers and syncs new episodes on a schedule. Configure the interval per-podcast with `refreshInterval` (default: `"24h"`):

```json
{
  "omsbpodcast": {
    "bandcampUrl": "https://omsbpodcast.bandcamp.com",
    "title": "(((OPENmind/SATURATEDbrain)))",
    "author": "OPENmind/SATURATEDbrain",
    "refreshInterval": "12h"
  }
}
```

Supported units: `m` (minutes), `h` (hours), `d` (days). Manual discover/sync from the admin UI resets the timer.

## Usage

### Feed URL

Subscribe in any podcast app:

```
http://localhost:3000/<slug>/feed.xml
```

### API

```bash
# Health check
curl http://localhost:3000/health

# Sync episodes from Bandcamp
curl -X POST http://localhost:3000/<slug>/sync

# Build all unmerged MP3s
curl -X POST http://localhost:3000/<slug>/build

# Get episode metadata
curl http://localhost:3000/<slug>/episode/193

# Download merged episode MP3
curl -o episode.mp3 http://localhost:3000/<slug>/episode/193.mp3
```

### Admin UI

Visit `http://localhost:5173` (dev) or `http://localhost:3000` (production).

## Docker

Create a `podcasts.json` (see Configuration above), then:

```bash
docker compose up
```

This pulls the pre-built image from `ghcr.io/notjosh/beetcast`. To build locally instead:

```bash
docker compose up --build
```

For a custom `BASE_URL` (e.g. behind a reverse proxy):

```yaml
environment:
  - BASE_URL=https://podcasts.example.com
```

## Environment Variables

| Variable         | Default                 | Description                                  |
| ---------------- | ----------------------- | -------------------------------------------- |
| `PORT`           | `3000`                  | Server port                                  |
| `BASE_URL`       | `http://localhost:3000` | Public base URL for feed enclosures          |
| `ADMIN_ENABLED`  | `true`                  | Enable admin API + UI                        |
| `ADMIN_USERNAME` |                         | Basic auth username (auth disabled if unset) |
| `ADMIN_PASSWORD` |                         | Basic auth password (auth disabled if unset) |
