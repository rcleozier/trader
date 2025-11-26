import { Configuration, MarketsApi, EventsApi, SeriesApi } from 'kalshi-typescript';
import axios from 'axios';
import { config } from '../config';
import { Market, Game } from '../types/markets';
import { impliedProbabilityFromKalshiPrice } from '../lib/odds';

export class KalshiClient {
  private marketsApi: MarketsApi;
  private eventsApi: EventsApi;
  private seriesApi: SeriesApi;
  private kalshiConfig: Configuration;
  private axiosClient: any;

  constructor() {
    this.kalshiConfig = new Configuration({
      apiKey: config.kalshi.apiKeyId,
      privateKeyPath: config.kalshi.privateKeyPath,
      privateKeyPem: config.kalshi.privateKeyPem,
      basePath: config.kalshi.apiBaseUrl,
    });

    this.marketsApi = new MarketsApi(this.kalshiConfig);
    this.eventsApi = new EventsApi(this.kalshiConfig);
    this.seriesApi = new SeriesApi(this.kalshiConfig);
    
    // Create axios client for direct API calls (like live-data)
    this.axiosClient = axios.create({
      baseURL: config.kalshi.apiBaseUrl,
      timeout: 10000,
    });
  }

  /**
   * Fetch markets from Kalshi for a specific series
   */
  async fetchMarkets(seriesTicker: string, sport: 'nba' | 'nfl' = 'nba'): Promise<Market[]> {
    try {
      const currentTime = Math.floor(Date.now() / 1000);
      
      const marketsResponse = await this.marketsApi.getMarkets(
        1000, // limit
        undefined, // cursor
        undefined, // eventTicker
        seriesTicker, // seriesTicker
        undefined, // maxCloseTs
        currentTime, // minCloseTs - markets closing now or later (live games)
        'open', // status
        undefined // tickers
      );

      const allMarkets = marketsResponse.data?.markets || [];
      
      // Filter for actual game markets (not proposition/futures markets)
      const gameMarkets = allMarkets.filter((m: any) => {
        const title = (m.title || '').toString();
        const titleUpper = title.toUpperCase();
        const eventTicker = (m.event_ticker || '').toString().toUpperCase();
        
        // Look for game indicators first: @ symbol, team names, vs, "Winner?"
        const hasGameFormat = title.includes('@') || 
                             titleUpper.includes(' VS ') || 
                             titleUpper.includes(' V ') ||
                             titleUpper.includes('WINNER?') ||
                             eventTicker.includes('@');
        
        // If it has game format, it's likely a game market (even if it has "?")
        if (hasGameFormat) {
          // Still exclude obvious propositions that might have game format
          const isProposition = titleUpper.startsWith('WILL ') ||
                               titleUpper.startsWith('WHO ') ||
                               titleUpper.includes(' WILL ') ||
                               titleUpper.includes(' WHO ') ||
                               titleUpper.includes('BEFORE ') ||
                               titleUpper.includes('APPROVE') ||
                               titleUpper.includes('OWNER') ||
                               titleUpper.includes('COVER ATHLETE') ||
                               titleUpper.includes('FRANCHISE');
          
          // If it has game format and is not a proposition, include it
          return !isProposition;
        }
        
        // No game format found, exclude it
        return false;
      });
      
      const parsed = this.parseMarkets(gameMarkets, sport);
      
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
  private parseMarkets(rawMarkets: any[], sport: 'nba' | 'nfl' = 'nba'): Market[] {
    const markets: Market[] = [];

    for (const raw of rawMarkets) {
      try {
        // Extract game information from market title/ticker
        const gameInfo = this.extractGameInfo(raw, sport);
        if (!gameInfo) {
          continue;
        }

        // Get current price (best bid or last price)
        const price = this.extractPrice(raw);
        if (price === null) {
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
      } catch (error: any) {
        // Silently skip invalid markets
      }
    }

    return markets;
  }

  /**
   * Extract game information from market data
   * Kalshi ticker format: KXNBAGAME-25NOV28DALLAL-LAL
   * Event ticker format: KXNBAGAME-25NOV28DALLAL (contains both team abbreviations)
   */
  private extractGameInfo(raw: any, sport: 'nba' | 'nfl' = 'nba'): Game | null {
    const title = (raw.title || raw.name || '').toString();
    const ticker = (raw.ticker || '').toString();
    const eventTicker = (raw.event_ticker || '').toString();
    
    // Team abbreviation mapping for NBA and NFL
    const nbaTeamAbbrevMap: { [key: string]: string } = {
      'ATL': 'ATL', 'BOS': 'BOS', 'BKN': 'BKN', 'CHA': 'CHA', 'CHI': 'CHI',
      'CLE': 'CLE', 'DAL': 'DAL', 'DEN': 'DEN', 'DET': 'DET', 'GS': 'GS',
      'GSW': 'GS', 'HOU': 'HOU', 'IND': 'IND', 'LAC': 'LAC', 'LAL': 'LAL',
      'MEM': 'MEM', 'MIA': 'MIA', 'MIL': 'MIL', 'MIN': 'MIN', 'NO': 'NO',
      'NOP': 'NO', 'NY': 'NY', 'NYK': 'NY', 'OKC': 'OKC', 'ORL': 'ORL',
      'PHI': 'PHI', 'PHX': 'PHX', 'POR': 'POR', 'SAC': 'SAC', 'SA': 'SA',
      'SAS': 'SA', 'TOR': 'TOR', 'UTA': 'UTA', 'WAS': 'WAS', 'WSH': 'WAS'
    };
    
    const nflTeamAbbrevMap: { [key: string]: string } = {
      'ARI': 'ARI', 'ATL': 'ATL', 'BAL': 'BAL', 'BUF': 'BUF', 'CAR': 'CAR',
      'CHI': 'CHI', 'CIN': 'CIN', 'CLE': 'CLE', 'DAL': 'DAL', 'DEN': 'DEN',
      'DET': 'DET', 'GB': 'GB', 'HOU': 'HOU', 'IND': 'IND', 'JAX': 'JAX',
      'KC': 'KC', 'LV': 'LV', 'LAR': 'LAR', 'LAC': 'LAC', 'MIA': 'MIA',
      'MIN': 'MIN', 'NE': 'NE', 'NO': 'NO', 'NYG': 'NYG', 'NYJ': 'NYJ',
      'PHI': 'PHI', 'PIT': 'PIT', 'SF': 'SF', 'SEA': 'SEA', 'TB': 'TB',
      'TEN': 'TEN', 'WAS': 'WAS', 'WSH': 'WAS'
    };
    
    const teamAbbrevMap = sport === 'nfl' ? nflTeamAbbrevMap : nbaTeamAbbrevMap;
    const seriesPrefix = sport === 'nfl' ? 'KXNFLGAME' : 'KXNBAGAME';
    
    // Try to extract from event ticker first (most reliable)
    // Format: KXNBAGAME-25NOV28DALLAL or KXNFLGAME-25NOV28DALLAL
    let awayAbbrev: string | null = null;
    let homeAbbrev: string | null = null;
    
    if (eventTicker) {
      // Extract the team abbreviations part (after date)
      const eventMatch = eventTicker.match(new RegExp(`${seriesPrefix}-\\d+([A-Z]+)`, 'i'));
      if (eventMatch) {
        const combinedAbbrev = eventMatch[1];
        // Try to split combined abbreviations (e.g., DALLAL = DAL + LAL)
        // Common patterns: 3+3, 3+4, 4+3, 3+2, 2+3
        const possibleSplits = [
          [3, 3], [3, 4], [4, 3], [3, 2], [2, 3], [4, 4], [2, 4], [4, 2]
        ];
        
        for (const [len1, len2] of possibleSplits) {
          if (combinedAbbrev.length >= len1 + len2) {
            const abbrev1 = combinedAbbrev.substring(0, len1);
            const abbrev2 = combinedAbbrev.substring(len1, len1 + len2);
            
            // Check if both are valid team abbreviations
            if (teamAbbrevMap[abbrev1] && teamAbbrevMap[abbrev2]) {
              awayAbbrev = teamAbbrevMap[abbrev1];
              homeAbbrev = teamAbbrevMap[abbrev2];
              break;
            }
          }
        }
      }
    }
    
    // Fallback: Try from ticker format KXNBAGAME-25NOV28DALLAL-LAL or KXNFLGAME-25NOV28DALLAL-LAL
    if (!awayAbbrev && ticker) {
      const tickerMatch = ticker.match(new RegExp(`${seriesPrefix}-\\d+([A-Z]+)-([A-Z]+)`, 'i'));
      if (tickerMatch) {
        const combined = tickerMatch[1];
        const sideAbbrev = tickerMatch[2];
        
        // Try to split combined to find the other team
        for (const [len1, len2] of [[3, 3], [3, 4], [4, 3], [3, 2], [2, 3]]) {
          if (combined.length >= len1 + len2) {
            const abbrev1 = combined.substring(0, len1);
            const abbrev2 = combined.substring(len1, len1 + len2);
            
            if (teamAbbrevMap[abbrev1] && teamAbbrevMap[abbrev2]) {
              if (teamAbbrevMap[abbrev1] === sideAbbrev || abbrev1 === sideAbbrev) {
                awayAbbrev = teamAbbrevMap[abbrev2];
                homeAbbrev = teamAbbrevMap[abbrev1];
              } else if (teamAbbrevMap[abbrev2] === sideAbbrev || abbrev2 === sideAbbrev) {
                awayAbbrev = teamAbbrevMap[abbrev1];
                homeAbbrev = teamAbbrevMap[abbrev2];
              }
              break;
            }
          }
        }
      }
    }
    
    // Last resort: Try to parse from title
    if (!awayAbbrev) {
      const titleMatch = title.match(/([A-Za-z\s]+?)\s*(?:@|vs|v\.?)\s*([A-Za-z\s]+?)(?:\s|$|:)/i);
      if (titleMatch) {
        // Try to map full names to abbreviations (basic mapping)
        const awayName = titleMatch[1]?.trim() || '';
        const homeName = titleMatch[2]?.trim() || '';
        
        // Simple name to abbrev mapping for NBA and NFL
        const nbaNameToAbbrev: { [key: string]: string } = {
          'dallas': 'DAL', 'los angeles l': 'LAL', 'los angeles c': 'LAC',
          'memphis': 'MEM', 'san antonio': 'SA', 'denver': 'DEN',
          'sacramento': 'SAC', 'utah': 'UTA', 'phoenix': 'PHX',
          'oklahoma city': 'OKC', 'orlando': 'ORL', 'detroit': 'DET',
          'milwaukee': 'MIL', 'miami': 'MIA', 'philadelphia': 'PHI',
          'brooklyn': 'BKN', 'cleveland': 'CLE', 'washington': 'WAS',
          'indiana': 'IND', 'chicago': 'CHI', 'charlotte': 'CHA',
          'houston': 'HOU', 'golden state': 'GS', 'portland': 'POR',
          'toronto': 'TOR', 'minnesota': 'MIN', 'new york': 'NY',
          'new orleans': 'NO', 'atlanta': 'ATL', 'boston': 'BOS'
        };
        
        const nflNameToAbbrev: { [key: string]: string } = {
          'arizona': 'ARI', 'atlanta': 'ATL', 'baltimore': 'BAL', 'buffalo': 'BUF',
          'carolina': 'CAR', 'chicago': 'CHI', 'cincinnati': 'CIN', 'cleveland': 'CLE',
          'dallas': 'DAL', 'denver': 'DEN', 'detroit': 'DET', 'green bay': 'GB',
          'houston': 'HOU', 'indianapolis': 'IND', 'jacksonville': 'JAX', 'kansas city': 'KC',
          'las vegas': 'LV', 'oakland': 'LV', 'raiders': 'LV', 'la rams': 'LAR',
          'los angeles rams': 'LAR', 'la chargers': 'LAC', 'los angeles chargers': 'LAC',
          'miami': 'MIA', 'minnesota': 'MIN', 'new england': 'NE', 'new orleans': 'NO',
          'ny giants': 'NYG', 'new york giants': 'NYG', 'ny jets': 'NYJ', 'new york jets': 'NYJ',
          'philadelphia': 'PHI', 'pittsburgh': 'PIT', 'san francisco': 'SF', 'seattle': 'SEA',
          'tampa bay': 'TB', 'tennessee': 'TEN', 'washington': 'WAS'
        };
        
        const nameToAbbrev = sport === 'nfl' ? nflNameToAbbrev : nbaNameToAbbrev;
        
        const awayKey = awayName.toLowerCase();
        const homeKey = homeName.toLowerCase();
        
        for (const [name, abbrev] of Object.entries(nameToAbbrev)) {
          if (awayKey.includes(name)) {
            awayAbbrev = abbrev;
          }
          if (homeKey.includes(name)) {
            homeAbbrev = abbrev;
          }
        }
      }
    }
    
    if (!awayAbbrev || !homeAbbrev) {
      return null;
    }

    return {
      id: `${awayAbbrev}-${homeAbbrev}-${raw.event_ticker || raw.ticker || ''}`,
      homeTeam: homeAbbrev,
      awayTeam: awayAbbrev,
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
   * Ticker format: KXNBAGAME-25NOV28PHXSAC-SAC (last part indicates the team)
   */
  private determineSide(raw: any, game: Game): 'home' | 'away' {
    const ticker = (raw.ticker || '').toString().toUpperCase();
    const homeTeam = game.homeTeam.toUpperCase();
    const awayTeam = game.awayTeam.toUpperCase();

    // Extract the team abbreviation from the end of the ticker (after last dash)
    // Format: KXNBAGAME-25NOV28PHXSAC-SAC
    const tickerParts = ticker.split('-');
    if (tickerParts.length > 0) {
      const lastPart = tickerParts[tickerParts.length - 1];
      
      // Check if the last part matches home or away team
      if (lastPart === homeTeam || lastPart.includes(homeTeam)) {
        return 'home';
      }
      if (lastPart === awayTeam || lastPart.includes(awayTeam)) {
        return 'away';
      }
    }

    // Fallback: check if ticker contains team abbreviations
    if (ticker.includes(homeTeam)) {
      return 'home';
    }
    if (ticker.includes(awayTeam)) {
      return 'away';
    }

    // Default to home if we can't determine
    return 'home';
  }
}
