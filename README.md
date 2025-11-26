# NBA Mispricing Bot

A Node.js TypeScript bot that detects mispricings between Kalshi NBA markets and ESPN odds, sending SMS alerts when differences exceed a threshold.

## Features

- Fetches NBA game markets from Kalshi
- Fetches NBA odds from ESPN
- Converts both to implied win probabilities
- Detects mispricings where the difference exceeds 5 percentage points (configurable)
- Sends SMS alerts via Twilio when mispricings are found

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables:

```bash
cp env.example .env
```

Edit `.env` and set:
- **Kalshi**: The bot automatically reads your API key and private key from the `keys` file in the project root. The first line should be your API key ID, followed by your RSA private key.
- **ESPN**: Uses public API (no key needed)
- **Twilio**: Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, and `ALERT_TO_NUMBER`
- **Bot**: Optionally set `MISPRICING_THRESHOLD_PCT` (default: 0.05) and `RUN_SCHEDULE_CRON` (e.g., `*/5 * * * *` for every 5 minutes)

3. Run the bot:

```bash
# Development mode with auto-compilation and auto-restart
npm run dev

# Or use TypeScript directly (no compilation step)
npm run dev:ts

# Build TypeScript to JavaScript
npm run build

# Watch for changes and auto-compile (separate terminal)
npm run build:watch

# Run compiled JavaScript
npm start

# Run tests
npm test
```

## Project Structure

```
src/
  index.ts                # Entry point: runs the job (once or on cron)
  config.ts               # Loads and validates environment variables
  clients/
    kalshiClient.ts       # Fetches NBA markets from Kalshi
    espnClient.ts         # Fetches NBA odds from ESPN
  lib/
    odds.ts               # Odds/probability helper functions
    odds.test.ts          # Tests for odds helpers
  services/
    mispricingService.ts  # Logic to match games, compare probs, detect mispricing
    notificationService.ts# Wraps Twilio SMS sending
  types/
    markets.ts            # Shared types/interfaces for games/markets
```

## Scripts

- `npm run dev` - Runs nodemon with TypeScript auto-compilation and auto-restart on file changes
- `npm run dev:ts` - Runs with ts-node directly (no compilation step)
- `npm run build` - Compiles TypeScript to JavaScript in `dist/` folder
- `npm run build:watch` - Watches for TypeScript changes and auto-compiles
- `npm start` - Runs the compiled JavaScript from `dist/` folder
- `npm test` - Runs Jest tests

## Auto-Compilation

The project is configured to automatically compile TypeScript when you make changes:

- **`npm run dev`** - Uses nodemon to watch for changes and automatically restarts with ts-node
- **`npm run build:watch`** - Runs TypeScript compiler in watch mode, automatically compiling on file changes

## Keys File Format

The `keys` file should contain:
- Line 1: Your Kalshi API key ID
- Blank lines (optional)
- RSA private key starting with `-----BEGIN RSA PRIVATE KEY-----`

## References

- [Kalshi TypeScript SDK Quick Start](https://docs.kalshi.com/sdks/typescript/quickstart)
