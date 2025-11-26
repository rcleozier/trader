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
    const kalshiClient = new KalshiClient();
    const kalshiMarkets = await kalshiClient.fetchNBAMarkets();
    
    const espnClient = new ESPNClient();
    const espnOdds = await espnClient.fetchNBAGamesWithOdds();

    // Find mispricings and build comparisons
    const mispricingService = new MispricingService();
    const { mispricings, comparisons } = mispricingService.findMispricings(kalshiMarkets, espnOdds);

    // Display unified comparison table
    console.log('\n' + '='.repeat(100));
    console.log('📊 ESPN vs KALSHI ODDS COMPARISON');
    console.log('='.repeat(100));
    console.log('');
    
    for (const comp of comparisons) {
      const gameLabel = `${comp.game.awayTeam} @ ${comp.game.homeTeam}`;
      console.log(`🏀 ${gameLabel}`);
      console.log('─'.repeat(100));
      
      // Home team comparison
      if (comp.home.espn || comp.home.kalshi) {
        const espnStr = comp.home.espn 
          ? `${comp.home.espn.odds > 0 ? '+' : ''}${comp.home.espn.odds} → ${(comp.home.espn.prob * 100).toFixed(1)}%`
          : 'N/A';
        const kalshiStr = comp.home.kalshi
          ? `Price: ${comp.home.kalshi.price} → ${(comp.home.kalshi.prob * 100).toFixed(1)}%`
          : 'N/A';
        const diff = comp.home.espn && comp.home.kalshi
          ? `${Math.abs(comp.home.espn.prob - comp.home.kalshi.prob) * 100}pp`
          : 'N/A';
        const mispricingFlag = comp.home.espn && comp.home.kalshi && 
          Math.abs(comp.home.espn.prob - comp.home.kalshi.prob) * 100 >= config.bot.mispricingThresholdPct * 100
          ? ' ⚠️ MISPRICING'
          : '';
        console.log(`  HOME (${comp.game.homeTeam}):`);
        console.log(`    ESPN:    ${espnStr.padEnd(25)} Kalshi: ${kalshiStr.padEnd(25)} Diff: ${diff}${mispricingFlag}`);
      }
      
      // Away team comparison
      if (comp.away.espn || comp.away.kalshi) {
        const espnStr = comp.away.espn 
          ? `${comp.away.espn.odds > 0 ? '+' : ''}${comp.away.espn.odds} → ${(comp.away.espn.prob * 100).toFixed(1)}%`
          : 'N/A';
        const kalshiStr = comp.away.kalshi
          ? `Price: ${comp.away.kalshi.price} → ${(comp.away.kalshi.prob * 100).toFixed(1)}%`
          : 'N/A';
        const diff = comp.away.espn && comp.away.kalshi
          ? `${Math.abs(comp.away.espn.prob - comp.away.kalshi.prob) * 100}pp`
          : 'N/A';
        const mispricingFlag = comp.away.espn && comp.away.kalshi && 
          Math.abs(comp.away.espn.prob - comp.away.kalshi.prob) * 100 >= config.bot.mispricingThresholdPct * 100
          ? ' ⚠️ MISPRICING'
          : '';
        console.log(`  AWAY (${comp.game.awayTeam}):`);
        console.log(`    ESPN:    ${espnStr.padEnd(25)} Kalshi: ${kalshiStr.padEnd(25)} Diff: ${diff}${mispricingFlag}`);
      }
      
      console.log('');
    }
    
    console.log('='.repeat(100));
    console.log(`✅ Found ${mispricings.length} mispricings above ${config.bot.mispricingThresholdPct * 100}% threshold`);
    console.log('='.repeat(100));

    // Send alert for mispricings
    const notificationService = new NotificationService();
    await notificationService.sendMispricingAlert(mispricings);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n⏱️  Completed in ${duration}s`);
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