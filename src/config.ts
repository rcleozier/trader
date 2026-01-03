import dotenv from 'dotenv';
import * as path from 'path';

// Load .env file from project root
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

interface Config {
  kalshi: {
    apiBaseUrl: string;
    apiKeyId: string;
    privateKeyPath?: string;
    privateKeyPem?: string;
  };
  espn: {
    apiBaseUrl: string;
  };
  sports: {
    nba: {
      espnPath: string;
      kalshiSeries: string;
    };
    nfl: {
      espnPath: string;
      kalshiSeries: string;
    };
    nhl: {
      espnPath: string;
      kalshiSeries: string;
    };
    ncaab: {
      espnPath: string;
      kalshiSeries: string;
    };
    ncaaf: {
      espnPath: string;
      kalshiSeries: string;
    };
  };
  twilio?: {
    accountSid: string;
    authToken: string;
    fromNumber: string;
    alertToNumber: string;
  };
  sendgrid?: {
    apiKey: string;
    emailAddress: string;
  };
  email?: {
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
    smtpUser: string;
    smtpPassword: string;
    fromEmail: string;
    toEmail: string;
  };
  bot: {
    mispricingThresholdPct: number;
    runScheduleCron?: string;
    minEdgeAfterCostsPct?: number; // Minimum edge after accounting for execution costs
  };
  trading: {
    liveTrades: boolean;
    minBalanceToBet: number;
    maxBetSize?: number;
    // Optional capital controls (all in dollars)
    maxPerMarket?: number;
    maxPerStrategyArbitrage?: number;
    maxPerStrategySpread?: number;
    maxPerStrategyMispricing?: number;
    maxHoldTimeHours?: number;
    maxOpenSpreadPositions?: number;
  };
  risk: {
    // Hard risk limits
    maxPositionsTotal?: number;
    maxPositionsPerMarket?: number;
    maxOrderNotional?: number;
    maxDailyTrades?: number;
    maxDailyNotional?: number;
    maxDailyLoss?: number;
    // Exit rules (applied to all strategies)
    takeProfitCentsPerContract?: number;
    takeProfitPctOfCost?: number;
    maxHoldMinutes?: number;
    stopLossPct?: number;
    improveExitByOneTick?: boolean;
    // Entry filters
    arbitrageFeeBuffer?: number; // e.g. 0.01 = require YES+NO < 0.99
    arbitrageMinLiquidity?: number; // contracts
    spreadMaxSpreadCents?: number; // max bid-ask spread
    spreadMinLiquidity?: number; // contracts
    spreadReserveCash?: number; // dollars to keep free
    spreadReserveCashPct?: number; // percentage of balance to keep free
  };
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}

function getOptionalEnv(key: string, defaultValue?: string): string | undefined {
  return process.env[key] || defaultValue;
}

// Helper to normalize private key PEM (handle escaped newlines)
function getPrivateKeyPem(): string | undefined {
  const pem = getOptionalEnv('KALSHI_PRIVATE_KEY_PEM');
  if (!pem) return undefined;
  
  // Replace escaped newlines with actual newlines if needed
  // This handles cases where the .env file has \n as literal characters
  return pem.replace(/\\n/g, '\n');
}

