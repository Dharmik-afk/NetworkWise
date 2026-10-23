// @ts-check
/**
 * @file server.js
 * @brief Production-Hardened Speed Test Backend API with GPS Logging
 */

const express = require('express');
const { Pool } = require('pg');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
const PORT = parseInt(process.env.PORT || '8000', 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';

app.use(cors({
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));

// Strictly parse DB_PORT and configure connection pool timeouts
const dbPort = parseInt(process.env.DB_PORT || '5432', 10);
const pool = new Pool({
    host: process.env.DB_HOST || 'postgres',
    port: Number.isNaN(dbPort) ? 5432 : dbPort,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'secret',
    database: process.env.DB_NAME || 'speedtest',
    max: 20,                        // Max 20 concurrent connections
    idleTimeoutMillis: 30000,       // Close idle clients after 30s
    connectionTimeoutMillis: 5000   // Fail fast if DB is unreachable
});

// Prevent unhandled pool errors from crashing the Node process
pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client:', err);
});

/**
 * Helper to validate finite numbers and clamp them to SQL NUMERIC(p, s) bounds.
 * @param {unknown} val 
 * @param {number} min 
 * @param {number} max 
 * @param {number | null} fallback 
 * @returns {number | null}
 */
function sanitizeNumeric(val, min, max, fallback = null) {
    const num = typeof val === 'number' ? val : Number(val);
    if (val === null || val === undefined || val === '' || !Number.isFinite(num)) {
        return fallback;
    }
    return Math.min(Math.max(num, min), max);
}

