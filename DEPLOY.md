# Cloudflare Pages Deployment Guide

This guide covers deploying Seek&Track to Cloudflare Pages with Workers (free tier, no credit card required).

## Architecture

- **Frontend**: Static React app served from Cloudflare Pages
- **Backend**: Hono API running on Cloudflare Workers (via Pages Advanced Mode with `_worker.js`)
- **Database**: Neon Postgres (existing DATABASE_URL)
- **Authentication**: HTTP Basic Auth at the edge with `AUTH_PASSWORD` environment variable

## Prerequisites

1. **Cloudflare Account** (free tier)
2. **Neon Postgres** database (your existing `DATABASE_URL`)
3. **GitHub repository** connected to Cloudflare Pages
4. **Node.js 18+** for local builds

## Required Secrets

Set these environment variables in the Cloudflare Dashboard (Settings → Environment Variables) or via CLI:

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `DATABASE_URL` | **Yes** | Neon Postgres connection string | `postgres://user:pass@host/db` |
| `AUTH_PASSWORD` | **Yes** | Password for dashboard access | `my-secure-password-123` |
| `AUTH_USER` | No | Username for HTTP Basic auth (default: `admin`) | `admin` |

### Setting Secrets via Cloudflare Dashboard

1. Go to **Workers & Pages** → Your project → **Settings** → **Environment Variables**
2. Add variables for **Production** environment:
   - `DATABASE_URL`: Your Neon Postgres connection string
   - `AUTH_PASSWORD`: Your chosen password
   - `AUTH_USER`: (optional) Username, defaults to `admin`

### Setting Secrets via Wrangler CLI

```bash
wrangler pages secret put DATABASE_URL --project-name=seek-track
wrangler pages secret put AUTH_PASSWORD --project-name=seek-track
wrangler pages secret put AUTH_USER --project-name=seek-track  # optional
```

## Build Commands

### Local Build & Deploy

```bash
# Install dependencies
npm install

# Build for Cloudflare Pages
npm run build:cf

# Deploy to Cloudflare Pages
npx wrangler pages deploy dist-cf --project-name=seek-track
```

### Automated Build (Cloudflare Pages GitHub Integration)

Configure in Cloudflare Dashboard → Pages → Settings → Builds:

- **Build command**: `npm run build:cf`
- **Build output directory**: `dist-cf`
- **Root directory**: `/` (or leave empty)
- **Node version**: `18` or `20`

## What `npm run build:cf` Does

1. **Compiles TypeScript frontend** (`vite build` → `dist/`)
2. **Compiles TypeScript backend** (`tsc` → `dist-server/`)
3. **Prepares Cloudflare structure** (`scripts/prepare-cf-pages.js`):
   - Copies `dist/` static assets to `dist-cf/`
   - Copies `dist-server/` compiled API to `dist-cf/dist-server/`
   - Creates `dist-cf/_worker.js` (Cloudflare Pages Advanced Mode entry point)

## Deployment Steps (First Time)

### Option A: Cloudflare Dashboard (Recommended)

1. **Push your code** to GitHub (this branch: `cursor/cloudflare-pages-workers-deployment-a301`)
2. **Log in to Cloudflare Dashboard** → **Workers & Pages**
3. **Create a new Pages project**:
   - Connect your GitHub repository
   - Select branch: `cursor/cloudflare-pages-workers-deployment-a301` (or `main` after merge)
   - **Build command**: `npm run build:cf`
   - **Build output directory**: `dist-cf`
4. **Add environment variables** (see "Required Secrets" above)
5. **Save and Deploy**

### Option B: Wrangler CLI

```bash
# Install Wrangler globally (optional)
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Build locally
npm run build:cf

# Create Pages project and deploy
npx wrangler pages project create seek-track
npx wrangler pages deploy dist-cf --project-name=seek-track

# Set secrets (see "Required Secrets" section)
npx wrangler pages secret put DATABASE_URL --project-name=seek-track
npx wrangler pages secret put AUTH_PASSWORD --project-name=seek-track
```

## Health Check

After deployment, verify the API is running:

```bash
curl https://seek-track.pages.dev/api/health
```

Expected response:
```json
{"ok": true}
```

**Note**: `/api/health` is publicly accessible (no auth required) for monitoring.

## Authentication

All routes except `/api/health` require HTTP Basic Authentication:

- **Username**: Value of `AUTH_USER` env var (defaults to `admin`)
- **Password**: Value of `AUTH_PASSWORD` env var

### Testing Authentication

```bash
# Will return 401 Unauthorized
curl https://seek-track.pages.dev/api/trades

# With authentication
curl -u admin:your-password https://seek-track.pages.dev/api/trades
```

