import cron from 'node-cron';
import { KalshiClient } from './clients/kalshiClient';
import { ESPNClient } from './clients/espnClient';
import { MispricingService } from './services/mispricingService';
import { NotificationService } from './services/notificationService';
import { config } from './config';

async function runMispricingCheck(): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('🔍 Starting NBA Mispricing Check');
  console.log('='.repeat(80));
  const startTime = Date.now();

  try {
    // Fetch data from both sources
    console.log('\n📊 Fetching Kalshi markets...');
    const kalshiClient = new KalshiClient();
    const kalshiMarkets = await kalshiClient.fetchNBAMarkets();
    console.log(`✅ Found ${kalshiMarkets.length} Kalshi NBA markets`);
    
    if (kalshiMarkets.length > 0) {
      console.log('\nKalshi Markets Summary:');
      kalshiMarkets.slice(0, 5).forEach((market, idx) => {
        console.log(`  ${idx + 1}. ${market.game.awayTeam} @ ${market.game.homeTeam} - ${market.side} (Price: ${market.price}, Prob: ${(market.impliedProbability * 100).toFixed(2)}%)`);
      });
      if (kalshiMarkets.length > 5) {
        console.log(`  ... and ${kalshiMarkets.length - 5} more`);
      }
    }

    console.log('\n📊 Fetching ESPN odds...');
    const espnClient = new ESPNClient();
    const espnOdds = await espnClient.fetchNBAGamesWithOdds();
    console.log(`✅ Found ${espnOdds.length} ESPN games with odds`);

    if (espnOdds.length > 0) {
      console.log('\nESPN Odds Summary:');
      espnOdds.slice(0, 5).forEach((odds, idx) => {
        const homeProb = odds.homeImpliedProbability ? (odds.homeImpliedProbability * 100).toFixed(2) : 'N/A';
        const awayProb = odds.awayImpliedProbability ? (odds.awayImpliedProbability * 100).toFixed(2) : 'N/A';
        console.log(`  ${idx + 1}. ${odds.game.awayTeam} @ ${odds.game.homeTeam} - Home: ${homeProb}%, Away: ${awayProb}%`);
      });
      if (espnOdds.length > 5) {
        console.log(`  ... and ${espnOdds.length - 5} more`);
      }
    }

    // Find mispricings
    console.log('\n🔍 Analyzing mispricings...');
    console.log(`   Threshold: ${config.bot.mispricingThresholdPct * 100}% difference`);
    const mispricingService = new MispricingService();
    const mispricings = mispricingService.findMispricings(kalshiMarkets, espnOdds);
    console.log(`✅ Found ${mispricings.length} mispricings above threshold`);

    // Log mispricings to console
    const notificationService = new NotificationService();
    await notificationService.sendMispricingAlert(mispricings);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n⏱️  Mispricing check completed in ${duration}s`);
    console.log('='.repeat(80));
  } catch (error: any) {
    console.error('\n❌ Error during mispricing check:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
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