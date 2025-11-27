import { Configuration, MarketsApi, EventsApi, SeriesApi, PortfolioApi } from 'kalshi-typescript';
import axios from 'axios';
import { config } from '../config';
import { Market, Game } from '../types/markets';
import { impliedProbabilityFromKalshiPrice } from '../lib/odds';

export class KalshiClient {
  private marketsApi: MarketsApi;
  private eventsApi: EventsApi;
  private seriesApi: SeriesApi;
  public portfolioApi: PortfolioApi; // Made public for trading service access
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
    this.portfolioApi = new PortfolioApi(this.kalshiConfig);
    
    // Create axios client for direct API calls (like live-data)
    this.axiosClient = axios.create({
      baseURL: config.kalshi.apiBaseUrl,
      timeout: 10000,
    });
  }

  /**
   * Fetch markets from Kalshi for a specific series
   */
  async fetchMarkets(seriesTicker: string, sport: 'nba' | 'nfl' | 'nhl' | 'ncaab' | 'ncaaf' = 'nba'): Promise<Market[]> {
    try {
      const currentTime = Math.floor(Date.now() / 1000);
      
      // Try both lowercase and uppercase versions of the series ticker
      const seriesTickersToTry = [seriesTicker, seriesTicker.toUpperCase(), seriesTicker.toLowerCase()];
      const uniqueSeriesTickers = Array.from(new Set(seriesTickersToTry));
      
      let allMarkets: any[] = [];
      
      for (const tickerToTry of uniqueSeriesTickers) {
        try {
          const marketsResponse = await this.marketsApi.getMarkets(
            1000, // limit
            undefined, // cursor
            undefined, // eventTicker
            tickerToTry, // seriesTicker
            undefined, // maxCloseTs
            currentTime, // minCloseTs - markets closing now or later (live games)
            'open', // status
            undefined // tickers
          );

          const markets = marketsResponse.data?.markets || [];
          if (markets.length > 0) {
            allMarkets = markets;
            break; // Found markets, stop trying other variations
          }
        } catch (error: any) {
          // Silently try next variation
        }
      }
      
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
  private parseMarkets(rawMarkets: any[], sport: 'nba' | 'nfl' | 'nhl' | 'ncaab' | 'ncaaf' = 'nba'): Market[] {
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
  private extractGameInfo(raw: any, sport: 'nba' | 'nfl' | 'nhl' | 'ncaab' | 'ncaaf' = 'nba'): Game | null {
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
    
    const nhlTeamAbbrevMap: { [key: string]: string } = {
      'ANA': 'ANA', 'ARI': 'ARI', 'BOS': 'BOS', 'BUF': 'BUF', 'CGY': 'CGY',
      'CAR': 'CAR', 'CHI': 'CHI', 'COL': 'COL', 'CBJ': 'CBJ', 'DAL': 'DAL',
      'DET': 'DET', 'EDM': 'EDM', 'FLA': 'FLA', 'LA': 'LAK', 'LAK': 'LAK',
      'MIN': 'MIN', 'MTL': 'MTL', 'NSH': 'NSH', 'NJ': 'NJD', 'NJD': 'NJD',
      'NYI': 'NYI', 'NYR': 'NYR', 'OTT': 'OTT', 'PHI': 'PHI', 'PIT': 'PIT',
      'SJ': 'SJS', 'SJS': 'SJS', 'SEA': 'SEA', 'STL': 'STL', 'TB': 'TBL',
      'TBL': 'TBL', 'TOR': 'TOR', 'VAN': 'VAN', 'VGK': 'VGK', 'WAS': 'WSH',
      'WSH': 'WSH', 'WPG': 'WPG'
    };
    
    // For college sports, we'll use a simplified approach - just try to parse the ticker
    // College teams have many variations, so we'll be more flexible
    const teamAbbrevMap = sport === 'nfl' ? nflTeamAbbrevMap : 
                         sport === 'nhl' ? nhlTeamAbbrevMap : 
                         sport === 'ncaab' || sport === 'ncaaf' ? {} : // Empty map for college - will parse from ticker
                         nbaTeamAbbrevMap;
    const seriesPrefix = sport === 'nfl' ? 'KXNFLGAME' : 
                        sport === 'nhl' ? 'KXNHLGAME' : 
                        sport === 'ncaab' ? 'KXNCAABGAME' :
                        sport === 'ncaaf' ? 'KXNCAAGAME' :
                        'KXNBAGAME';
    
    // Try to extract from event ticker first (most reliable)
    // Format: KXNBAGAME-25NOV28DALLAL or kxnflgame-25DEC01NYGNE
    let awayAbbrev: string | null = null;
    let homeAbbrev: string | null = null;
    
    if (eventTicker) {
      // Extract the team abbreviations part (after date) - case insensitive
      const eventMatch = eventTicker.match(new RegExp(`${seriesPrefix}-\\d+([A-Z]+)`, 'i'));
      if (eventMatch) {
        const combinedAbbrev = eventMatch[1];
        // Try to split combined abbreviations (e.g., DALLAL = DAL + LAL)
        // Common patterns: 3+3, 3+4, 4+3, 3+2, 2+3
        const possibleSplits = [
          [3, 3], [3, 4], [4, 3], [3, 2], [2, 3], [4, 4], [2, 4], [4, 2]
        ];
        
        // Handle partial abbreviations mapping (e.g., "LA" -> "LAR" for Rams)
        const partialToFull: { [key: string]: string } = sport === 'nfl' ? {
          'LA': 'LAR', // Los Angeles Rams
        } : sport === 'nhl' ? {
          'LA': 'LAK', // Los Angeles Kings
          'SJ': 'SJS', // San Jose Sharks
          'NJ': 'NJD', // New Jersey Devils
          'TB': 'TBL', // Tampa Bay Lightning
        } : {};
        
        for (const [len1, len2] of possibleSplits) {
          if (combinedAbbrev.length >= len1 + len2) {
            const abbrev1 = combinedAbbrev.substring(0, len1);
            const abbrev2 = combinedAbbrev.substring(len1, len1 + len2);
            
            // Check if both are valid team abbreviations
            // Handle partial abbreviations (e.g., "LA" for "LAR")
            let abbrev1Full = teamAbbrevMap[abbrev1];
            let abbrev2Full = teamAbbrevMap[abbrev2];
            
            // Try partial mapping if direct lookup failed
            if (!abbrev1Full && partialToFull[abbrev1]) {
              abbrev1Full = teamAbbrevMap[partialToFull[abbrev1]];
            }
            if (!abbrev2Full && partialToFull[abbrev2]) {
              abbrev2Full = teamAbbrevMap[partialToFull[abbrev2]];
            }
            
            // Also try if abbrev1/abbrev2 is a prefix of a valid team abbrev
            if (!abbrev1Full || !abbrev2Full) {
              for (const [key, value] of Object.entries(teamAbbrevMap)) {
                if (!abbrev1Full && key.startsWith(abbrev1) && key.length <= abbrev1.length + 1) {
                  abbrev1Full = value;
                }
                if (!abbrev2Full && key.startsWith(abbrev2) && key.length <= abbrev2.length + 1) {
                  abbrev2Full = value;
                }
              }
            }
            
            if (abbrev1Full && abbrev2Full) {
              awayAbbrev = abbrev1Full;
              homeAbbrev = abbrev2Full;
              break;
            }
          }
        }
        
        // Special case: if we have LAARI, try LA (2) + ARI (3)
        if (!awayAbbrev && combinedAbbrev === 'LAARI' && sport === 'nfl') {
          awayAbbrev = 'LAR';
          homeAbbrev = 'ARI';
        }
      }
    }
    
    // Fallback: Try from ticker format KXNBAGAME-25NOV28DALLAL-LAL or KXNFLGAME-25DEC07LAARI-LA
    if (!awayAbbrev && ticker) {
      const tickerMatch = ticker.match(new RegExp(`${seriesPrefix}-\\d+([A-Z]+)-([A-Z]+)`, 'i'));
      if (tickerMatch) {
        const combined = tickerMatch[1];
        const sideAbbrev = tickerMatch[2];
        
        // Handle partial abbreviations (e.g., "LA" should map to "LAR" for Rams)
        const partialAbbrevMap: { [key: string]: string } = {
          'LA': 'LAR', // Los Angeles Rams
          'LAC': 'LAC', // Los Angeles Chargers (full)
        };
        const fullSideAbbrev = partialAbbrevMap[sideAbbrev] || sideAbbrev;
        
        // Try to split combined to find the other team
        for (const [len1, len2] of [[3, 3], [3, 4], [4, 3], [3, 2], [2, 3], [2, 4], [4, 2]]) {
          if (combined.length >= len1 + len2) {
            const abbrev1 = combined.substring(0, len1);
            const abbrev2 = combined.substring(len1, len1 + len2);
            
            // Check if either matches the side abbreviation (full or partial)
            const abbrev1Full = teamAbbrevMap[abbrev1];
            const abbrev2Full = teamAbbrevMap[abbrev2];
            
            if (abbrev1Full && abbrev2Full) {
              // Check if side abbrev matches either team (handling partial matches)
              if (abbrev1Full === fullSideAbbrev || abbrev1 === sideAbbrev || abbrev1Full.startsWith(sideAbbrev)) {
                awayAbbrev = abbrev2Full;
                homeAbbrev = abbrev1Full;
                break;
              } else if (abbrev2Full === fullSideAbbrev || abbrev2 === sideAbbrev || abbrev2Full.startsWith(sideAbbrev)) {
                awayAbbrev = abbrev1Full;
                homeAbbrev = abbrev2Full;
                break;
              }
            } else if (sport === 'ncaab' || sport === 'ncaaf') {
              // For college sports, if we can't find in map, use the abbreviations directly
              if (abbrev1 && abbrev2) {
                // Check which matches the side abbreviation
                if (abbrev1 === sideAbbrev || abbrev1.startsWith(sideAbbrev) || sideAbbrev.startsWith(abbrev1)) {
                  homeAbbrev = abbrev1;
                  awayAbbrev = abbrev2;
                } else if (abbrev2 === sideAbbrev || abbrev2.startsWith(sideAbbrev) || sideAbbrev.startsWith(abbrev2)) {
                  homeAbbrev = abbrev2;
                  awayAbbrev = abbrev1;
                } else {
                  // Default: first is away, second is home
                  awayAbbrev = abbrev1;
                  homeAbbrev = abbrev2;
                }
                break;
              }
            }
          }
        }
      }
    }
    
    // Last resort: Try to parse from title
    if (!awayAbbrev) {
      if (sport === 'nfl') {
        const result = this.parseNFLTitle(title);
        if (result) {
          awayAbbrev = result.away;
          homeAbbrev = result.home;
        }
      } else if (sport === 'nhl') {
        const result = this.parseNHLTitle(title);
        if (result) {
          awayAbbrev = result.away;
          homeAbbrev = result.home;
        }
      } else if (sport === 'ncaab') {
        // For college basketball, try to parse from title (similar to NBA)
        const result = this.parseNBATitle(title); // Use NBA parser as format is similar
        if (result) {
          awayAbbrev = result.away;
          homeAbbrev = result.home;
        }
      } else if (sport === 'ncaaf') {
        // For college football, try to parse from title (similar to NFL)
        const result = this.parseNFLTitle(title); // Use NFL parser as format is similar
        if (result) {
          awayAbbrev = result.away;
          homeAbbrev = result.home;
        }
      } else {
        const result = this.parseNBATitle(title);
        if (result) {
          awayAbbrev = result.away;
          homeAbbrev = result.home;
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
   * Parse NBA title to extract team abbreviations
   * Format: "Dallas vs Los Angeles L Winner?" or "Dallas @ Los Angeles L"
   */
  private parseNBATitle(title: string): { away: string; home: string } | null {
    // Match pattern: "Team1 @ Team2" or "Team1 vs Team2" (NBA uses @ or vs)
    const titleMatch = title.match(/([A-Za-z\s]+?)\s*(?:@|vs|v\.?)\s*([A-Za-z\s]+?)(?:\s|$|:)/i);
    if (!titleMatch) return null;
    
    const awayName = titleMatch[1]?.trim() || '';
    const homeName = titleMatch[2]?.trim() || '';
    
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
    
    const awayKey = awayName.toLowerCase().trim();
    const homeKey = homeName.toLowerCase().trim();
    
    let awayAbbrev: string | null = null;
    let homeAbbrev: string | null = null;
    
    // Try to match team names
    for (const [name, abbrev] of Object.entries(nbaNameToAbbrev)) {
      if (awayKey.includes(name) || name.includes(awayKey)) {
        awayAbbrev = abbrev;
      }
      if (homeKey.includes(name) || name.includes(homeKey)) {
        homeAbbrev = abbrev;
      }
    }
    
    if (awayAbbrev && homeAbbrev) {
      return { away: awayAbbrev, home: homeAbbrev };
    }
    
    return null;
  }

  /**
   * Parse NHL title to extract team abbreviations
   * Format: "New York Rangers at Boston Bruins Winner?" or "Toronto at Montreal"
   */
  private parseNHLTitle(title: string): { away: string; home: string } | null {
    // Match pattern: "Team1 at Team2" (NHL uses "at")
    const titleMatch = title.match(/([A-Za-z\s]+?)\s+at\s+([A-Za-z\s]+?)(?:\s|$|:)/i);
    if (!titleMatch) return null;
    
    const awayName = titleMatch[1]?.trim() || '';
    const homeName = titleMatch[2]?.trim() || '';
    
    const nhlNameToAbbrev: { [key: string]: string } = {
      'anaheim': 'ANA', 'arizona': 'ARI', 'boston': 'BOS', 'buffalo': 'BUF',
      'calgary': 'CGY', 'carolina': 'CAR', 'chicago': 'CHI', 'colorado': 'COL',
      'columbus': 'CBJ', 'dallas': 'DAL', 'detroit': 'DET', 'edmonton': 'EDM',
      'florida': 'FLA', 'los angeles': 'LAK', 'la kings': 'LAK', 'minnesota': 'MIN',
      'montreal': 'MTL', 'nashville': 'NSH', 'new jersey': 'NJD', 'ny islanders': 'NYI',
      'new york islanders': 'NYI', 'ny rangers': 'NYR', 'new york rangers': 'NYR',
      'ottawa': 'OTT', 'philadelphia': 'PHI', 'pittsburgh': 'PIT', 'san jose': 'SJS',
      'seattle': 'SEA', 'st louis': 'STL', 'tampa bay': 'TBL', 'toronto': 'TOR',
      'vancouver': 'VAN', 'vegas': 'VGK', 'washington': 'WSH', 'winnipeg': 'WPG'
    };
    
    const awayKey = awayName.toLowerCase().trim();
    const homeKey = homeName.toLowerCase().trim();
    
    let awayAbbrev: string | null = null;
    let homeAbbrev: string | null = null;
    
    // Try to match team names (check for partial matches)
    for (const [name, abbrev] of Object.entries(nhlNameToAbbrev)) {
      if (awayKey.includes(name) || name.includes(awayKey)) {
        awayAbbrev = abbrev;
      }
      if (homeKey.includes(name) || name.includes(homeKey)) {
        homeAbbrev = abbrev;
      }
    }
    
    if (awayAbbrev && homeAbbrev) {
      return { away: awayAbbrev, home: homeAbbrev };
    }
    
    return null;
  }

  /**
   * Parse NFL title to extract team abbreviations
   * Format: "Philadelphia at Los Angeles C Winner?" or "Houston at Kansas City"
   */
  private parseNFLTitle(title: string): { away: string; home: string } | null {
    // Match pattern: "Team1 at Team2" (NFL uses "at")
    const titleMatch = title.match(/([A-Za-z\s]+?)\s+at\s+([A-Za-z\s]+?)(?:\s|$|:)/i);
    if (!titleMatch) return null;
    
    const awayName = titleMatch[1]?.trim() || '';
    const homeName = titleMatch[2]?.trim() || '';
    
    const nflNameToAbbrev: { [key: string]: string } = {
      'arizona': 'ARI', 'atlanta': 'ATL', 'baltimore': 'BAL', 'buffalo': 'BUF',
      'carolina': 'CAR', 'chicago': 'CHI', 'cincinnati': 'CIN', 'cleveland': 'CLE',
      'dallas': 'DAL', 'denver': 'DEN', 'detroit': 'DET', 'green bay': 'GB',
      'houston': 'HOU', 'indianapolis': 'IND', 'jacksonville': 'JAX', 'kansas city': 'KC',
      'las vegas': 'LV', 'oakland': 'LV', 'raiders': 'LV', 'la rams': 'LAR',
      'los angeles rams': 'LAR', 'los angeles r': 'LAR', 'la chargers': 'LAC',
      'los angeles chargers': 'LAC', 'los angeles c': 'LAC', 'miami': 'MIA',
      'minnesota': 'MIN', 'new england': 'NE', 'new orleans': 'NO',
      'ny giants': 'NYG', 'new york giants': 'NYG', 'ny jets': 'NYJ', 'new york jets': 'NYJ',
      'philadelphia': 'PHI', 'pittsburgh': 'PIT', 'san francisco': 'SF', 'seattle': 'SEA',
      'tampa bay': 'TB', 'tennessee': 'TEN', 'washington': 'WAS'
    };
    
    const awayKey = awayName.toLowerCase().trim();
    const homeKey = homeName.toLowerCase().trim();
    
    let awayAbbrev: string | null = null;
    let homeAbbrev: string | null = null;
    
    // Try to match team names (check for partial matches)
    for (const [name, abbrev] of Object.entries(nflNameToAbbrev)) {
      // Check if the name is contained in the team name or vice versa
      if (awayKey.includes(name) || name.includes(awayKey)) {
        awayAbbrev = abbrev;
      }
      if (homeKey.includes(name) || name.includes(homeKey)) {
        homeAbbrev = abbrev;
      }
    }
    
    if (awayAbbrev && homeAbbrev) {
      return { away: awayAbbrev, home: homeAbbrev };
    }
    
    return null;
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
   * For NFL: KXNFLGAME-25DEC07JAXTEN-JAX (JAX = away) or KXNFLGAME-25DEC07JAXTEN-TEN (TEN = home)
   */
  private determineSide(raw: any, game: Game): 'home' | 'away' {
    const ticker = (raw.ticker || '').toString().toUpperCase();
    const homeTeam = game.homeTeam.toUpperCase();
    const awayTeam = game.awayTeam.toUpperCase();

    // Extract the team abbreviation from the end of the ticker (after last dash)
    // Format: KXNBAGAME-25NOV28PHXSAC-SAC or KXNFLGAME-25DEC07JAXTEN-JAX
    const tickerParts = ticker.split('-');
    if (tickerParts.length >= 3) {
      const lastPart = tickerParts[tickerParts.length - 1];
      
      // Handle partial abbreviations (e.g., "LA" for "LAR")
      const partialToFull: { [key: string]: string } = {
        'LA': 'LAR', // Los Angeles Rams
      };
      const normalizedLastPart = partialToFull[lastPart] || lastPart;
      
      // Priority 1: Exact match (most reliable)
      if (lastPart === homeTeam) {
        return 'home';
      }
      if (lastPart === awayTeam) {
        return 'away';
      }
      
      // Priority 2: Normalized partial match (e.g., "LA" -> "LAR")
      if (normalizedLastPart === homeTeam) {
        return 'home';
      }
      if (normalizedLastPart === awayTeam) {
        return 'away';
      }
      
      // Priority 3: Check if last part is a prefix of home/away team (e.g., "LA" matches "LAR")
      // Only if lastPart is at least 2 characters to avoid false matches
      if (lastPart.length >= 2 && homeTeam.startsWith(lastPart)) {
        return 'home';
      }
      if (lastPart.length >= 2 && awayTeam.startsWith(lastPart)) {
        return 'away';
      }
      
      // Priority 4: Check if home/away team is a prefix of last part (less common)
      if (lastPart.startsWith(homeTeam)) {
        return 'home';
      }
      if (lastPart.startsWith(awayTeam)) {
        return 'away';
      }
    }

    // Fallback: check if ticker contains team abbreviations
    // This is less reliable, so we check exact matches in the combined part first
    const combinedPart = tickerParts.length >= 2 ? tickerParts[tickerParts.length - 2] : '';
    if (combinedPart && combinedPart.includes(homeTeam) && !combinedPart.includes(awayTeam)) {
      return 'home';
    }
    if (combinedPart && combinedPart.includes(awayTeam) && !combinedPart.includes(homeTeam)) {
      return 'away';
    }

    // Default to home if we can't determine (shouldn't happen with valid data)
    return 'home';
  }

  /**
   * Get account balance
   */
  async getBalance(): Promise<number | null> {
    try {
      const response = await this.portfolioApi.getBalance();
      // Balance is in cents, convert to dollars
      return response.data?.balance ? response.data.balance / 100 : null;
    } catch (error: any) {
      return null;
    }
  }

  /**
   * Get active positions with market data for cost calculation
   */
  async getActivePositions(): Promise<any[]> {
    try {
      const response = await this.portfolioApi.getPositions(
        undefined, // ticker
        undefined, // eventTicker
        undefined, // countDown
        undefined, // countUp
        1000, // limit
        undefined // cursor
      );
      const positions = response.data?.market_positions || [];
      // Filter for positions with non-zero position count
      const activePositions = positions.filter((p: any) => p.position && p.position !== 0);
      
      // Try to get current market prices to calculate estimated value
      const positionsWithValue = await Promise.all(
        activePositions.map(async (pos: any) => {
          if (pos.total_cost && pos.total_cost > 0) {
            // If total_cost is already available, use it
            return pos;
          }
          
          // Try to fetch current market price to estimate value
          if (pos.ticker) {
            try {
              const marketResponse = await this.marketsApi.getMarkets(
                1, // limit
                undefined, // cursor
                undefined, // eventTicker
                undefined, // seriesTicker
                undefined, // maxCloseTs
                undefined, // minCloseTs
                'open', // status
                pos.ticker // tickers - specific ticker
              );
              
              const markets = marketResponse.data?.markets || [];
              if (markets.length > 0) {
                const market = markets[0];
                const isYesPosition = pos.market_result === 'yes';
                
                // Get the correct price based on position side
                let currentPrice: number | null = null;
                if (isYesPosition) {
                  // For YES positions, use YES price
                  currentPrice = market.last_price !== undefined && market.last_price !== null
                    ? market.last_price
                    : market.yes_bid !== undefined && market.yes_bid !== null
                    ? market.yes_bid
                    : market.yes_ask !== undefined && market.yes_ask !== null
                    ? market.yes_ask
                    : null;
                } else {
                  // For NO positions, use NO price
                  // NO price is typically (100 - YES price), but we can also get it directly
                  const yesPrice = market.last_price !== undefined && market.last_price !== null
                    ? market.last_price
                    : market.yes_bid !== undefined && market.yes_bid !== null
                    ? market.yes_bid
                    : market.yes_ask !== undefined && market.yes_ask !== null
                    ? market.yes_ask
                    : null;
                  
                  if (yesPrice !== null) {
                    // NO price = 100 - YES price
                    currentPrice = 100 - yesPrice;
                  } else if (market.no_bid !== undefined && market.no_bid !== null) {
                    currentPrice = market.no_bid;
                  } else if (market.no_ask !== undefined && market.no_ask !== null) {
                    currentPrice = market.no_ask;
                  }
                }
                
                if (currentPrice !== null) {
                  // Calculate estimated value: position * price (in cents)
                  // Position is in contracts, price is 0-100, so value = position * price (in cents)
                  const estimatedValue = (pos.position || 0) * currentPrice; // in cents
                  pos.estimated_value = estimatedValue;
                  pos.current_price = currentPrice;
                }
              }
            } catch (error: any) {
              // If we can't fetch market data, just continue without estimated value
            }
          }
          
          return pos;
        })
      );
      
      return positionsWithValue;
    } catch (error: any) {
      return [];
    }
  }

  /**
   * Get active orders (resting/pending orders)
   */
  async getActiveOrders(): Promise<any[]> {
    try {
      const response = await this.portfolioApi.getOrders(
        undefined, // ticker
        undefined, // eventTicker
        undefined, // minTs
        undefined, // maxTs
        'resting', // status - only get resting/pending orders
        1000, // limit
        undefined // cursor
      );
      const orders = response.data?.orders || [];
      // Also get pending orders
      const pendingResponse = await this.portfolioApi.getOrders(
        undefined,
        undefined,
        undefined,
        undefined,
        'pending',
        1000,
        undefined
      );
      const pendingOrders = pendingResponse.data?.orders || [];
      return [...orders, ...pendingOrders];
    } catch (error: any) {
      return [];
    }
  }
}
