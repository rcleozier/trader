import { Market, SportsbookOdds, Mispricing } from '../types/markets';
import { probabilityDifferencePct } from '../lib/odds';
import { config } from '../config';

export class MispricingService {
  /**
   * Match Kalshi markets with ESPN odds and detect mispricings
   */
  findMispricings(
    kalshiMarkets: Market[],
    espnOdds: SportsbookOdds[]
  ): Mispricing[] {
    const mispricings: Mispricing[] = [];

    for (const market of kalshiMarkets) {
      // Find matching ESPN game
      const matchingOdds = this.findMatchingGame(market, espnOdds);
      if (!matchingOdds) continue;

      // Check both sides (home and away)
      const homeMispricing = this.checkMispricing(
        market,
        matchingOdds,
        'home'
      );
      if (homeMispricing) {
        mispricings.push(homeMispricing);
      }

      const awayMispricing = this.checkMispricing(
        market,
        matchingOdds,
        'away'
      );
      if (awayMispricing) {
        mispricings.push(awayMispricing);
      }
    }

    return mispricings;
  }

  /**
   * Find matching ESPN game for a Kalshi market
   */
  private findMatchingGame(
    market: Market,
    espnOdds: SportsbookOdds[]
  ): SportsbookOdds | null {
    // Try exact match first
    for (const odds of espnOdds) {
      if (this.gamesMatch(market.game, odds.game)) {
        return odds;
      }
    }

    // Try fuzzy match (team name variations)
    for (const odds of espnOdds) {
      if (this.gamesMatchFuzzy(market.game, odds.game)) {
        return odds;
      }
    }

    return null;
  }

  /**
   * Check if two games match exactly
   */
  private gamesMatch(game1: Market['game'], game2: SportsbookOdds['game']): boolean {
    return (
      game1.homeTeam.toLowerCase() === game2.homeTeam.toLowerCase() &&
      game1.awayTeam.toLowerCase() === game2.awayTeam.toLowerCase()
    );
  }

  /**
   * Fuzzy match games (handles team name variations, abbreviations)
   */
  private gamesMatchFuzzy(
    game1: Market['game'],
    game2: SportsbookOdds['game']
  ): boolean {
    const normalize = (name: string) => name.toLowerCase().replace(/\s+/g, '');

    const home1 = normalize(game1.homeTeam);
    const away1 = normalize(game1.awayTeam);
    const home2 = normalize(game2.homeTeam);
    const away2 = normalize(game2.awayTeam);

    // Check if teams match (order-independent)
    return (
      (home1 === home2 && away1 === away2) ||
      (home1 === away2 && away1 === home2)
    );
  }

  /**
   * Check if there's a mispricing for a specific side
   */
  private checkMispricing(
    market: Market,
    odds: SportsbookOdds,
    side: 'home' | 'away'
  ): Mispricing | null {
    // Only check if this market is for the requested side
    if (market.side !== side) {
      return null;
    }

    const sportsbookProb = side === 'home' 
      ? odds.homeImpliedProbability 
      : odds.awayImpliedProbability;

    const sportsbookOddsValue = side === 'home' 
      ? odds.homeOdds 
      : odds.awayOdds;

    if (!sportsbookProb || sportsbookOddsValue === undefined) {
      return null;
    }

    const kalshiProb = market.impliedProbability;
    const difference = Math.abs(kalshiProb - sportsbookProb);
    const differencePct = probabilityDifferencePct(kalshiProb, sportsbookProb);

    // Check if mispricing exceeds threshold
    if (differencePct < config.bot.mispricingThresholdPct * 100) {
      return null;
    }

    return {
      game: market.game,
      side,
      kalshiPrice: market.price,
      kalshiImpliedProbability: kalshiProb,
      sportsbookOdds: sportsbookOddsValue,
      sportsbookImpliedProbability: sportsbookProb,
      difference,
      differencePct,
    };
  }
}
