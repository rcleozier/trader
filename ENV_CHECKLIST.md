# Environment Variables Checklist

## ✅ REQUIRED (Bot won't start without these)

```bash
# Kalshi API Credentials
KALSHI_API_BASE_URL=https://api.trade.kalshi.com/trade-api/v2
KALSHI_API_KEY_ID=your_api_key_id
# Either set one of these (not both):
KALSHI_PRIVATE_KEY_PATH=/path/to/private/key.pem
# OR
KALSHI_PRIVATE_KEY_PEM="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
```

## ⚙️ TRADING CONFIGURATION

```bash
# Enable/disable live trading (set to 'true' to actually place orders)
LIVE_TRADES=false

# Minimum balance required before placing trades
MIN_BALANCE_TO_BET=10

# Maximum bet size per trade (in dollars)
# If not set, uses edge size (3pp edge = $3 bet, etc.)
MAX_BET_SIZE=10

# Per-market capital limit (in dollars)
MAX_PER_MARKET=25

# Per-strategy capital limits (in dollars)
MAX_PER_STRATEGY_MISPRICING=100
# (Arbitrage and spread farming are disabled, but these exist for future use)
MAX_PER_STRATEGY_ARBITRAGE=200
MAX_PER_STRATEGY_SPREAD=50
```

## 📊 MISPRICING STRATEGY

```bash
# Minimum percentage point difference to trigger a trade (default: 0.10 = 10pp)
MISPRICING_THRESHOLD_PCT=0.10

# Minimum edge after accounting for execution costs (default: 0.05 = 5pp)
MIN_EDGE_AFTER_COSTS_PCT=0.05
```

## 🛡️ RISK LIMITS (Recommended to set)

```bash
# Maximum number of open positions total
MAX_POSITIONS_TOTAL=20

# Maximum positions per market
MAX_POSITIONS_PER_MARKET=2

# Maximum order size (in dollars)
MAX_ORDER_NOTIONAL=50

# Daily limits
MAX_DAILY_TRADES=50
MAX_DAILY_NOTIONAL=500
MAX_DAILY_LOSS=100
```

## 💰 EXIT RULES

```bash
# Take profit: cents per contract (default: 2¢)
TAKE_PROFIT_CENTS_PER_CONTRACT=2

# Take profit: percentage of cost (default: 10%)
TAKE_PROFIT_PCT_OF_COST=10

# Maximum hold time in minutes (default: 180 = 3 hours)
MAX_HOLD_MINUTES=180

# Stop loss: percentage (optional, set to disable)
STOP_LOSS_PCT=25

# Improve exit price by 1 tick for faster fills (default: true)
IMPROVE_EXIT_BY_ONE_TICK=true
```

## 📅 SCHEDULING (Optional)

```bash
# Cron expression for scheduled runs (e.g., "*/5 * * * *" = every 5 minutes)
# If not set, runs once and exits
RUN_SCHEDULE_CRON=*/5 * * * *
```

## 📧 NOTIFICATIONS (Optional)

```bash
# Twilio SMS notifications
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_FROM_NUMBER=+1234567890
ALERT_TO_NUMBER=+1234567890

# SendGrid email notifications
SEND_GRID=your_sendgrid_api_key
EMAIL_ADDRESS=your_email@example.com

# SMTP email notifications (alternative to SendGrid)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@gmail.com
SMTP_PASSWORD=your_app_password
EMAIL_FROM=your_email@gmail.com
EMAIL_TO=recipient@example.com
```

## 🎯 CURRENT STRATEGY STATUS

- ✅ **Mispricing Strategy**: ENABLED (only strategy active)
- ❌ **Arbitrage Strategy**: DISABLED
- ❌ **Spread Farming Strategy**: DISABLED

## 📝 NOTES

- All dollar amounts are in USD
- All percentages are decimals (0.10 = 10%)
- Time values are in minutes unless specified
- The bot runs on Vercel cron every 5 minutes (configured in vercel.json)

