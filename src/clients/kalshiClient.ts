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
      
      // Log sample of all markets to see what we're getting
      if (allMarkets.length > 0) {
        console.log(`  Sample of first 10 markets (all types):`);
        allMarkets.slice(0, 10).forEach((m: any, idx: number) => {
          const title = m.title || 'No title';
          const ticker = m.ticker || 'N/A';
          const eventTicker = m.event_ticker || 'N/A';
          console.log(`    ${idx + 1}. "${title}" (Ticker: ${ticker}, Event: ${eventTicker})`);
        });
      }
      
      // Count NBA-related markets before filtering
      const nbaRelatedCount = allMarkets.filter((m: any) => {
        const title = (m.title || '').toString().toUpperCase();
        const eventTicker = (m.event_ticker || '').toString().toUpperCase();
        return title.includes('NBA') || eventTicker.includes('NBA');
      }).length;
      console.log(`  Found ${nbaRelatedCount} NBA-related markets (before game filtering)`);
      
      // Filter for NBA GAME markets (not proposition/futures markets)
      // Game markets typically have team names or "@" symbol indicating a matchup
      const nbaMarkets = allMarkets.filter((m: any) => {
        const title = (m.title || m.name || '').toString();
        const titleUpper = title.toUpperCase();
        const eventTicker = (m.event_ticker || '').toString().toUpperCase();
        const seriesTicker = (m.series_ticker || '').toString().toUpperCase();
        const subtitle = (m.subtitle || '').toString().toUpperCase();
        const ticker = (m.ticker || '').toString().toUpperCase();
        
        // Exclude proposition/futures markets (questions, "will", "before", etc.)
        const isProposition = titleUpper.startsWith('WILL ') ||
                             titleUpper.startsWith('WHO ') ||
                             titleUpper.includes(' WILL ') ||
                             titleUpper.includes(' WHO ') ||
                             titleUpper.includes('BEFORE ') ||
                             titleUpper.includes('APPROVE') ||
                             titleUpper.includes('OWNER') ||
                             titleUpper.includes('?') ||
                             titleUpper.includes('COVER ATHLETE') ||
                             titleUpper.includes('FRANCHISE');
        
        if (isProposition) {
          return false;
        }
        
        // Look for actual game indicators:
        // 1. Has "@" symbol (team @ team format)
        // 2. Has team abbreviations (common NBA team codes)
        // 3. Has "vs" or "v" (versus)
        const hasGameFormat = title.includes('@') || 
                             titleUpper.includes(' VS ') || 
                             titleUpper.includes(' V ') ||
                             ticker.includes('@');
        
        // Common NBA team abbreviations to look for
        const nbaTeams = ['BOS', 'BKN', 'NY', 'PHI', 'TOR', 'CHI', 'CLE', 'DET', 'IND', 'MIL',
                         'ATL', 'CHA', 'MIA', 'ORL', 'WAS', 'DEN', 'MIN', 'OKC', 'POR', 'UTA',
                         'GS', 'LAC', 'LAL', 'PHX', 'SAC', 'DAL', 'HOU', 'MEM', 'NO', 'SA',
                         'CELTICS', 'NETS', 'KNICKS', '76ERS', 'RAPTORS', 'BULLS', 'CAVALIERS',
                         'PISTONS', 'PACERS', 'BUCKS', 'HAWKS', 'HORNETS', 'HEAT', 'MAGIC',
                         'WIZARDS', 'NUGGETS', 'TIMBERWOLVES', 'THUNDER', 'TRAILBLAZERS',
                         'JAZZ', 'WARRIORS', 'CLIPPERS', 'LAKERS', 'SUNS', 'KINGS', 'MAVERICKS',
                         'ROCKETS', 'GRIZZLIES', 'PELICANS', 'SPURS'];
        
        const hasTeamName = nbaTeams.some(team => 
          titleUpper.includes(team) || 
          ticker.includes(team) || 
          eventTicker.includes(team)
        );
        
        // Must have game format OR team names (NBA-related check is less strict)
        // Also check if it's a game by looking at close_time (games close on game day)
        const isNbaRelated = titleUpper.includes('NBA') || 
                            eventTicker.includes('NBA') || 
                            seriesTicker.includes('NBA') ||
                            subtitle.includes('NBA') ||
                            hasTeamName;
        
        // For game markets, we want either:
        // 1. Has game format (@ or vs) AND is NBA-related, OR
        // 2. Has team names (likely a game market)
        return isNbaRelated && (hasGameFormat || hasTeamName);
      });

      console.log(`  Filtered to ${nbaMarkets.length} NBA-related markets`);
      
      // If we found NBA markets, log their details
      if (nbaMarkets.length > 0) {
        console.log(`  NBA Markets found:`);
        nbaMarkets.forEach((m: any, idx: number) => {
          console.log(`    ${idx + 1}. ${m.title || 'No title'} (Ticker: ${m.ticker}, Event: ${m.event_ticker})`);
        });
      }
      
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
        // Log raw market data for debugging
        console.log(`\n    Raw Market Data:`);
        console.log(`      Ticker: ${raw.ticker || 'N/A'}`);
        console.log(`      Event Ticker: ${raw.event_ticker || 'N/A'}`);
        console.log(`      Series Ticker: ${raw.series_ticker || 'N/A'}`);
        console.log(`      Title: ${raw.title || 'N/A'}`);
        console.log(`      Subtitle: ${raw.subtitle || 'N/A'}`);
        
        // Extract game information from market title/ticker
        const gameInfo = this.extractGameInfo(raw);
        if (!gameInfo) {
          console.log(`      ⚠️  Could not extract game info - skipping`);
          continue;
        }

        // Get current price (best bid or last price)
        const price = this.extractPrice(raw);
        if (price === null) {
          console.log(`      ⚠️  No price found - skipping`);
          continue;
        }

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
        
        console.log(`      ✅ Parsed: ${gameInfo.awayTeam} @ ${gameInfo.homeTeam} - ${side}`);
        console.log(`         Price: ${price}, Implied Prob: ${(impliedProb * 100).toFixed(2)}%`);
      } catch (error: any) {
        console.warn(`      ❌ Failed to parse market ${raw.ticker || raw.id}:`, error.message);
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
    const ticker = (raw.ticker || '').toString();
    const eventTicker = (raw.event_ticker || '').toString();
    
    // Try multiple patterns to extract team names
    // Pattern 1: "Team1 @ Team2" or "Team1 vs Team2"
    let teamMatch = title.match(/([A-Za-z\s]+?)\s*(?:@|vs|v\.?)\s*([A-Za-z\s]+?)(?:\s|$|:)/i);
    
    // Pattern 2: Try from ticker format (e.g., "NBA-LAL-GSW-Y" or "NBA-LAL@GSW")
    if (!teamMatch && ticker) {
      const tickerMatch = ticker.match(/([A-Z]+)[-@]([A-Z]+)/i);
      if (tickerMatch) {
        teamMatch = [null, tickerMatch[1], tickerMatch[2]];
      }
    }
    
    // Pattern 3: Try from event ticker
    if (!teamMatch && eventTicker) {
      const eventMatch = eventTicker.match(/([A-Z]+)[-@]([A-Z]+)/i);
      if (eventMatch) {
        teamMatch = [null, eventMatch[1], eventMatch[2]];
      }
    }
    
    // If we still can't extract, use the title/ticker as fallback
    if (!teamMatch) {
      // Use first part of title or ticker as away, second as home
      const parts = title.split(/\s*(?:@|vs|v\.?)\s*/i);
      if (parts.length >= 2) {
        teamMatch = [null, parts[0].trim(), parts[1].trim()];
      } else {
        // Last resort: use ticker or event ticker as identifier
        const identifier = ticker || eventTicker || title;
        return {
          id: identifier,
          homeTeam: 'Unknown',
          awayTeam: 'Unknown',
          scheduledTime: raw.open_time || raw.close_time || new Date().toISOString(),
          status: raw.status,
        };
      }
    }

    const awayTeam = teamMatch[1]?.trim() || 'Unknown';
    const homeTeam = teamMatch[2]?.trim() || 'Unknown';

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
