// @ts-check
/**
 * @file server.js
 * @brief Production-Hardened Speed Test Backend API with GPS Logging
 */

const express = require('express');
const { Pool } = require('pg');
const crypto = require('crypto');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const { Strategy: LocalStrategy } = require('passport-local');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = parseInt(process.env.PORT || '8000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://localhost:3000';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';
const SESSION_SECRET = process.env.SESSION_SECRET || 'development-session-secret-change-this';

app.use(cors({
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));

app.use(session({ secret: SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: true, maxAge: 8 * 60 * 60 * 1000 } }));
app.use(passport.initialize());
app.use(passport.session());

function matchesAdminPassword(password) {
    const supplied = crypto.createHash('sha256').update(String(password)).digest();
    const expected = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
    return crypto.timingSafeEqual(supplied, expected);
}
passport.use(new LocalStrategy((username, password, done) => done(null, username === ADMIN_USERNAME && matchesAdminPassword(password) ? { username: ADMIN_USERNAME } : false)));
passport.serializeUser((user, done) => done(null, user.username));
passport.deserializeUser((username, done) => done(null, username === ADMIN_USERNAME ? { username } : false));

function requireAdmin(req, res, next) {
    if (req.isAuthenticated()) return next();
    return req.path.startsWith('/api/') ? res.status(401).json({ error: 'Admin authentication is required.' }) : res.redirect('/admin/login');
}

app.get('/admin/login', (req, res) => req.isAuthenticated() ? res.redirect('/admin') : res.sendFile(path.join(__dirname, 'public', 'admin-login.html')));
app.post('/admin/login', express.urlencoded({ extended: false }), passport.authenticate('local', { failureRedirect: '/admin/login?error=1' }), (req, res) => res.redirect('/admin'));
app.post('/admin/logout', requireAdmin, (req, res, next) => req.logout((error) => error ? next(error) : req.session.destroy(() => res.redirect('/admin/login'))));
app.get(['/admin', '/admin/'], requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')));
app.get('/admin/map', requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'admin', 'map.html')));

app.use('/vendor', express.static(path.join(__dirname, 'node_modules', '@cloudflare', 'speedtest', 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

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
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            altitude NUMERIC(8, 2),
            accuracy NUMERIC(8, 2),
            device_model VARCHAR(100),
            os_version VARCHAR(50),
            network_type VARCHAR(20),
            carrier VARCHAR(100),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `);
    await pool.query(`
        ALTER TABLE speed_test_results
        ALTER COLUMN latitude DROP NOT NULL,
        ALTER COLUMN longitude DROP NOT NULL;
    `);
    console.log("Database initialized successfully.");
}

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

        const hasGps = gps !== undefined && gps !== null;
        if (hasGps && (typeof gps !== 'object' || !Number.isFinite(gps.latitude) || !Number.isFinite(gps.longitude))) {
            return res.status(400).json({ error: 'GPS coordinates must contain valid numerical latitude and longitude values.' });
        }
        if (hasGps && (gps.latitude < -90 || gps.latitude > 90 || gps.longitude < -180 || gps.longitude > 180)) {
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
            sanitizeNumeric(downloadSpeedMbps, 0, 99999999.99, null),
            sanitizeNumeric(uploadSpeedMbps, 0, 99999999.99, null),
            sanitizeNumeric(pingMs, 0, 9999.99, null),
            hasGps ? gps.latitude : null,
            hasGps ? gps.longitude : null,
            hasGps ? sanitizeNumeric(gps.altitude, -999999.99, 999999.99, null) : null,
            hasGps ? sanitizeNumeric(gps.accuracy, 0, 999999.99, null) : null,
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

app.get('/api/admin/results', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, download_speed_mbps, upload_speed_mbps, ping_ms, latitude, longitude, accuracy, device_model, os_version, network_type, carrier, created_at FROM speed_test_results ORDER BY created_at DESC LIMIT 100');
        return res.json({ results: result.rows });
    } catch (error) {
        console.error('Admin results query error:', error);
        return res.status(500).json({ error: 'Unable to load saved results.' });
    }
});

// GET /api/network-speeds: return recent GPS-tagged speed samples for the admin map.
app.get('/api/network-speeds', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, latitude, longitude, upload_speed_mbps, download_speed_mbps, created_at
            FROM speed_test_results
            WHERE latitude IS NOT NULL
              AND longitude IS NOT NULL
              AND (upload_speed_mbps IS NOT NULL OR download_speed_mbps IS NOT NULL)
            ORDER BY created_at DESC
            LIMIT 1000
        `);

        const points = result.rows.map((row) => ({
            id: row.id,
            latitude: Number(row.latitude),
            longitude: Number(row.longitude),
            uploadSpeedMbps: row.upload_speed_mbps === null ? null : Number(row.upload_speed_mbps),
            downloadSpeedMbps: row.download_speed_mbps === null ? null : Number(row.download_speed_mbps),
            timestamp: row.created_at.toISOString()
        }));

        return res.json({ points });
    } catch (error) {
        console.error('Network speed map query error:', error);
        return res.status(500).json({ error: 'Unable to load network speed samples.' });
    }
});
// Start server and handle graceful shutdown
let server;
initDb()
    .then(() => {
        const keyPath = process.env.TLS_KEY_PATH || path.join(__dirname, 'certs', 'localhost-key.pem');
        const certPath = process.env.TLS_CERT_PATH || path.join(__dirname, 'certs', 'localhost-cert.pem');
        const tlsOptions = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
        server = https.createServer(tlsOptions, app).listen(PORT, HOST, () => {
            console.log(`HTTPS server available at https://localhost:${PORT}.`);
        });
    })
    .catch((err) => {
        console.error('Fatal startup error:', err);
        process.exit(1);
    });

// Graceful shutdown to prevent corrupting active DB writes on container stop
async function shutdown(signal) {
    console.log(`\nReceived ${signal}. Closing HTTP server and DB pool...`);
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
