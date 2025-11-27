import axios from 'axios';
import { config } from '../config';
import { SportsbookOdds, Game } from '../types/markets';
import { impliedProbabilityFromAmerican } from '../lib/odds';

export class ESPNClient {
  private client;

  constructor() {
    // Normalize base URL - remove /scoreboard if it's already there
    let baseURL = config.espn.apiBaseUrl.replace(/\/$/, ''); // Remove trailing slash
    if (baseURL.endsWith('/scoreboard')) {
      baseURL = baseURL.replace(/\/scoreboard$/, '');
    }
    
    this.client = axios.create({
      baseURL: baseURL,
      timeout: 10000,
    });
  }

  /**
   * Fetch games with odds from ESPN for a specific sport
   */
  async fetchGamesWithOdds(sportPath: string): Promise<SportsbookOdds[]> {
    try {
      const response = await this.client.get(sportPath);
      const events = response.data?.events || [];
      const results = this.parseGamesWithOdds(events);
      return results;
    } catch (error: any) {
      console.error('ESPN API Error:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response headers:', JSON.stringify(error.response.headers));
        console.error('Request URL:', error.config?.url || 'unknown');
        console.error('Full request URL:', error.config?.baseURL + error.config?.url);
        if (error.response.data) {
          const dataStr = typeof error.response.data === 'string' 
            ? error.response.data 
            : JSON.stringify(error.response.data);
          console.error('Response data:', dataStr.substring(0, 1000));
        }
      } else if (error.request) {
        console.error('No response received. Request config:', JSON.stringify({
          url: error.config?.url,
          baseURL: error.config?.baseURL,
          method: error.config?.method,
        }));
      }
      throw new Error(`Failed to fetch ESPN games: ${error.message}`);
    }
  }

  /**
   * Parse ESPN game data into SportsbookOdds format
   */
  private parseGamesWithOdds(events: any[]): SportsbookOdds[] {
    const results: SportsbookOdds[] = [];

    for (const event of events) {
      try {
        const game = this.extractGame(event);
        if (!game) {
          continue;
        }

        const odds = this.extractOdds(event);
        
        if (!odds.homeOdds && !odds.awayOdds) {
          continue;
        }

        const homeProb = odds.homeOdds ? impliedProbabilityFromAmerican(odds.homeOdds) : undefined;
        const awayProb = odds.awayOdds ? impliedProbabilityFromAmerican(odds.awayOdds) : undefined;

        results.push({
          gameId: game.id,
          game,
          homeOdds: odds.homeOdds,
          awayOdds: odds.awayOdds,
          homeImpliedProbability: homeProb,
          awayImpliedProbability: awayProb,
        });
      } catch (error: any) {
        // Silently skip invalid events
      }
    }

    return results;
  }

  /**
   * Extract game information from ESPN event
   */
  private extractGame(event: any): Game | null {
    const competitions = event.competitions || [];
    if (competitions.length === 0) return null;

    const competition = competitions[0];
    const competitors = competition.competitors || [];
    
    if (competitors.length < 2) return null;

    // Determine home/away teams
    const homeTeam = competitors.find((c: any) => c.homeAway === 'home');
    const awayTeam = competitors.find((c: any) => c.homeAway === 'away');

    if (!homeTeam || !awayTeam) return null;

    return {
      id: event.id || competition.id || '',
      homeTeam: homeTeam.team?.abbreviation || homeTeam.team?.name || '',
      awayTeam: awayTeam.team?.abbreviation || awayTeam.team?.name || '',
      scheduledTime: competition.date || event.date || new Date().toISOString(),
      status: competition.status?.type?.name || event.status?.type?.name,
    };
  }

  /**
   * Extract odds from ESPN event
   * Based on actual ESPN API structure from scoreboard endpoint
   */
  private extractOdds(event: any): { homeOdds?: number; awayOdds?: number } {
    const competitions = event.competitions || [];
    if (competitions.length === 0) return {};

    const competition = competitions[0];
    const competitors = competition.competitors || [];
    
    // First, try to get odds directly from competitors array
    // Each competitor has odds.moneyLine field directly
    const homeCompetitor = competitors.find((c: any) => c.homeAway === 'home');
    const awayCompetitor = competitors.find((c: any) => c.homeAway === 'away');
    
    if (homeCompetitor?.odds?.moneyLine !== undefined && awayCompetitor?.odds?.moneyLine !== undefined) {
      return {
        homeOdds: homeCompetitor.odds.moneyLine,
        awayOdds: awayCompetitor.odds.moneyLine,
      };
    }
    
    // Try competition.moneyline object (most common for NCAAF)
    // Structure: competition.moneyline.home.close.odds and competition.moneyline.away.close.odds
    if (competition.moneyline) {
      const ml = competition.moneyline;
      
      // Try close odds first, then open odds
      const homeOddsStr = ml.home?.close?.odds || ml.home?.open?.odds;
      const awayOddsStr = ml.away?.close?.odds || ml.away?.open?.odds;
      
      if (homeOddsStr && awayOddsStr) {
        const homeOdds = this.parseOddsString(homeOddsStr);
        const awayOdds = this.parseOddsString(awayOddsStr);
        
        if (homeOdds !== null && awayOdds !== null) {
          return { homeOdds, awayOdds };
        }
      }
    }
    
    // Fall back to odds array with provider structure
    const oddsArray = competition.odds || [];
    if (Array.isArray(oddsArray) && oddsArray.length > 0) {
      // Look for moneyline in the odds array
      // NCAAF structure: odds[].moneyline.home.close.odds and odds[].moneyline.away.close.odds
      for (const oddsObj of oddsArray) {
        // Check if moneyline object exists in the odds object
        if (oddsObj.moneyline) {
          const ml = oddsObj.moneyline;
          const homeOddsStr = ml.home?.close?.odds || ml.home?.open?.odds;
          const awayOddsStr = ml.away?.close?.odds || ml.away?.open?.odds;
          
          if (homeOddsStr && awayOddsStr) {
            const homeOdds = this.parseOddsString(homeOddsStr);
            const awayOdds = this.parseOddsString(awayOddsStr);
            
            if (homeOdds !== null && awayOdds !== null) {
              return { homeOdds, awayOdds };
            }
          }
        }
        
        // Also check for moneyLine in awayTeamOdds/homeTeamOdds (for other sports)
        if (oddsObj.awayTeamOdds?.moneyLine !== undefined && oddsObj.homeTeamOdds?.moneyLine !== undefined) {
          // Only use if both are not null
          if (oddsObj.awayTeamOdds.moneyLine !== null && oddsObj.homeTeamOdds.moneyLine !== null) {
            return {
              homeOdds: oddsObj.homeTeamOdds.moneyLine,
              awayOdds: oddsObj.awayTeamOdds.moneyLine,
            };
          }
        }
      }
    }

    return {};
  }

  /**
   * Parse odds string to number
   * Handles formats like "-105", "+150", "EVEN" (which is +100)
   */
  private parseOddsString(oddsStr: string | number): number | null {
    if (typeof oddsStr === 'number') {
      return oddsStr;
    }
    
    if (typeof oddsStr !== 'string') {
      return null;
    }
    
    const trimmed = oddsStr.trim().toUpperCase();
    
    // Handle "EVEN" which means +100
    if (trimmed === 'EVEN' || trimmed === 'EV') {
      return 100;
    }
    
    // Parse numeric odds like "-105" or "+150"
    const parsed = parseInt(trimmed);
    if (!isNaN(parsed)) {
      return parsed;
    }
    
    return null;
  }
}
