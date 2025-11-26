require('dotenv').config();

const config = {
  kashi: {
    rpcUrl: process.env.KASHI_RPC_URL || 'https://mainnet.infura.io/v3/YOUR_INFURA_KEY',
    contractAddress: process.env.KASHI_CONTRACT_ADDRESS || '',
    privateKey: process.env.PRIVATE_KEY || '',
  },
  nba: {
    apiKey: process.env.NBA_API_KEY || '',
    baseUrl: process.env.NBA_BASE_URL || 'https://api.sportradar.com/nba',
  },
  bot: {
    interval: parseInt(process.env.BOT_INTERVAL) || 300000, // 5 minutes
    logLevel: process.env.LOG_LEVEL || 'info',
    dryRun: process.env.DRY_RUN === 'true',
  },
  market: {
    minOddsThreshold: parseFloat(process.env.MIN_ODDS_THRESHOLD) || 1.5,
    maxOddsThreshold: parseFloat(process.env.MAX_ODDS_THRESHOLD) || 5.0,
    maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE) || 1000,
  },
};

module.exports = config;

