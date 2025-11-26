import cron from 'node-cron';
import { KalshiClient } from './clients/kalshiClient';
import { ESPNClient } from './clients/espnClient';
import { MispricingService } from './services/mispricingService';
import { NotificationService } from './services/notificationService';
import { config } from './config';

async function runMispricingCheck(): Promise<void> {
  console.log('Starting mispricing check...');
  const startTime = Date.now();

  try {
    // Fetch data from both sources
    console.log('Fetching Kalshi markets...');
    const kalshiClient = new KalshiClient();
    const kalshiMarkets = await kalshiClient.fetchNBAMarkets();
    console.log(`Found ${kalshiMarkets.length} Kalshi NBA markets`);

    console.log('Fetching ESPN odds...');
    const espnClient = new ESPNClient();
    const espnOdds = await espnClient.fetchNBAGamesWithOdds();
    console.log(`Found ${espnOdds.length} ESPN games with odds`);

    // Find mispricings
    console.log('Analyzing mispricings...');
    const mispricingService = new MispricingService();
    const mispricings = mispricingService.findMispricings(kalshiMarkets, espnOdds);
    console.log(`Found ${mispricings.length} mispricings above ${config.bot.mispricingThresholdPct * 100}% threshold`);

    // Send SMS alert
    if (mispricings.length > 0) {
      console.log('Sending SMS alert...');
      const notificationService = new NotificationService();
      await notificationService.sendMispricingAlert(mispricings);
    } else {
      console.log('No mispricings detected, no alert sent');
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Mispricing check completed in ${duration}s`);
  } catch (error: any) {
    console.error('Error during mispricing check:', error.message);
    throw error;
  }
}

// Main execution
async function main(): Promise<void> {
  console.log('NBA Mispricing Bot started');
  console.log(`Mispricing threshold: ${config.bot.mispricingThresholdPct * 100}%`);

  // Run once immediately
  await runMispricingCheck();

  // Schedule recurring runs if cron expression is provided
  if (config.bot.runScheduleCron) {
    console.log(`Scheduling runs with cron: ${config.bot.runScheduleCron}`);
    
    cron.schedule(config.bot.runScheduleCron, async () => {
      await runMispricingCheck();
    });

    console.log('Bot is running on schedule. Press Ctrl+C to stop.');
  } else {
    console.log('No schedule configured. Bot will run once and exit.');
    process.exit(0);
  }
}

// Handle errors and graceful shutdown
process.on('unhandledRejection', (error: Error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  process.exit(0);
});

// Start the bot
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});