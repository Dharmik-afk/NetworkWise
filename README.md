# Advanced Speed Test & GPS Logging Backend

This is a production-ready Node.js and Express backend designed to support mobile and web applications performing network speed tests. It provides memory-efficient endpoints for measuring ping, download throughput, and upload throughput, and logs the results alongside geographical metadata into a PostgreSQL database.

## Features

* **Throughput Measurement:** Streams binary download payloads and consumes upload bytes without buffering the entire request.
* **Memory-Efficient Streams:** Handles massive upload and download tests using Node.js streams. It processes bytes without loading entire files into RAM, preventing memory exhaustion.
* **Geographic Data Validation:** Validates GPS coordinates and logs them using double-precision bounds checking.
* **Dockerized:** Fully containerized with Docker and Docker Compose for instant deployment alongside a PostgreSQL instance.
* **Auto-Migrating Database:** Automatically initializes the necessary SQL tables upon startup.

## Prerequisites

* [Docker](https://docs.docker.com/get-docker/)
* [Docker Compose](https://docs.docker.com/compose/install/) (Included in Docker Desktop and recent Docker installations)

## Getting Started

1. **Clone or create the project files:** Ensure `server.js`, `package.json`, `Dockerfile`, and `docker-compose.yml` are in the same directory.
2. **Build the containers:**
   ```bash
   docker compose build
   ```
3. **Start the server and database:**
   ```bash
   docker compose up -d
   ```
4. **View logs (optional):**
   ```bash
   docker compose logs -f
   ```

The server will be available at `http://localhost:8000`. Open that address in a browser to use the included plain HTML/CSS/JavaScript speed-test interface. It requests the browser's current location, runs three latency checks followed by a streamed 35 MB download, shows the live measured download speed and transfer progress, and saves the measured values with any browser-available location and metadata. Location permission is optional. Browsers require HTTPS for geolocation outside `localhost`; browser privacy controls prevent collecting a real carrier and may limit device model details.

## Configuration

The Docker Compose file supplies the database settings shown below. Override them when running the server outside Docker or when deploying it to another environment.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8000` | HTTP listening port. |
| `CORS_ORIGIN` | `http://localhost:3000` | Single browser origin allowed by CORS. |
| `DB_HOST` | `postgres` | PostgreSQL host. |
| `DB_PORT` | `5432` | PostgreSQL port. |
| `DB_USER` | `postgres` | PostgreSQL user. |
| `DB_PASSWORD` | `secret` | PostgreSQL password. |
| `DB_NAME` | `speedtest` | PostgreSQL database name. |
| `ADMIN_USERNAME` | `admin` | Admin dashboard username. |
| `ADMIN_PASSWORD` | `change-me` | Admin dashboard password; change before production. |
| `SESSION_SECRET` | development-only value | Secret used to sign admin sessions; change before production. |

For production, set a non-default database password and set `CORS_ORIGIN` to the origin of the client application.

## Admin Dashboard

Visit `/admin` to sign in and view the 100 most recent saved tests. Results can be sorted by time, download speed, or ping. The dashboard uses Passport local authentication and HTTP-only Express sessions. Set strong, unique `ADMIN_PASSWORD` and `SESSION_SECRET` values before deployment. The Compose defaults (`admin` / `change-me`) are for local development only.

## Visual Design

The browser speed test and admin dashboard use the Gruvbox dark color palette. Keep new interface elements within the same warm backgrounds and Gruvbox accent colors.

---

## API Reference

### 1. Measure Latency (Ping)
* **Endpoint:** `GET /api/speedtest/ping`
* **Description:** A lightweight endpoint to measure round-trip latency.
* **Response:** HTTP 200 with text `pong`.

### 2. Download Speed Test
* **Endpoint:** `GET /api/speedtest/download`
* **Query Parameters:** 
  * `size` (optional): The requested payload size in bytes. Defaults to 10MB. Max is 100MB. (e.g., `?size=15000000` for ~15MB).
* **Description:** Streams binary data to the client. The server reuses a cryptographically random 1 MB buffer for larger responses.
* **Response:** `application/octet-stream` of the requested size.

### 3. Upload Speed Test
* **Endpoint:** `POST /api/speedtest/upload`
* **Description:** Consumes an incoming binary stream to measure upload throughput. Data is counted and immediately discarded.
* **Limit:** Requests larger than 100 MB receive HTTP 413.
* **Response:**
  ```json
  {
    "success": true,
    "bytesReceived": 5242880
  }
  ```

### 4. Submit Results
* **Endpoint:** `POST /api/results`
* **Headers:** `Content-Type: application/json`
* **Description:** Saves the calculated metrics, GPS location, and device metadata to the PostgreSQL database.
* **Validation:** The JSON body may be at most 10 KB. `gps` is optional; when supplied, `gps.latitude` and `gps.longitude` must be JSON numbers, with latitude from -90 to 90 and longitude from -180 to 180. When supplied, `timestamp` must be a valid date value. Unmeasured speed and latency fields are stored as `NULL`, rather than being represented as zero.
* **Request Body Example:**
  ```json
  {
    "downloadSpeedMbps": 125.4,
    "uploadSpeedMbps": 42.1,
    "pingMs": 18,
    "gps": {
      "latitude": 37.7749,
      "longitude": -122.4194,
      "altitude": 10.5,
      "accuracy": 5.0
    },
    "metadata": {
      "deviceModel": "iPhone 15",
      "osVersion": "iOS 17",
      "networkType": "5G",
      "carrier": "T-Mobile"
    },
    "timestamp": "2026-10-23T21:30:00Z"
  }
  ```
* **Response:** HTTP 201 Created
  ```json
  {
    "success": true,
    "message": "Metrics saved successfully.",
    "recordId": 1
  }
  ```

---

## Database Schema

Results are stored in the `speed_test_results` PostgreSQL table with the following core columns:
* `id` (SERIAL PRIMARY KEY)
* `download_speed_mbps` (NUMERIC)
* `upload_speed_mbps` (NUMERIC)
* `ping_ms` (NUMERIC)
* `latitude` (DOUBLE PRECISION, optional)
* `longitude` (DOUBLE PRECISION, optional)
* Metadata columns (`altitude`, `accuracy`, `device_model`, `network_type`, etc.)
* `created_at` (TIMESTAMP WITH TIME ZONE)

## Client Application Guidelines

For the most accurate results, the client app should:
1. Hit the `/api/speedtest/ping` endpoint 3-5 times and average the results (discarding the first request to account for DNS/handshake latency).
2. Measure time elapsed from the *first byte* received to the *last byte* received during the download test.
3. Use a substantial payload size (e.g., 15-50MB) on fast networks (5G/WiFi) to allow the TCP window to scale up fully.
