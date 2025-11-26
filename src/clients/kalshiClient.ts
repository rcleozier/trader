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
      console.log('  Fetching markets from Kalshi API (status=open, limit=1000)...');
      // Fetch markets with status='open' to get active markets
      // Using a high limit to get as many markets as possible
      const response = await this.marketsApi.getMarkets(
        1000, // limit - max is 1000
        undefined, // cursor - start from beginning
        undefined, // eventTicker
        undefined, // seriesTicker
        undefined, // maxCloseTs
        undefined, // minCloseTs
        'open', // status - only get open markets
        undefined // tickers
      );

      const allMarkets = response.data?.markets || [];
      console.log(`  Received ${allMarkets.length} total markets from Kalshi`);
      
      // Filter for NBA markets
      const nbaMarkets = allMarkets.filter((m: any) => {
        const title = (m.title || m.name || m.ticker || '').toString().toUpperCase();
        const eventTicker = (m.event_ticker || '').toString().toUpperCase();
        return title.includes('NBA') || eventTicker.includes('NBA');
      });

      console.log(`  Filtered to ${nbaMarkets.length} NBA-related markets`);
      
      const parsed = this.parseMarkets(nbaMarkets);
      console.log(`  Successfully parsed ${parsed.length} NBA markets`);
      
      return parsed;
    } catch (error: any) {
      console.error('  Kalshi API Error:', error.message);
      if (error.response) {
        console.error('  Response status:', error.response.status);
        console.error('  Response data:', JSON.stringify(error.response.data).substring(0, 500));
      }
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

        const impliedProb = impliedProbabilityFromKalshiPrice(price);
        markets.push({
          gameId: gameInfo.id,
          game: gameInfo,
          marketId: raw.ticker || '',
          ticker: raw.ticker || '',
          title: raw.title || '',
          side,
          price,
          impliedProbability: impliedProb,
        });
        
        console.log(`    Parsed: ${gameInfo.awayTeam} @ ${gameInfo.homeTeam} - ${side} (Price: ${price}, Prob: ${(impliedProb * 100).toFixed(2)}%)`);
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
      scheduledTime: raw.open_time || raw.close_time || new Date().toISOString(),
      status: raw.status,
    };
  }

  /**
   * Extract current price from market data
   * Uses last_price if available, otherwise uses yes_bid (midpoint of yes bid/ask)
   */
  private extractPrice(raw: any): number | null {
    // Prefer last_price as it's the most recent trade price
    if (raw.last_price !== undefined && raw.last_price !== null) {
      return raw.last_price;
    }
    
    // Fall back to yes_bid (the bid price for "yes" outcome)
    // This represents the probability that the event will happen
    if (raw.yes_bid !== undefined && raw.yes_bid !== null) {
      return raw.yes_bid;
    }
    
    // If yes_bid is not available, try yes_ask
    if (raw.yes_ask !== undefined && raw.yes_ask !== null) {
      return raw.yes_ask;
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
