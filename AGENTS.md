# Repository Guidelines

## Project Structure & Module Organization

This is a small Node.js/Express API for speed tests and GPS-backed result logging. The application entry point is `server.js`; it defines HTTP routes, input validation, Passport session authentication, PostgreSQL initialization, static-file hosting, and graceful startup behavior. Public browser assets live in `public/`; the protected admin document lives in `admin/`. Container configuration lives in `Dockerfile` and `docker-compose.yml`. `README.md` is the source of truth for API behavior and environment variables. There are currently no separate source, test, or migration directories.

Keep new route logic close to related validation and database code in `server.js` while the service remains small. Keep browser assets dependency-free in `public/` and use the Gruvbox dark palette (warm backgrounds, cream foregrounds, green/yellow/blue accents). If it grows, split routes, database access, and validation into focused modules under `src/` and add matching tests under `test/`.

## Build, Test, and Development Commands

- `npm install` installs Node dependencies for local development.
- `npm start` runs `node server.js`; provide `DB_*`, `PORT`, and `CORS_ORIGIN` environment variables when not using Docker.
- `docker compose build` builds the API image.
- `docker compose up -d` starts the API and PostgreSQL; the API is exposed on port `8000`.
- `docker compose logs -f app` follows application logs.
- `docker compose down` stops the local stack while retaining the named database volume.

No automated test or lint command is configured. Before submitting a change, at minimum run `node --check server.js` and exercise the affected endpoint against the Compose stack (for example, `curl http://localhost:8000/api/speedtest/ping`).

## Coding Style & Naming Conventions

Use CommonJS (`require`) and JavaScript with `// @ts-check`. Follow the existing four-space indentation, semicolons, single-quoted strings, and `camelCase` variable/function names. Constants use `UPPER_SNAKE_CASE`; database columns use `snake_case`; API JSON uses `camelCase`. Validate external input, use parameterized PostgreSQL queries, bound numeric values, and avoid buffering large request bodies. Preserve unmeasured metrics and optional location as `NULL`; do not report them as zero.

## Testing Guidelines

Add tests with a future test framework when introducing non-trivial behavior. Name files after the behavior they cover (for example, `test/results.test.js`) and cover successful requests, validation failures, size limits, and database errors. Do not require a shared production database for tests.

## Commit & Pull Request Guidelines

Existing history uses short, imperative summaries such as `port changed to 8000` and `bug fix`. Keep commits focused and describe the user-visible change. Pull requests should state the API/configuration impact, link the relevant issue when available, list validation performed, and include request/response examples for endpoint changes. Before committing, update both `AGENTS.md` and `README.md` when the change affects contributor guidance, configuration, or API contracts. Never commit real credentials; use environment variables.
