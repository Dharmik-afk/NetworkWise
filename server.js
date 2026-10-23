/**
 * @file server.js
 * @brief Advanced Speed Test Backend API with GPS Logging
 * @details Provides endpoints for latency measurement, dynamic download/upload throughput testing,
 *          and saving geographic performance metrics to a PostgreSQL database.
 */

const express = require('express');
const { Pool } = require('pg');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL Connection Pool
const pool = new Pool({
    host: process.env.DB_HOST || 'postgres',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'secret',
    database: process.env.DB_NAME || 'speedtest'
});

/**
 * @brief Initializes the database schema.
 * @details Creates the `speed_test_results` table if it does not already exist on startup.
 * @return {Promise<void>}
 */
async function initDb() {
    try {
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
    } catch (err) {
        console.error("Database initialization failed:", err.message);
    }
}
initDb();

/* 
 * Pre-generate a 1MB buffer of cryptographic random data.
 * Using random data prevents network hardware from compressing the payload
 * on the fly, ensuring true network throughput measurement.
 */
const RANDOM_CHUNK_SIZE = 1024 * 1024; // 1 MB
const RANDOM_BUFFER = crypto.randomBytes(RANDOM_CHUNK_SIZE);

/**
 * @brief GET /api/speedtest/ping
 * @details Lightweight endpoint for measuring network latency (round-trip time).
 * @return {String} HTTP 200 with text 'pong'
 */
app.get('/api/speedtest/ping', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.status(200).send('pong');
});

/**
 * @brief GET /api/speedtest/download
 * @details Streams pseudo-random binary data to the client to measure download speeds.
 *          Handles backpressure and client disconnects to prevent memory leaks.
 * @param {number} req.query.size Optional payload size in bytes (default: 10MB, max: 100MB).
 * @return {BinaryStream} A continuous stream of uncompressible bytes.
 */
app.get('/api/speedtest/download', (req, res) => {
    const requestedSize = parseInt(req.query.size, 10) || 10 * 1024 * 1024; 
    const maxSize = 100 * 1024 * 1024; // Hard cap at 100MB to protect bandwidth abuse
    const targetSize = Math.min(Math.max(requestedSize, 1), maxSize);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', targetSize);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    let bytesSent = 0;
    let isAborted = false;

    // Halt stream if the client prematurely disconnects (e.g., lost cell signal)
    req.on('close', () => {
        isAborted = true;
    });

    /**
     * @brief Writes chunks of data to the socket while respecting TCP backpressure.
     */
    function writeChunks() {
        let canWrite = true;
        
        while (bytesSent < targetSize && canWrite && !isAborted) {
            const bytesRemaining = targetSize - bytesSent;
            const chunkSize = Math.min(bytesRemaining, RANDOM_CHUNK_SIZE);
            
            bytesSent += chunkSize;
            
            if (bytesSent >= targetSize) {
                res.write(RANDOM_BUFFER.slice(0, chunkSize));
                res.end();
            } else {
                // write() returns false if the OS network buffer is full
                canWrite = res.write(RANDOM_BUFFER.slice(0, chunkSize));
            }
        }
        
        // If the OS buffer is full, wait for it to drain before writing more
        if (bytesSent < targetSize && !canWrite && !isAborted) {
            res.once('drain', writeChunks);
        }
    }

    writeChunks();
});

/**
 * @brief POST /api/speedtest/upload
 * @details Consumes an incoming binary stream to measure upload speed.
 *          Bypasses memory allocation; streams bytes and immediately discards them.
 * @return {Object} JSON payload containing the total bytes successfully received.
 */
app.post('/api/speedtest/upload', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    
    let bytesReceived = 0;

    // Stream chunks directly. Do not save to memory or disk.
    req.on('data', (chunk) => {
        bytesReceived += chunk.length;
    });

    req.on('end', () => {
        res.status(200).json({
            success: true,
            bytesReceived: bytesReceived
        });
    });

    req.on('error', (err) => {
        console.error("Upload stream error:", err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Upload stream interrupted' });
        }
    });
});

/**
 * Middleware initialization.
 * Applied specifically ONLY to the /api/results endpoint.
 * Prevents express.json() from accidentally trying to parse gigabytes of raw upload data.
 */
const jsonParser = express.json();

/**
 * @brief POST /api/results
 * @details Validates and stores the speed test metrics and GPS data in PostgreSQL.
 * @param {Object} req.body JSON payload containing metrics, geographical bounds, and metadata.
 * @return {Object} JSON response indicating success and the assigned database ID.
 */
app.post('/api/results', jsonParser, async (req, res) => {
    try {
        const {
            downloadSpeedMbps,
            uploadSpeedMbps,
            pingMs,
            gps,
            metadata = {},
            timestamp
        } = req.body;

        // Validation checks for invalid geographic states
        if (!gps || typeof gps.latitude !== 'number' || typeof gps.longitude !== 'number') {
            return res.status(400).json({ error: 'Valid numerical GPS coordinates are required.' });
        }
        if (gps.latitude < -90 || gps.latitude > 90 || gps.longitude < -180 || gps.longitude > 180) {
            return res.status(400).json({ error: 'GPS coordinates out of valid planetary bounds.' });
        }

        const query = `
            INSERT INTO speed_test_results (
                download_speed_mbps, upload_speed_mbps, ping_ms,
                latitude, longitude, altitude, accuracy,
                device_model, os_version, network_type, carrier, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING id;
        `;

        // Strict parsing limits lengths to prevent string overflow attacks
        const values = [
            parseFloat(downloadSpeedMbps) || 0,
            parseFloat(uploadSpeedMbps) || 0,
            parseFloat(pingMs) || 0,
            gps.latitude,
            gps.longitude,
            parseFloat(gps.altitude) || null,
            parseFloat(gps.accuracy) || null,
            String(metadata.deviceModel || 'Unknown').substring(0, 100),
            String(metadata.osVersion || 'Unknown').substring(0, 50),
            String(metadata.networkType || 'Unknown').substring(0, 20),
            String(metadata.carrier || 'Unknown').substring(0, 100),
            timestamp ? new Date(timestamp) : new Date()
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

app.listen(PORT, () => {
    console.log(`Optimized Speed Test Server running on port ${PORT}`);
});
