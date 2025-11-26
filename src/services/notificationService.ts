import { Mispricing } from '../types/markets';

export class NotificationService {
  /**
   * Log mispricing alert to console with detailed information
   */
  async sendMispricingAlert(mispricings: Mispricing[]): Promise<void> {
    if (mispricings.length === 0) {
      console.log('\n✅ No mispricings detected above threshold');
      return;
    }

    console.log('\n' + '='.repeat(80));
    console.log(`🏀 NBA MISPRICING ALERT - ${mispricings.length} OPPORTUNITY(IES) FOUND`);
    console.log('='.repeat(80));

    for (let i = 0; i < mispricings.length; i++) {
      const mispricing = mispricings[i];
      const { game, side, kalshiPrice, kalshiImpliedProbability, sportsbookImpliedProbability, 
              sportsbookOdds, difference, differencePct } = mispricing;

      const team = side === 'home' ? game.homeTeam : game.awayTeam;
      const kalshiPct = (kalshiImpliedProbability * 100).toFixed(2);
      const espnPct = (sportsbookImpliedProbability * 100).toFixed(2);
      const oddsSign = sportsbookOdds > 0 ? '+' : '';

      console.log(`\n[${i + 1}] ${game.awayTeam} @ ${game.homeTeam}`);
      console.log(`    Game ID: ${game.id}`);
      console.log(`    Scheduled: ${game.scheduledTime}`);
      console.log(`    Status: ${game.status || 'Unknown'}`);
      console.log(`\n    ${team} (${side.toUpperCase()}):`);
      console.log(`      Kalshi Price: ${kalshiPrice} → ${kalshiPct}% implied probability`);
      console.log(`      ESPN Odds: ${oddsSign}${sportsbookOdds} → ${espnPct}% implied probability`);
      console.log(`      Difference: ${differencePct.toFixed(2)} percentage points (${(difference * 100).toFixed(2)}% absolute)`);
      
      // Show arbitrage opportunity
      if (kalshiImpliedProbability < sportsbookImpliedProbability) {
        console.log(`      💰 OPPORTUNITY: Kalshi undervalues ${team} - bet on Kalshi`);
      } else {
        console.log(`      💰 OPPORTUNITY: Kalshi overvalues ${team} - bet against on Kalshi`);
      }
    }

    console.log('\n' + '='.repeat(80));
  }
}
