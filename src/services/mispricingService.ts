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
      game: { id: string; awayTeam: string; homeTeam: string; scheduledTime: string; status?: string };
      home: { espn?: { odds: number; prob: number }; kalshi?: { price: number; prob: number }; diff?: number; diffPct?: number; isOverThreshold?: boolean };
      away: { espn?: { odds: number; prob: number }; kalshi?: { price: number; prob: number }; diff?: number; diffPct?: number; isOverThreshold?: boolean };
    }> } {
    const mispricings: Mispricing[] = [];
    const comparisons: Array<{
      game: { id: string; awayTeam: string; homeTeam: string; scheduledTime: string; status?: string };
      home: { espn?: { odds: number; prob: number }; kalshi?: { price: number; prob: number }; diff?: number; diffPct?: number; isOverThreshold?: boolean };
      away: { espn?: { odds: number; prob: number }; kalshi?: { price: number; prob: number }; diff?: number; diffPct?: number; isOverThreshold?: boolean };
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
        game: {
          id: gameData.espn.game.id || gameKey,
          awayTeam,
          homeTeam,
          scheduledTime: gameData.espn.game.scheduledTime || new Date().toISOString(),
          status: gameData.espn.game.status,
        },
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

      // Add Kalshi data and calculate differences
      if (gameData.kalshi.home && comparison.home.espn) {
        comparison.home.kalshi = {
          price: gameData.kalshi.home.price,
          prob: gameData.kalshi.home.impliedProbability,
        };
        const diff = Math.abs(gameData.kalshi.home.impliedProbability - comparison.home.espn.prob);
        const diffPct = probabilityDifferencePct(gameData.kalshi.home.impliedProbability, comparison.home.espn.prob);
        comparison.home.diff = diff;
        comparison.home.diffPct = diffPct;
        comparison.home.isOverThreshold = diffPct >= config.bot.mispricingThresholdPct * 100;
      }
      if (gameData.kalshi.away && comparison.away.espn) {
        comparison.away.kalshi = {
          price: gameData.kalshi.away.price,
          prob: gameData.kalshi.away.impliedProbability,
        };
        const diff = Math.abs(gameData.kalshi.away.impliedProbability - comparison.away.espn.prob);
        const diffPct = probabilityDifferencePct(gameData.kalshi.away.impliedProbability, comparison.away.espn.prob);
        comparison.away.diff = diff;
        comparison.away.diffPct = diffPct;
        comparison.away.isOverThreshold = diffPct >= config.bot.mispricingThresholdPct * 100;
      }

      comparisons.push(comparison);

      // Check for mispricings
      if (gameData.kalshi.home && gameData.espn.homeImpliedProbability !== undefined) {
        const kalshiProb = gameData.kalshi.home.impliedProbability;
        const espnProb = gameData.espn.homeImpliedProbability;
        const diff = probabilityDifferencePct(kalshiProb, espnProb);
        const isOvervaluing = kalshiProb > espnProb;
        
        if (diff >= config.bot.mispricingThresholdPct * 100) {
          mispricings.push({
            ticker: gameData.kalshi.home.ticker,
            game: gameData.espn.game,
            side: 'home',
            kalshiPrice: gameData.kalshi.home.price,
            kalshiImpliedProbability: kalshiProb,
            sportsbookOdds: gameData.espn.homeOdds!,
            sportsbookImpliedProbability: espnProb,
            difference: Math.abs(kalshiProb - espnProb),
            differencePct: diff,
            isKalshiOvervaluing: isOvervaluing,
          });
        }
      }

      if (gameData.kalshi.away && gameData.espn.awayImpliedProbability !== undefined) {
        const kalshiProb = gameData.kalshi.away.impliedProbability;
        const espnProb = gameData.espn.awayImpliedProbability;
        const diff = probabilityDifferencePct(kalshiProb, espnProb);
        const isOvervaluing = kalshiProb > espnProb;
        
        if (diff >= config.bot.mispricingThresholdPct * 100) {
          mispricings.push({
            ticker: gameData.kalshi.away.ticker,
            game: gameData.espn.game,
            side: 'away',
            kalshiPrice: gameData.kalshi.away.price,
            kalshiImpliedProbability: kalshiProb,
            sportsbookOdds: gameData.espn.awayOdds!,
            sportsbookImpliedProbability: espnProb,
            difference: Math.abs(kalshiProb - espnProb),
            differencePct: diff,
            isKalshiOvervaluing: isOvervaluing,
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
   * "Mid-edge" strategy:
   * - Ignores any explicit edge threshold config
   * - Only considers favorites where the sportsbook implied win probability is between 50% and 70%
   * This does NOT modify the primary mispricing strategy above.
   */
  findMidEdgeMispricings(
    kalshiMarkets: Market[],
    espnOdds: SportsbookOdds[]
  ): Mispricing[] {
    const midEdgeMispricings: Mispricing[] = [];

    // Favorites band (in percentage, 50–70%)
    const MIN_PROB_PCT = 50;
    const MAX_PROB_PCT = 70;

    for (const market of kalshiMarkets) {
      const odds = this.findMatchingGame(market, espnOdds);
      if (!odds) continue;

      const isHome = market.side === 'home';
      const sportsbookProb = isHome
        ? odds.homeImpliedProbability
        : odds.awayImpliedProbability;
      const sportsbookOddsValue = isHome
        ? odds.homeOdds
        : odds.awayOdds;

      if (sportsbookProb === undefined || sportsbookOddsValue === undefined) {
        continue;
      }

      const probPct = sportsbookProb * 100;
      if (probPct < MIN_PROB_PCT || probPct > MAX_PROB_PCT) {
        continue;
      }

      const kalshiProb = market.impliedProbability;
      const difference = Math.abs(kalshiProb - sportsbookProb);
      const differencePct = probabilityDifferencePct(kalshiProb, sportsbookProb);
      const isKalshiOvervaluing = kalshiProb > sportsbookProb;

      midEdgeMispricings.push({
        ticker: market.ticker,
        game: market.game,
        side: market.side,
        kalshiPrice: market.price,
        kalshiImpliedProbability: kalshiProb,
        sportsbookOdds: sportsbookOddsValue,
        sportsbookImpliedProbability: sportsbookProb,
        difference,
        differencePct,
        isKalshiOvervaluing,
      });
    }

    return midEdgeMispricings;
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
      ticker: market.ticker,
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
