// @ts-check
/**
 * @file server.js
 * @brief Production-Hardened Speed Test Backend API with GPS Logging (Vercel + Docker Compatible)
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
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';
const SESSION_SECRET = process.env.SESSION_SECRET || 'development-session-secret-change-this';
const HTTPS_ENABLED = process.env.HTTPS_ENABLED === 'true';
const IS_VERCEL = Boolean(process.env.VERCEL);

// Hosting platforms terminate TLS at their proxy and forward HTTP to this process.
app.set('trust proxy', 1);

// Allow configured CORS_ORIGIN or dynamically reflect same-origin requests on Vercel
app.use(cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));

// Check all standard Vercel Storage / Postgres environment variable names
const rawDatabaseUrl =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.STORAGE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.NEON_DATABASE_URL;

// Strip ?sslmode=... from the URL so pg's ssl object configuration works reliably
let databaseUrl = rawDatabaseUrl;
if (rawDatabaseUrl) {
    try {
        const parsedUrl = new URL(rawDatabaseUrl);
        parsedUrl.searchParams.delete('sslmode');
        databaseUrl = parsedUrl.toString();
    } catch {
        databaseUrl = rawDatabaseUrl;
    }
}

// Strictly parse DB_PORT and configure connection pool timeouts
const dbPort = parseInt(process.env.DB_PORT || '5432', 10);
const pool = new Pool({
    ...(databaseUrl
        ? {
            connectionString: databaseUrl,
            ssl: { rejectUnauthorized: false }
        }
        : {
            host: process.env.DB_HOST || 'postgres',
            port: Number.isNaN(dbPort) ? 5432 : dbPort,
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD || 'secret',
            database: process.env.DB_NAME || 'speedtest'
        }),
    max: IS_VERCEL ? 5 : 20,        // Lower max connections per serverless instance
    idleTimeoutMillis: 30000,       // Close idle clients after 30s
    connectionTimeoutMillis: 15000  // 15s timeout so serverless Postgres has time to wake up from cold start
});

// Prevent unhandled pool errors from crashing the Node process
pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client:', err);
});

// Initialize database tables once per serverless instance cold start
let dbInitPromise = null;
async function initDb() {
    if (!dbInitPromise) {
        dbInitPromise = (async () => {
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
            await pool.query(`
                CREATE TABLE IF NOT EXISTS admin_sessions (
                    sid VARCHAR NOT NULL PRIMARY KEY,
                    sess JSON NOT NULL,
                    expire TIMESTAMP(6) NOT NULL
                );
            `);
            console.log('Database initialized successfully.');
        })().catch((err) => {
            dbInitPromise = null; // Reset so the next request retries if DB was still waking up
            throw err;
        });
    }
    return dbInitPromise;
}

// Built-in PostgreSQL session store (zero external dependencies required)
class PostgresSessionStore extends session.Store {
    get(sid, callback) {
        initDb()
            .then(() => pool.query('SELECT sess FROM admin_sessions WHERE sid = $1 AND expire > NOW()', [sid]))
            .then((res) => callback(null, res.rows[0] ? res.rows[0].sess : null))
            .catch((err) => callback(err));
    }

    set(sid, sess, callback = () => {}) {
        const maxAge = sess.cookie && typeof sess.cookie.maxAge === 'number' ? sess.cookie.maxAge : 8 * 60 * 60 * 1000;
        const expire = new Date(Date.now() + maxAge);
        initDb()
            .then(() => pool.query(
                `INSERT INTO admin_sessions (sid, sess, expire)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
                [sid, sess, expire]
            ))
            .then(() => callback(null))
            .catch((err) => callback(err));
    }

    destroy(sid, callback = () => {}) {
        initDb()
            .then(() => pool.query('DELETE FROM admin_sessions WHERE sid = $1', [sid]))
            .then(() => callback(null))
            .catch((err) => callback(err));
    }
}

app.use(session({
    store: new PostgresSessionStore(),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: IS_VERCEL || HTTPS_ENABLED,
        maxAge: 8 * 60 * 60 * 1000
    }
}));

app.use(passport.initialize());
app.use(passport.session());

function matchesAdminPassword(password) {
    const supplied = crypto.createHash('sha256').update(String(password)).digest();
    const expected = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
    return crypto.timingSafeEqual(supplied, expected);
}

passport.use(new LocalStrategy((username, password, done) =>
    done(null, username === ADMIN_USERNAME && matchesAdminPassword(password) ? { username: ADMIN_USERNAME } : false)
));
passport.serializeUser((user, done) => done(null, user.username));
passport.deserializeUser((username, done) => done(null, username === ADMIN_USERNAME ? { username } : false));

function requireAdmin(req, res, next) {
    if (req.isAuthenticated()) return next();
    return req.path.startsWith('/api/')
        ? res.status(401).json({ error: 'Admin authentication is required.' })
        : res.redirect('/admin/login');
}

app.get('/admin/login', (req, res) =>
    req.isAuthenticated()
        ? res.redirect('/admin')
        : res.sendFile(path.join(__dirname, 'public', 'admin-login.html'))
);
app.post('/admin/login', express.urlencoded({ extended: false }), passport.authenticate('local', { failureRedirect: '/admin/login?error=1' }), (req, res) => res.redirect('/admin'));
app.post('/admin/logout', requireAdmin, (req, res, next) => req.logout((error) => error ? next(error) : req.session.destroy(() => res.redirect('/admin/login'))));
app.get(['/admin', '/admin/'], requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')));
app.get('/admin/map', (req, res) => res.redirect(301, '/map'));
app.get('/map', (req, res) => res.sendFile(path.join(__dirname, 'public', 'map.html')));

app.use('/vendor', express.static(path.join(__dirname, 'node_modules', '@cloudflare', 'speedtest', 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

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

// Scoped JSON parser with explicit 10KB payload cap to prevent memory attacks
const jsonParser = express.json({ limit: '10kb' });

// POST /api/results
app.post('/api/results', jsonParser, async (req, res) => {
    try {
        await initDb();

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
        await initDb();
        const result = await pool.query('SELECT id, download_speed_mbps, upload_speed_mbps, ping_ms, latitude, longitude, accuracy, device_model, os_version, network_type, carrier, created_at FROM speed_test_results ORDER BY created_at DESC LIMIT 100');
        return res.json({ results: result.rows });
    } catch (error) {
        console.error('Admin results query error:', error);
        return res.status(500).json({ error: 'Unable to load saved results.' });
    }
});

// GET /api/network-speeds: return recent GPS-tagged speed samples for the public map.
app.get('/api/network-speeds', async (req, res) => {
    try {
        await initDb();
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

// Start persistent server only when running outside Vercel (e.g., Docker or local Node)
let server;
if (!IS_VERCEL) {
    initDb()
        .then(() => {
            if (HTTPS_ENABLED) {
                const keyPath = process.env.TLS_KEY_PATH || path.join(__dirname, 'certs', 'localhost-key.pem');
                const certPath = process.env.TLS_CERT_PATH || path.join(__dirname, 'certs', 'localhost-cert.pem');
                const tlsOptions = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
                server = https.createServer(tlsOptions, app).listen(PORT, HOST, () => {
                    console.log(`HTTPS server listening on port ${PORT}.`);
                });
            } else {
                const http = require('http');
                server = http.createServer(app).listen(PORT, HOST, () => {
                    console.log(`HTTP server listening on port ${PORT}.`);
                });
            }
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
}

// Export Express app for Vercel Serverless
module.exports = app;