Browsers will prompt for credentials when accessing the dashboard.

## Local Development

The existing local development workflow still works:

```bash
# Start Postgres (or use Neon DATABASE_URL)
npm run db:up

# Copy .env.example to .env and set DATABASE_URL
cp .env.example .env

# Run dev server (Vite + Node API)
npm run dev
```

Open http://localhost:5173

**Note**: Authentication is **disabled** in local dev if `AUTH_PASSWORD` is not set.

## Features Verified

All existing features remain functional:

- ✅ **CSV Import**: Schwab-style CSV with row_hash deduplication
- ✅ **FIFO P&L**: Realized and unrealized calculations with open lots
- ✅ **Watchlist**: Neon-persisted, Yahoo quotes, 52w high/low, add/remove, sort
- ✅ **Research Tab**: Silicon/semiconductor universe with ETF pairs
- ✅ **Calculator**: What-if P&L scenarios
- ✅ **Charges Tab**: Fee tracking
- ✅ **Dark Theme**: Mobile-friendly layout
- ✅ **Health Check**: `/api/health` endpoint for monitoring

## Troubleshooting

### Build Failures

**Error**: `Cannot find module '@neondatabase/serverless'`
- Run: `npm install @neondatabase/serverless`

**Error**: `DATABASE_URL is required`
- Ensure `DATABASE_URL` is set in Cloudflare environment variables

### Authentication Issues

**Error**: `Authentication required` on all routes
- Verify `AUTH_PASSWORD` is set in Cloudflare environment variables
- Check username matches `AUTH_USER` (default: `admin`)

### Database Connection Failures

**Error**: `database unavailable` from `/api/health`
- Verify `DATABASE_URL` format: `postgres://user:pass@host/db`
- Check Neon database is running and accessible
- Neon serverless driver requires WebSocket support (Cloudflare provides this)

### Schema Not Initializing

The schema is automatically initialized on cold start. If issues occur:
- Check Cloudflare Pages logs in Dashboard
- Verify `server/schema.sql` was copied to `dist-server/schema.sql` during build

## Monitoring

- **Health endpoint**: `https://your-project.pages.dev/api/health` (public)
- **Cloudflare Analytics**: Dashboard → Pages → Analytics
- **Logs**: Dashboard → Pages → Functions → Logs (real-time)

## Cost

Free tier limits (as of 2024):

- **Cloudflare Pages**: 500 builds/month, 100,000 requests/day
- **Cloudflare Workers**: 100,000 requests/day (via Pages)
- **Neon Postgres**: Free tier available (check Neon docs)

No credit card required for Cloudflare free tier.

## Differences from Node.js Deployment

1. **Database Driver**: Changed from `pg` to `@neondatabase/serverless` (Cloudflare Workers compatible)
2. **Cron Jobs**: Background cron for quote refresh is disabled on Workers (use Cloudflare Cron Triggers if needed)
3. **File System**: `server/schema.sql` is embedded at build time (no runtime file reads)
4. **Authentication**: Added HTTP Basic Auth middleware (was previously no auth)

## Cron Jobs (Optional)

Quote refresh (`/api/quotes/refresh`) and research refresh are currently triggered on-demand.

To enable periodic refresh on Cloudflare Workers:

1. Configure **Cron Triggers** in Dashboard → Pages → Settings → Triggers
2. Add schedule: `*/15 * * * *` (every 15 minutes)
3. Route: `/api/quotes/refresh`

## Security Notes

- **Secrets**: Never commit `AUTH_PASSWORD` or `DATABASE_URL` to Git
- **HTTP Basic Auth**: Use strong passwords; consider adding rate limiting if needed
- **Database**: Neon connection strings include credentials — treat as secrets
- **HTTPS**: Cloudflare Pages serves everything over HTTPS by default

## Support & Issues

- **Cloudflare Docs**: https://developers.cloudflare.com/pages/
- **Wrangler CLI**: https://developers.cloudflare.com/workers/wrangler/
- **Neon Serverless**: https://neon.tech/docs/serverless/serverless-driver

## HostOps Handoff Checklist

- [ ] Merge PR to `main` branch
- [ ] Connect GitHub repo to Cloudflare Pages
- [ ] Set build command: `npm run build:cf`
- [ ] Set build output: `dist-cf`
- [ ] Add environment variables: `DATABASE_URL`, `AUTH_PASSWORD`, `AUTH_USER`
- [ ] Deploy and verify `/api/health` returns `{"ok": true}`
- [ ] Test authentication with username/password
- [ ] Test CSV import, watchlist, and other core features
- [ ] (Optional) Configure Cron Triggers for auto-refresh
