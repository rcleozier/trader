import cron from 'node-cron';
import { KalshiClient } from './clients/kalshiClient';
import { ESPNClient } from './clients/espnClient';
import { MispricingService } from './services/mispricingService';
import { config } from './config';

async function runMispricingCheckForSport(sport: 'nba' | 'nfl'): Promise<void> {
  const sportConfig = config.sports[sport];

  try {
    // Fetch data from both sources
    const kalshiClient = new KalshiClient();
    const kalshiMarkets = await kalshiClient.fetchMarkets(sportConfig.kalshiSeries, sport);
    
    const espnClient = new ESPNClient();
    const espnOdds = await espnClient.fetchGamesWithOdds(sportConfig.espnPath);

    // Find mispricings
    const mispricingService = new MispricingService();
    const { mispricings } = mispricingService.findMispricings(kalshiMarkets, espnOdds);

    // Group mispricings by game
    const gameMap = new Map<string, typeof mispricings>();
    for (const mispricing of mispricings) {
      const gameKey = mispricing.game.id || `${mispricing.game.awayTeam}-${mispricing.game.homeTeam}`;
      if (!gameMap.has(gameKey)) {
        gameMap.set(gameKey, []);
      }
      gameMap.get(gameKey)!.push(mispricing);
    }

    // Display in the requested format
    let gameIndex = 0;
    for (const [gameKey, gameMispricings] of gameMap.entries()) {
      if (gameMispricings.length === 0) continue;
      
      gameIndex++;
      const firstMispricing = gameMispricings[0];
      const gameLabel = `${firstMispricing.game.awayTeam} @ ${firstMispricing.game.homeTeam}`;
      
      // Format scheduled time
      const scheduledDate = new Date(firstMispricing.game.scheduledTime);
      const scheduledStr = scheduledDate.toISOString().replace(/\.\d{3}Z$/, 'Z');
      
      // Format status
      const status = firstMispricing.game.status || 'STATUS_UNKNOWN';
      const statusStr = status.toUpperCase().replace(/\s+/g, '_');
      
      console.log(`[${gameIndex}] ${gameLabel}`);
      console.log(`    Game ID: ${firstMispricing.game.id || gameKey}`);
      console.log(`    Scheduled: ${scheduledStr}`);
      console.log(`    Status: ${statusStr}`);
      console.log('');

      // Show each team's mispricing
      for (const mispricing of gameMispricings) {
        const team = mispricing.side === 'home' ? mispricing.game.homeTeam : mispricing.game.awayTeam;
        const side = mispricing.side.toUpperCase();
        const kalshiPct = (mispricing.kalshiImpliedProbability * 100).toFixed(2);
        const espnPct = (mispricing.sportsbookImpliedProbability * 100).toFixed(2);
        const diffPct = mispricing.differencePct.toFixed(2);
        const diffAbs = (mispricing.difference * 100).toFixed(2);
        const espnOddsStr = mispricing.sportsbookOdds > 0 ? `+${mispricing.sportsbookOdds}` : `${mispricing.sportsbookOdds}`;
        
        console.log(`    ${team} (${side}):`);
        console.log(`      Kalshi Price: ${mispricing.kalshiPrice} → ${kalshiPct}% implied probability`);
        console.log(`      ESPN Odds: ${espnOddsStr} → ${espnPct}% implied probability`);
        console.log(`      Difference: ${diffPct} percentage points (${diffAbs}% absolute)`);
        
        if (mispricing.isKalshiOvervaluing) {
          console.log(`      💰 OPPORTUNITY: Kalshi overvalues ${team} - bet against on Kalshi`);
        } else {
          console.log(`      💰 OPPORTUNITY: Kalshi undervalues ${team} - bet on Kalshi`);
        }
        console.log('');
      }
    }
  } catch (error: any) {
    // Silently continue - don't log errors
  }
}

async function runMispricingCheck(): Promise<void> {
  // Run checks for both NBA and NFL
  await runMispricingCheckForSport('nba');
  await runMispricingCheckForSport('nfl');
}

// Main execution
async function main(): Promise<void> {
  // Run once immediately
  await runMispricingCheck();

  // Schedule recurring runs if cron expression is provided
  if (config.bot.runScheduleCron) {
    cron.schedule(config.bot.runScheduleCron, async () => {
      await runMispricingCheck();
    });
  } else {
    process.exit(0);
  }
}

// Handle errors and graceful shutdown
process.on('unhandledRejection', (error: Error) => {
  process.exit(1);
});

process.on('SIGINT', () => {
  process.exit(0);
});

// Start the bot
main().catch((error) => {
  process.exit(1);
});