async function initDb() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS speed_test_results (
            id SERIAL PRIMARY KEY,
            download_speed_mbps NUMERIC(10, 2),
            upload_speed_mbps NUMERIC(10, 2),
            ping_ms NUMERIC(6, 2),
            latitude DOUBLE PRECISION NOT NULL,
            longitude DOUBLE PRECISION NOT NULL,
            altitude NUMERIC(8, 2),
            accuracy NUMERIC(8, 2),
            device_model VARCHAR(100),
            os_version VARCHAR(50),
            network_type VARCHAR(20),
            carrier VARCHAR(100),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `);
    console.log("Database initialized successfully.");
}

const RANDOM_CHUNK_SIZE = 1024 * 1024; // 1 MB
const MAX_TRANSFER_SIZE = 100 * 1024 * 1024; // 100 MB
const RANDOM_BUFFER = crypto.randomBytes(RANDOM_CHUNK_SIZE);

// GET /api/speedtest/ping
app.get('/api/speedtest/ping', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.status(200).send('pong');
});

// GET /api/speedtest/download
app.get('/api/speedtest/download', (req, res) => {
    const rawSize = typeof req.query.size === 'string' ? parseInt(req.query.size, 10) : NaN;
    const requestedSize = Number.isFinite(rawSize) && rawSize > 0 ? rawSize : 10 * 1024 * 1024;
    const targetSize = Math.min(requestedSize, MAX_TRANSFER_SIZE);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(targetSize));
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    let bytesSent = 0;
    let isAborted = false;

    function writeChunks() {
        let canWrite = true;

        while (bytesSent < targetSize && canWrite && !isAborted) {
            const bytesRemaining = targetSize - bytesSent;
            const chunkSize = Math.min(bytesRemaining, RANDOM_CHUNK_SIZE);

            bytesSent += chunkSize;
            const chunk = RANDOM_BUFFER.subarray(0, chunkSize);

            if (bytesSent >= targetSize) {
                res.write(chunk);
                res.end();
            } else {
                canWrite = res.write(chunk);
            }
        }

        if (bytesSent < targetSize && !canWrite && !isAborted) {
            res.once('drain', writeChunks);
        }
    }

    req.on('close', () => {
        isAborted = true;
        res.removeListener('drain', writeChunks);
    });

    writeChunks();
});

// POST /api/speedtest/upload
app.post('/api/speedtest/upload', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    let bytesReceived = 0;
    let limitExceeded = false;

    req.on('data', (chunk) => {
        bytesReceived += chunk.length;
        if (bytesReceived > MAX_TRANSFER_SIZE) {
            limitExceeded = true;
            req.pause();
            if (!res.headersSent) {
                res.status(413).json({ error: 'Upload payload exceeds 100MB limit.' });
            }
            req.destroy();
        }
    });

    req.on('end', () => {
        if (!limitExceeded && !res.headersSent) {
            res.status(200).json({
                success: true,
                bytesReceived
            });
        }
    });

    req.on('error', (err) => {
        console.error("Upload stream error:", err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Upload stream interrupted' });
        }
    });
});

// Scoped JSON parser with explicit 10KB payload cap to prevent memory attacks
const jsonParser = express.json({ limit: '10kb' });

// POST /api/results
app.post('/api/results', jsonParser, async (req, res) => {
    try {
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
            return res.status(400).json({ error: 'Request body must be a valid JSON object.' });
        }

        const {
            downloadSpeedMbps,
            uploadSpeedMbps,
            pingMs,
            gps,
            timestamp
        } = req.body;

        const metadata = (req.body.metadata && typeof req.body.metadata === 'object' && !Array.isArray(req.body.metadata))
            ? req.body.metadata
            : {};

        if (!gps || typeof gps !== 'object' || !Number.isFinite(gps.latitude) || !Number.isFinite(gps.longitude)) {
            return res.status(400).json({ error: 'Valid numerical GPS coordinates are required.' });
        }
        if (gps.latitude < -90 || gps.latitude > 90 || gps.longitude < -180 || gps.longitude > 180) {
            return res.status(400).json({ error: 'GPS coordinates out of valid planetary bounds.' });
        }

        let recordDate = new Date();
        if (timestamp !== undefined && timestamp !== null) {
            const parsedDate = new Date(timestamp);
            if (Number.isNaN(parsedDate.getTime())) {
                return res.status(400).json({ error: 'Invalid timestamp format.' });
            }
            recordDate = parsedDate;
        }

        const query = `
            INSERT INTO speed_test_results (
                download_speed_mbps, upload_speed_mbps, ping_ms,
                latitude, longitude, altitude, accuracy,
                device_model, os_version, network_type, carrier, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING id;
        `;

        // Sanitize numbers to match PostgreSQL NUMERIC(p, s) precision and prevent SQLSTATE 22003 overflow
        const values = [
            sanitizeNumeric(downloadSpeedMbps, 0, 99999999.99, 0),
            sanitizeNumeric(uploadSpeedMbps, 0, 99999999.99, 0),
            sanitizeNumeric(pingMs, 0, 9999.99, 0),
            gps.latitude,
            gps.longitude,
            sanitizeNumeric(gps.altitude, -999999.99, 999999.99, null), // Preserves 0 (sea level)!
            sanitizeNumeric(gps.accuracy, 0, 999999.99, null),
            String(metadata.deviceModel ?? 'Unknown').slice(0, 100),
            String(metadata.osVersion ?? 'Unknown').slice(0, 50),
            String(metadata.networkType ?? 'Unknown').slice(0, 20),
            String(metadata.carrier ?? 'Unknown').slice(0, 100),
            recordDate
        ];

        const result = await pool.query(query, values);

        return res.status(201).json({
            success: true,
            message: 'Metrics saved successfully.',
            recordId: result.rows[0].id
        });

    } catch (error) {
        console.error('Database insertion error:', error);
        return res.status(500).json({ error: 'Internal server error while saving record' });
    }
});

// Start server and handle graceful shutdown
let server;
initDb()
    .then(() => {
        server = app.listen(PORT, () => {
            console.log(`Optimized Speed Test Server running on port ${PORT}`);
        });
    })
    .catch((err) => {
        console.error('Fatal startup error:', err);
        process.exit(1);
    });

// Graceful shutdown to prevent corrupting active DB writes on container stop
async function shutdown(signal) {
    console.log(`\nReceived ${signal}. Closing HTTP server and DB pool...`);
    if (server) {
        server.close(() => console.log('HTTP server closed.'));
    }
    await pool.end();
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
