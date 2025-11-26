import axios from 'axios';
import { config } from '../config';
import { SportsbookOdds, Game } from '../types/markets';
import { impliedProbabilityFromAmerican } from '../lib/odds';

export class ESPNClient {
  private client = axios.create({
    baseURL: config.espn.apiBaseUrl,
    timeout: 10000,
  });

  /**
   * Fetch NBA games with odds from ESPN
   */
  async fetchNBAGamesWithOdds(): Promise<SportsbookOdds[]> {
    try {
      // Normalize base URL - remove trailing slash if present
      const baseUrl = config.espn.apiBaseUrl.replace(/\/$/, '');
      
      // Check if base URL already includes /scoreboard
      let endpoint: string;
      if (baseUrl.endsWith('/scoreboard')) {
        // Base URL is already the full endpoint, use empty string
        endpoint = '';
      } else {
        // Append /scoreboard
        endpoint = '/scoreboard';
      }
      
      const fullUrl = baseUrl + endpoint;
      console.log(`Fetching from ESPN API: ${fullUrl}`);
      
      // ESPN scoreboard endpoint
      const response = await this.client.get(endpoint);
      const events = response.data?.events || [];
      console.log(`ESPN API returned ${events.length} events`);

      const results = this.parseGamesWithOdds(events);
      console.log(`Parsed ${results.length} games with odds from ESPN`);
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
          console.log(`  Skipping event ${event.id}: could not extract game info`);
          continue;
        }

        console.log(`  Processing game: ${game.awayTeam} @ ${game.homeTeam} (${game.id})`);

        // ESPN odds are in competitions[0].odds array
        const odds = this.extractOdds(event);
        
        if (!odds.homeOdds && !odds.awayOdds) {
          console.log(`    No odds found for ${game.awayTeam} @ ${game.homeTeam}`);
          continue;
        }

        const homeProb = odds.homeOdds ? impliedProbabilityFromAmerican(odds.homeOdds) : undefined;
        const awayProb = odds.awayOdds ? impliedProbabilityFromAmerican(odds.awayOdds) : undefined;

        console.log(`    Odds found - Home: ${odds.homeOdds ? odds.homeOdds : 'N/A'} (${homeProb ? (homeProb * 100).toFixed(1) : 'N/A'}%), Away: ${odds.awayOdds ? odds.awayOdds : 'N/A'} (${awayProb ? (awayProb * 100).toFixed(1) : 'N/A'}%)`);

        results.push({
          gameId: game.id,
          game,
          homeOdds: odds.homeOdds,
          awayOdds: odds.awayOdds,
          homeImpliedProbability: homeProb,
          awayImpliedProbability: awayProb,
        });
      } catch (error: any) {
        console.warn(`  Failed to parse ESPN game ${event.id}:`, error.message);
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
    
    // ESPN has odds in two places:
    // 1. competition.odds array (provider-based)
    // 2. competition.moneyline object (direct moneyline odds)
    
    // Try the direct moneyline object first (simpler structure)
    if (competition.moneyline) {
      const ml = competition.moneyline;
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
      // The structure has awayTeamOdds and homeTeamOdds with moneyLine field
      for (const oddsObj of oddsArray) {
        if (oddsObj.awayTeamOdds?.moneyLine && oddsObj.homeTeamOdds?.moneyLine) {
          return {
            homeOdds: oddsObj.homeTeamOdds.moneyLine,
            awayOdds: oddsObj.awayTeamOdds.moneyLine,
          };
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
