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
  };
  trading: {
    liveTrades: boolean;
    minBalanceToBet: number;
      maxBetSize?: number;
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
      kalshiSeries: 'KXNCAABGAME',
    },
    ncaaf: {
      espnPath: 'football/college-football/scoreboard',
      kalshiSeries: 'KXNCAAGAME',
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
    mispricingThresholdPct: parseFloat(getOptionalEnv('MISPRICING_THRESHOLD_PCT', '0.05') || '0.05'),
    runScheduleCron: getOptionalEnv('RUN_SCHEDULE_CRON'),
  },
  trading: {
    liveTrades: getOptionalEnv('LIVE_TRADES', 'false') === 'true',
    minBalanceToBet: parseFloat(getOptionalEnv('MIN_BALANCE_TO_BET', '10') || '10'),
    maxBetSize: getOptionalEnv('MAX_BET_SIZE') ? parseFloat(getOptionalEnv('MAX_BET_SIZE')!) : undefined,
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
