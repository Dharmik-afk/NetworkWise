# Advanced Speed Test & GPS Logging Backend

This is a production-ready Node.js and Express backend designed to support mobile and web applications performing network speed tests. It provides memory-efficient endpoints for measuring ping, download throughput, and upload throughput, and logs the results alongside geographical metadata into a PostgreSQL database.

## Features

* **True Throughput Measurement:** Uses cryptographically random data payloads to prevent ISP/network compression from inflating download speeds.
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

The server will be available at `http://localhost:8000`.

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
* **Description:** Streams uncompressible, random binary data to the client.
* **Response:** `application/octet-stream` of the requested size.

### 3. Upload Speed Test
* **Endpoint:** `POST /api/speedtest/upload`
* **Headers:** `Content-Type: application/octet-stream`
* **Description:** Consumes an incoming binary stream to measure upload throughput. Data is counted and immediately discarded.
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

---

## Database Schema

Results are stored in the `speed_test_results` PostgreSQL table with the following core columns:
* `id` (SERIAL PRIMARY KEY)
* `download_speed_mbps` (NUMERIC)
* `upload_speed_mbps` (NUMERIC)
* `ping_ms` (NUMERIC)
* `latitude` (DOUBLE PRECISION)
* `longitude` (DOUBLE PRECISION)
* Metadata columns (`altitude`, `accuracy`, `device_model`, `network_type`, etc.)
* `created_at` (TIMESTAMP)

## Client Application Guidelines

For the most accurate results, the client app should:
1. Hit the `/ping` endpoint 3-5 times and average the results (discarding the first request to account for DNS/handshake latency).
2. Measure time elapsed from the *first byte* received to the *last byte* received during the download test.
3. Use a substantial payload size (e.g., 15-50MB) on fast networks (5G/WiFi) to allow the TCP window to scale up fully.