export const config: Config = {
  kalshi: {
    apiBaseUrl: requireEnv('KALSHI_API_BASE_URL'),
    apiKeyId: requireEnv('KALSHI_API_KEY_ID'),
    privateKeyPath: getOptionalEnv('KALSHI_PRIVATE_KEY_PATH'),
    privateKeyPem: getPrivateKeyPem(),
  },
  espn: {
    apiBaseUrl: getOptionalEnv('ESPN_API_BASE_URL', 'https://site.api.espn.com/apis/site/v2/sports/') || '',
  },
  sports: {
    nba: {
      espnPath: 'basketball/nba/scoreboard',
      kalshiSeries: 'KXNBAGAME',
    },
    nfl: {
      espnPath: 'football/nfl/scoreboard',
      kalshiSeries: 'KXNFLGAME', // Uppercase works with API
    },
    nhl: {
      espnPath: 'hockey/nhl/scoreboard',
      kalshiSeries: 'KXNHLGAME',
    },
    ncaab: {
      espnPath: 'basketball/mens-college-basketball/scoreboard',
      kalshiSeries: 'KXNCAAMBGAME',
    },
    ncaaf: {
      espnPath: 'football/college-football/scoreboard',
      kalshiSeries: 'KXNCAAFGAME',
    },
  },
  twilio: getOptionalEnv('TWILIO_ACCOUNT_SID') ? {
    accountSid: requireEnv('TWILIO_ACCOUNT_SID'),
    authToken: requireEnv('TWILIO_AUTH_TOKEN'),
    fromNumber: requireEnv('TWILIO_FROM_NUMBER'),
    alertToNumber: requireEnv('ALERT_TO_NUMBER'),
  } : undefined,
  sendgrid: getOptionalEnv('SEND_GRID') ? {
    apiKey: requireEnv('SEND_GRID'),
    emailAddress: requireEnv('EMAIL_ADDRESS'),
  } : undefined,
  email: getOptionalEnv('SMTP_HOST') ? {
    smtpHost: requireEnv('SMTP_HOST'),
    smtpPort: parseInt(getOptionalEnv('SMTP_PORT', '587') || '587', 10),
    smtpSecure: getOptionalEnv('SMTP_SECURE', 'false') === 'true',
    smtpUser: requireEnv('SMTP_USER'),
    smtpPassword: requireEnv('SMTP_PASSWORD'),
    fromEmail: requireEnv('EMAIL_FROM'),
    toEmail: requireEnv('EMAIL_TO'),
  } : undefined,
  bot: {
    // Increased threshold to 0.10 (10pp) to account for execution costs and ensure real edge
    // Previous 0.05 (5pp) was too low after slippage/fees
    mispricingThresholdPct: parseFloat(getOptionalEnv('MISPRICING_THRESHOLD_PCT', '0.10') || '0.10'),
    runScheduleCron: getOptionalEnv('RUN_SCHEDULE_CRON'),
    // Minimum edge after costs (slippage + fees buffer)
    minEdgeAfterCostsPct: parseFloat(getOptionalEnv('MIN_EDGE_AFTER_COSTS_PCT', '0.05') || '0.05'),
  },
  trading: {
    liveTrades: getOptionalEnv('LIVE_TRADES', 'false') === 'true',
    minBalanceToBet: parseFloat(getOptionalEnv('MIN_BALANCE_TO_BET', '10') || '10'),
    maxBetSize: getOptionalEnv('MAX_BET_SIZE') ? parseFloat(getOptionalEnv('MAX_BET_SIZE')!) : undefined,
    // Optional capital controls (in dollars)
    maxPerMarket: getOptionalEnv('MAX_PER_MARKET') ? parseFloat(getOptionalEnv('MAX_PER_MARKET')!) : undefined,
    maxPerStrategyArbitrage: getOptionalEnv('MAX_PER_STRATEGY_ARBITRAGE')
      ? parseFloat(getOptionalEnv('MAX_PER_STRATEGY_ARBITRAGE')!)
      : undefined,
    maxPerStrategySpread: getOptionalEnv('MAX_PER_STRATEGY_SPREAD')
      ? parseFloat(getOptionalEnv('MAX_PER_STRATEGY_SPREAD')!)
      : undefined,
    maxPerStrategyMispricing: getOptionalEnv('MAX_PER_STRATEGY_MISPRICING')
      ? parseFloat(getOptionalEnv('MAX_PER_STRATEGY_MISPRICING')!)
      : undefined,
    maxHoldTimeHours: getOptionalEnv('MAX_HOLD_TIME_HOURS')
      ? parseFloat(getOptionalEnv('MAX_HOLD_TIME_HOURS')!)
      : 24,
    maxOpenSpreadPositions: getOptionalEnv('MAX_OPEN_SPREAD_POSITIONS')
      ? parseInt(getOptionalEnv('MAX_OPEN_SPREAD_POSITIONS')!, 10)
      : undefined,
  },
  risk: {
    maxPositionsTotal: getOptionalEnv('MAX_POSITIONS_TOTAL')
      ? parseInt(getOptionalEnv('MAX_POSITIONS_TOTAL')!, 10)
      : undefined,
    maxPositionsPerMarket: getOptionalEnv('MAX_POSITIONS_PER_MARKET')
      ? parseInt(getOptionalEnv('MAX_POSITIONS_PER_MARKET')!, 10)
      : undefined,
    maxOrderNotional: getOptionalEnv('MAX_ORDER_NOTIONAL')
      ? parseFloat(getOptionalEnv('MAX_ORDER_NOTIONAL')!)
      : undefined,
    maxDailyTrades: getOptionalEnv('MAX_DAILY_TRADES')
      ? parseInt(getOptionalEnv('MAX_DAILY_TRADES')!, 10)
      : undefined,
    maxDailyNotional: getOptionalEnv('MAX_DAILY_NOTIONAL')
      ? parseFloat(getOptionalEnv('MAX_DAILY_NOTIONAL')!)
      : undefined,
    maxDailyLoss: getOptionalEnv('MAX_DAILY_LOSS')
      ? parseFloat(getOptionalEnv('MAX_DAILY_LOSS')!)
      : undefined,
    takeProfitCentsPerContract: getOptionalEnv('TAKE_PROFIT_CENTS_PER_CONTRACT')
      ? parseFloat(getOptionalEnv('TAKE_PROFIT_CENTS_PER_CONTRACT')!)
      : 2,
    takeProfitPctOfCost: getOptionalEnv('TAKE_PROFIT_PCT_OF_COST')
      ? parseFloat(getOptionalEnv('TAKE_PROFIT_PCT_OF_COST')!)
      : 10,
    maxHoldMinutes: getOptionalEnv('MAX_HOLD_MINUTES')
      ? parseFloat(getOptionalEnv('MAX_HOLD_MINUTES')!)
      : 180,
    stopLossPct: getOptionalEnv('STOP_LOSS_PCT')
      ? parseFloat(getOptionalEnv('STOP_LOSS_PCT')!)
      : undefined,
    improveExitByOneTick: getOptionalEnv('IMPROVE_EXIT_BY_ONE_TICK', 'true') === 'true',
    arbitrageFeeBuffer: getOptionalEnv('ARBITRAGE_FEE_BUFFER')
      ? parseFloat(getOptionalEnv('ARBITRAGE_FEE_BUFFER')!)
      : 0.01,
    arbitrageMinLiquidity: getOptionalEnv('ARBITRAGE_MIN_LIQUIDITY')
      ? parseInt(getOptionalEnv('ARBITRAGE_MIN_LIQUIDITY')!, 10)
      : undefined,
    spreadMaxSpreadCents: getOptionalEnv('SPREAD_MAX_SPREAD_CENTS')
      ? parseFloat(getOptionalEnv('SPREAD_MAX_SPREAD_CENTS')!)
      : 2,
    spreadMinLiquidity: getOptionalEnv('SPREAD_MIN_LIQUIDITY')
      ? parseInt(getOptionalEnv('SPREAD_MIN_LIQUIDITY')!, 10)
      : undefined,
    spreadReserveCash: getOptionalEnv('SPREAD_RESERVE_CASH')
      ? parseFloat(getOptionalEnv('SPREAD_RESERVE_CASH')!)
      : undefined,
    spreadReserveCashPct: getOptionalEnv('SPREAD_RESERVE_CASH_PCT')
      ? parseFloat(getOptionalEnv('SPREAD_RESERVE_CASH_PCT')!)
      : undefined,
  },
};

// Validate Kalshi configuration
if (!config.kalshi.privateKeyPath && !config.kalshi.privateKeyPem) {
  throw new Error('Either KALSHI_PRIVATE_KEY_PATH or KALSHI_PRIVATE_KEY_PEM must be set in .env file');
}

// Log config status (without sensitive data) for debugging
if (process.env.NODE_ENV !== 'production') {
  console.log('Config loaded successfully:');
  console.log(`  Kalshi API Base URL: ${config.kalshi.apiBaseUrl}`);
  console.log(`  Kalshi API Key ID: ${config.kalshi.apiKeyId.substring(0, 8)}...`);
  console.log(`  Private Key: ${config.kalshi.privateKeyPath ? 'From file' : config.kalshi.privateKeyPem ? 'From PEM' : 'NOT SET'}`);
  console.log(`  ESPN API Base URL: ${config.espn.apiBaseUrl}`);
  console.log(`  Mispricing Threshold: ${config.bot.mispricingThresholdPct * 100}%`);
}
