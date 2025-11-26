import cron from 'node-cron';
import { KalshiClient } from './clients/kalshiClient';
import { ESPNClient } from './clients/espnClient';
import { MispricingService } from './services/mispricingService';
import { NotificationService } from './services/notificationService';
import { config } from './config';

async function runMispricingCheckForSport(sport: 'nba' | 'nfl'): Promise<void> {
  const sportConfig = config.sports[sport];
  const sportEmoji = sport === 'nba' ? '🏀' : '🏈';
  const sportName = sport.toUpperCase();
  
  console.log(`\n${sportEmoji} ${sportName} Mispricing Check`);
  console.log('─'.repeat(80));
  const startTime = Date.now();

  try {
    // Fetch data from both sources
    const kalshiClient = new KalshiClient();
    const kalshiMarkets = await kalshiClient.fetchMarkets(sportConfig.kalshiSeries, sport);
    console.log(`  📊 Kalshi: Found ${kalshiMarkets.length} ${sportName} markets`);
    
    const espnClient = new ESPNClient();
    const espnOdds = await espnClient.fetchGamesWithOdds(sportConfig.espnPath);
    console.log(`  📊 ESPN: Found ${espnOdds.length} ${sportName} games with odds`);

    // Find mispricings and build comparisons
    const mispricingService = new MispricingService();
    const { mispricings, comparisons } = mispricingService.findMispricings(kalshiMarkets, espnOdds);

    // Display unified comparison table
    if (comparisons.length > 0) {
      console.log(`\n${sportEmoji} ${sportName} Games:`);
      
      for (const comp of comparisons) {
        const gameLabel = `${comp.game.awayTeam} @ ${comp.game.homeTeam}`;
        console.log(`  ${gameLabel}`);
        // Home team comparison
        if (comp.home.espn || comp.home.kalshi) {
          const espnStr = comp.home.espn 
            ? `${comp.home.espn.odds > 0 ? '+' : ''}${comp.home.espn.odds} → ${(comp.home.espn.prob * 100).toFixed(1)}%`
            : 'N/A';
          const kalshiStr = comp.home.kalshi
            ? `Price: ${comp.home.kalshi.price} → ${(comp.home.kalshi.prob * 100).toFixed(1)}%`
            : 'N/A';
          const diff = comp.home.espn && comp.home.kalshi
            ? `${(Math.abs(comp.home.espn.prob - comp.home.kalshi.prob) * 100).toFixed(1)}pp`
            : 'N/A';
          const isMispricing = comp.home.espn && comp.home.kalshi && 
            Math.abs(comp.home.espn.prob - comp.home.kalshi.prob) * 100 >= config.bot.mispricingThresholdPct * 100;
          const isOvervaluing = comp.home.espn && comp.home.kalshi && 
            comp.home.kalshi.prob > comp.home.espn.prob;
          let mispricingFlag = '';
          if (isMispricing) {
            mispricingFlag = isOvervaluing 
              ? ' ⚠️ MISPRICING (Kalshi OVERVALUING)'
              : ' ⚠️ MISPRICING (Kalshi UNDERVALUING)';
          }
          console.log(`    HOME (${comp.game.homeTeam}): ESPN: ${espnStr.padEnd(20)} Kalshi: ${kalshiStr.padEnd(20)} Diff: ${diff}${mispricingFlag}`);
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
            ? `${(Math.abs(comp.away.espn.prob - comp.away.kalshi.prob) * 100).toFixed(1)}pp`
            : 'N/A';
          const isMispricing = comp.away.espn && comp.away.kalshi && 
            Math.abs(comp.away.espn.prob - comp.away.kalshi.prob) * 100 >= config.bot.mispricingThresholdPct * 100;
          const isOvervaluing = comp.away.espn && comp.away.kalshi && 
            comp.away.kalshi.prob > comp.away.espn.prob;
          let mispricingFlag = '';
          if (isMispricing) {
            mispricingFlag = isOvervaluing 
              ? ' ⚠️ MISPRICING (Kalshi OVERVALUING)'
              : ' ⚠️ MISPRICING (Kalshi UNDERVALUING)';
          }
          console.log(`    AWAY (${comp.game.awayTeam}): ESPN: ${espnStr.padEnd(20)} Kalshi: ${kalshiStr.padEnd(20)} Diff: ${diff}${mispricingFlag}`);
        }
        console.log('');
      }
      
      console.log(`  ✅ ${sportName}: Found ${mispricings.length} mispricings above ${config.bot.mispricingThresholdPct * 100}% threshold`);
    } else {
      console.log(`  ℹ️  ${sportName}: No games found`);
    }

    // Send alert for mispricings
    const notificationService = new NotificationService();
    await notificationService.sendMispricingAlert(mispricings);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`  ⏱️  ${sportName} check completed in ${duration}s`);
  } catch (error: any) {
    console.error(`\n❌ Error during ${sport} mispricing check:`, error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    // Don't throw - continue with other sports
  }
}

async function runMispricingCheck(): Promise<void> {
  console.log('\n' + '='.repeat(100));
  console.log('🔍 Starting Multi-Sport Mispricing Check');
  console.log('='.repeat(100));
  console.log(`Mispricing threshold: ${config.bot.mispricingThresholdPct * 100}%`);
  
  const allMispricings: any[] = [];
  
  // Run checks for both NBA and NFL
  await runMispricingCheckForSport('nba');
  await runMispricingCheckForSport('nfl');
  
  console.log('\n' + '='.repeat(100));
  console.log(`✅ Total mispricings found: ${allMispricings.length}`);
  console.log('='.repeat(100));
}

// Main execution
async function main(): Promise<void> {
  console.log('Multi-Sport Mispricing Bot started');
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