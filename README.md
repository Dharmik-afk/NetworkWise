# Cloudflare Speed Test Result Logger

This Node.js and Express app serves a browser interface, stores submitted speed-test results in PostgreSQL, and provides an admin dashboard. The browser runs Cloudflare's official `@cloudflare/speedtest` module against Cloudflare's edge network. This server does not run or proxy the speed test; measurement traffic goes directly from the browser to Cloudflare. Cloudflare states that completed measurements are collected to calculate aggregated connection-quality insights.

## Getting Started

Requirements: Docker and Docker Compose.

```bash
docker compose build
docker compose up -d
```

Open **https://localhost:8000** on the same computer. The container generates a self-signed certificate for `localhost` and `127.0.0.1`. Your browser will warn that it is not trusted; accept the warning for local use or install/trust the certificate to enable browser geolocation. The Compose port is bound to localhost only. To access the app from another device, configure a trusted certificate for the hostname/IP you will use and update the Compose binding; the generated certificate is only valid for localhost.

The page asks whether to share location before starting the test. Location is optional. Cloudflare measures latency, download, and upload from the browser, then the page posts those measurements, optional location, and available device/network metadata to `POST /api/results`. Browser privacy controls may limit device details; carrier information is not generally available to web pages.

Each browser test uses 20 latency packets and multiple payload sizes in each direction: three 100 KB, three 1 MB, two 10 MB, and one 25 MB request for download, followed by the same sequence for upload. That is up to about 97 MB of test payload in total. Cloudflare reports the median of valid bandwidth samples for a less optimistic summary; the meter shows a phase while requests are running and only displays the aggregate when the test finishes.

The app loads the official Cloudflare speed-test module from the installed npm package. Cloudflare's own documentation notes that it collects test measurements for aggregate connection-quality insights: [Cloudflare Speedtest](https://github.com/cloudflare/speedtest).

## Configuration

Docker Compose supplies the database settings below. Set these environment variables when running outside Docker.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8000` | Server listening port; set by most Node hosts. |
| `HOST` | `0.0.0.0` | Network interface for the server. |
| `HTTPS_ENABLED` | `false` | Set to `true` only when this app terminates TLS itself. Most Node hosts terminate HTTPS at a proxy and should use the default. |
| `TLS_KEY_PATH` | `certs/localhost-key.pem` | TLS private key path. |
| `TLS_CERT_PATH` | `certs/localhost-cert.pem` | TLS certificate path. |
| `CORS_ORIGIN` | `https://localhost:3000` | Allowed cross-origin browser origin; bundled page uses same-origin requests. |
| `DATABASE_URL` | unset | Optional PostgreSQL connection string. Set this to your Supabase connection string to use Supabase; when unset, the `DB_*` settings below are used. |
| `DB_HOST` | `postgres` | PostgreSQL host. |
| `DB_PORT` | `5432` | PostgreSQL port. |
| `DB_USER` | `postgres` | PostgreSQL user. |
| `DB_PASSWORD` | `secret` | PostgreSQL password. |
| `DB_NAME` | `speedtest` | PostgreSQL database name. |
| `ADMIN_USERNAME` | `admin` | Admin dashboard username. |
| `ADMIN_PASSWORD` | `change-me` | Admin dashboard password; change before deployment. |
| `SESSION_SECRET` | development-only value | Secret used to sign admin sessions; change before deployment. |

## Admin Dashboard

Visit `/admin` to sign in and view the 100 most recent saved tests. Results can be sorted by time, download speed, or ping. Set strong, unique `ADMIN_PASSWORD` and `SESSION_SECRET` values before deployment. Compose defaults (`admin` / `change-me`) are for local development only.

Select **Speed map** to open `/admin/map`. The map displays up to 1,000 newest GPS-tagged results with at least one measured speed. It estimates values between samples and is not a coverage guarantee. Leaflet and OpenStreetMap tiles require internet access.

## API

### `POST /api/results`

Stores metrics reported by the browser. JSON request bodies are limited to 10 KB. `gps` is optional; supplied coordinates must be JSON numbers within latitude -90…90 and longitude -180…180. `timestamp`, when supplied, must be a valid date. Omitted metrics and unavailable GPS values are stored as `NULL`.

Example:

```json
{
  "downloadSpeedMbps": 125.4,
  "uploadSpeedMbps": 42.1,
  "pingMs": 18,
  "gps": {
    "latitude": 37.7749,
    "longitude": -122.4194,
    "altitude": 10.5,
    "accuracy": 5
  },
  "metadata": {
    "deviceModel": "iPhone 15",
    "osVersion": "iOS 17",
    "networkType": "5G",
    "carrier": "Unavailable in browser"
  },
  "timestamp": "2026-10-23T21:30:00Z"
}
```

Returns HTTP 201:

```json
{
  "success": true,
  "message": "Metrics saved successfully.",
  "recordId": 1
}
```

The former `/api/speedtest/ping`, `/api/speedtest/download`, and `/api/speedtest/upload` endpoints are not provided. The server only stores results; all test measurements are performed by the browser with Cloudflare.

`GET /api/admin/results` requires an admin session. `GET /api/network-speeds` is public because it powers the visitor-facing coverage map; it returns map points as `{ points: [{ id, latitude, longitude, uploadSpeedMbps, downloadSpeedMbps, timestamp }] }`.

## Database

Results are stored in `speed_test_results`, including download/upload speed, ping, optional coordinates, device/network metadata, and creation time. The table is initialized automatically at startup. To use Supabase, set `DATABASE_URL` to the project's PostgreSQL connection string (Project Settings → Database → Connection string). Use the session pooler connection string if your deployment platform cannot connect to Supabase's direct IPv6 endpoint. The app connects over TLS and initializes the table using that database role.

For local Docker development, you can put `DATABASE_URL` in an untracked `.env` file; Compose passes it to the app. Leave it unset to continue using the bundled local PostgreSQL container. Never put the Supabase database password in source control or browser JavaScript. Supabase provides the database here; the Express application still needs to run on a Node.js host.

### Deploying the Express app

Deploy this repository as a Docker web service or Node.js web service on a host that supports persistent Node processes. Set the start command to `npm start` (or build from the included `Dockerfile`), expose the host-provided `PORT`, and configure `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and a unique `SESSION_SECRET` in the host's secret settings. Leave `HTTPS_ENABLED` unset: the host should provide public HTTPS and forward requests to the app over HTTP. The app trusts that proxy so secure admin session cookies work. Do not set `TLS_*` paths unless the app itself will terminate HTTPS.

## Visual Design

The browser speed test and admin dashboard use the Gruvbox dark palette. The public browser experience has a responsive sidebar, speed-test workspace, embedded coverage map, and About section. Keep new interface elements within the same warm backgrounds and Gruvbox accent colors.
