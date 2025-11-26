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
  ): { mispricings: Mispricing[]; comparisons: Array<{
      game: { awayTeam: string; homeTeam: string };
      home: { espn?: { odds: number; prob: number }; kalshi?: { price: number; prob: number } };
      away: { espn?: { odds: number; prob: number }; kalshi?: { price: number; prob: number } };
    }> } {
    const mispricings: Mispricing[] = [];
    const comparisons: Array<{
      game: { awayTeam: string; homeTeam: string };
      home: { espn?: { odds: number; prob: number }; kalshi?: { price: number; prob: number } };
      away: { espn?: { odds: number; prob: number }; kalshi?: { price: number; prob: number } };
    }> = [];
    const gameMap = new Map<string, { espn?: SportsbookOdds; kalshi: { home?: Market; away?: Market } }>();

    // Group Kalshi markets by game
    for (const market of kalshiMarkets) {
      const gameKey = `${market.game.awayTeam}-${market.game.homeTeam}`;
      if (!gameMap.has(gameKey)) {
        gameMap.set(gameKey, { kalshi: {} });
      }
      const gameData = gameMap.get(gameKey)!;
      if (market.side === 'home') {
        gameData.kalshi.home = market;
      } else {
        gameData.kalshi.away = market;
      }
    }

    // Match with ESPN odds
    for (const odds of espnOdds) {
      const gameKey = `${odds.game.awayTeam}-${odds.game.homeTeam}`;
      const reverseKey = `${odds.game.homeTeam}-${odds.game.awayTeam}`;
      
      const gameData = gameMap.get(gameKey) || gameMap.get(reverseKey);
      if (gameData) {
        gameData.espn = odds;
      }
    }

    // Build comparisons and find mispricings
    for (const [gameKey, gameData] of gameMap.entries()) {
      if (!gameData.espn) continue;

      const [awayTeam, homeTeam] = gameKey.split('-');
      const comparison: typeof comparisons[0] = {
        game: { awayTeam, homeTeam },
        home: {},
        away: {},
      };

      // Add ESPN data
      if (gameData.espn.homeOdds !== undefined && gameData.espn.homeImpliedProbability !== undefined) {
        comparison.home.espn = {
          odds: gameData.espn.homeOdds,
          prob: gameData.espn.homeImpliedProbability,
        };
      }
      if (gameData.espn.awayOdds !== undefined && gameData.espn.awayImpliedProbability !== undefined) {
        comparison.away.espn = {
          odds: gameData.espn.awayOdds,
          prob: gameData.espn.awayImpliedProbability,
        };
      }

      // Add Kalshi data
      if (gameData.kalshi.home) {
        comparison.home.kalshi = {
          price: gameData.kalshi.home.price,
          prob: gameData.kalshi.home.impliedProbability,
        };
      }
      if (gameData.kalshi.away) {
        comparison.away.kalshi = {
          price: gameData.kalshi.away.price,
          prob: gameData.kalshi.away.impliedProbability,
        };
      }

      comparisons.push(comparison);

      // Check for mispricings
      if (gameData.kalshi.home && gameData.espn.homeImpliedProbability !== undefined) {
        const diff = probabilityDifferencePct(
          gameData.kalshi.home.impliedProbability,
          gameData.espn.homeImpliedProbability
        );
        if (diff >= config.bot.mispricingThresholdPct * 100) {
          mispricings.push({
            game: gameData.espn.game,
            side: 'home',
            kalshiPrice: gameData.kalshi.home.price,
            kalshiImpliedProbability: gameData.kalshi.home.impliedProbability,
            sportsbookOdds: gameData.espn.homeOdds!,
            sportsbookImpliedProbability: gameData.espn.homeImpliedProbability,
            difference: Math.abs(gameData.kalshi.home.impliedProbability - gameData.espn.homeImpliedProbability),
            differencePct: diff,
          });
        }
      }

      if (gameData.kalshi.away && gameData.espn.awayImpliedProbability !== undefined) {
        const diff = probabilityDifferencePct(
          gameData.kalshi.away.impliedProbability,
          gameData.espn.awayImpliedProbability
        );
        if (diff >= config.bot.mispricingThresholdPct * 100) {
          mispricings.push({
            game: gameData.espn.game,
            side: 'away',
            kalshiPrice: gameData.kalshi.away.price,
            kalshiImpliedProbability: gameData.kalshi.away.impliedProbability,
            sportsbookOdds: gameData.espn.awayOdds!,
            sportsbookImpliedProbability: gameData.espn.awayImpliedProbability,
            difference: Math.abs(gameData.kalshi.away.impliedProbability - gameData.espn.awayImpliedProbability),
            differencePct: diff,
          });
        }
      }
    }

    return { mispricings, comparisons };
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
   * Check if two games match exactly (using abbreviations)
   */
  private gamesMatch(game1: Market['game'], game2: SportsbookOdds['game']): boolean {
    // Normalize team names to uppercase for comparison
    const game1Home = game1.homeTeam.toUpperCase().trim();
    const game1Away = game1.awayTeam.toUpperCase().trim();
    const game2Home = game2.homeTeam.toUpperCase().trim();
    const game2Away = game2.awayTeam.toUpperCase().trim();
    
    // Exact match (same order or reversed)
    return (game1Home === game2Home && game1Away === game2Away) ||
           (game1Home === game2Away && game1Away === game2Home);
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
