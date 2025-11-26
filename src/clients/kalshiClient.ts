import { Configuration, MarketsApi } from 'kalshi-typescript';
import { config } from '../config';
import { Market, Game } from '../types/markets';
import { impliedProbabilityFromKalshiPrice } from '../lib/odds';

export class KalshiClient {
  private marketsApi: MarketsApi;

  constructor() {
    const kalshiConfig = new Configuration({
      apiKey: config.kalshi.apiKeyId,
      privateKeyPath: config.kalshi.privateKeyPath,
      privateKeyPem: config.kalshi.privateKeyPem,
      basePath: config.kalshi.apiBaseUrl,
    });

    this.marketsApi = new MarketsApi(kalshiConfig);
  }

  /**
   * Fetch NBA markets from Kalshi
   * Filters for NBA-related markets based on ticker/title
   */
  async fetchNBAMarkets(): Promise<Market[]> {
    try {
      // Fetch markets - adjust method name based on actual Kalshi SDK API
      // @ts-ignore - SDK method names may vary
      const response = await (this.marketsApi.getMarkets 
        ? this.marketsApi.getMarkets({}) 
        : this.marketsApi.listMarkets({}));

      const allMarkets = response.data?.markets || response.data || [];
      
      // Filter for NBA markets
      const nbaMarkets = allMarkets.filter((m: any) => {
        const title = (m.title || m.name || m.ticker || '').toString().toUpperCase();
        return title.includes('NBA');
      });

      return this.parseMarkets(nbaMarkets);
    } catch (error: any) {
      throw new Error(`Failed to fetch Kalshi markets: ${error.message}`);
    }
  }

  /**
   * Parse raw Kalshi market data into our Market format
   */
  private parseMarkets(rawMarkets: any[]): Market[] {
    const markets: Market[] = [];

    for (const raw of rawMarkets) {
      try {
        // Extract game information from market title/ticker
        const gameInfo = this.extractGameInfo(raw);
        if (!gameInfo) continue;

        // Get current price (best bid or last price)
        const price = this.extractPrice(raw);
        if (price === null) continue;

        // Determine side (home/away) from market
        const side = this.determineSide(raw, gameInfo);

        markets.push({
          gameId: gameInfo.id,
          game: gameInfo,
          marketId: raw.market_id || raw.id || '',
          ticker: raw.ticker || raw.event_ticker || '',
          title: raw.title || raw.name || '',
          side,
          price,
          impliedProbability: impliedProbabilityFromKalshiPrice(price),
        });
      } catch (error) {
        console.warn(`Failed to parse market ${raw.ticker || raw.id}:`, error);
      }
    }

    return markets;
  }

  /**
   * Extract game information from market data
   * This is a heuristic - adjust based on actual Kalshi market structure
   */
  private extractGameInfo(raw: any): Game | null {
    const title = (raw.title || raw.name || '').toString();
    
    // Try to extract team names from title
    // Example: "Lakers @ Warriors" or "Lakers vs Warriors"
    const teamMatch = title.match(/(\w+)\s*(?:@|vs|v\.?)\s*(\w+)/i);
    if (!teamMatch) return null;

    const awayTeam = teamMatch[1].trim();
    const homeTeam = teamMatch[2].trim();

    return {
      id: `${awayTeam}-${homeTeam}-${raw.event_ticker || raw.ticker || ''}`,
      homeTeam,
      awayTeam,
      scheduledTime: raw.event_start_ts || raw.start_time || new Date().toISOString(),
      status: raw.status,
    };
  }

  /**
   * Extract current price from market data
   */
  private extractPrice(raw: any): number | null {
    // Try various price fields that Kalshi might use
    if (raw.last_price !== undefined) return raw.last_price;
    if (raw.price !== undefined) return raw.price;
    if (raw.best_bid !== undefined) return raw.best_bid;
    if (raw.best_offer !== undefined) return raw.best_offer;
    
    // If market has outcomes, try to get price from the "yes" outcome
    if (raw.outcomes && Array.isArray(raw.outcomes)) {
      const yesOutcome = raw.outcomes.find((o: any) => o.name === 'Yes' || o.ticker?.endsWith('-Y'));
      if (yesOutcome?.price !== undefined) return yesOutcome.price;
    }

    return null;
  }

  /**
   * Determine if market is for home or away team
   */
  private determineSide(raw: any, game: Game): 'home' | 'away' {
    const title = (raw.title || raw.name || '').toString().toUpperCase();
    const ticker = (raw.ticker || '').toString().toUpperCase();

    // Check if title/ticker mentions home team first
    if (title.includes(game.homeTeam.toUpperCase()) || ticker.includes(game.homeTeam.toUpperCase())) {
      return 'home';
    }
    
    // Default to away if away team is mentioned, otherwise home
    return title.includes(game.awayTeam.toUpperCase()) || ticker.includes(game.awayTeam.toUpperCase()) 
      ? 'away' 
      : 'home';
  }
}
