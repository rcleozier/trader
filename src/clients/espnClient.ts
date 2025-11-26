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
      // ESPN scoreboard endpoint
      const response = await this.client.get('/scoreboard');
      const games = response.data?.events || [];

      return this.parseGamesWithOdds(games);
    } catch (error: any) {
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
        if (!game) continue;

        // ESPN odds are typically in competitions[0].odds or competitions[0].oddsDetails
        const odds = this.extractOdds(event);
        
        if (!odds.homeOdds && !odds.awayOdds) {
          // Skip games without odds
          continue;
        }

        results.push({
          gameId: game.id,
          game,
          homeOdds: odds.homeOdds,
          awayOdds: odds.awayOdds,
          homeImpliedProbability: odds.homeOdds 
            ? impliedProbabilityFromAmerican(odds.homeOdds) 
            : undefined,
          awayImpliedProbability: odds.awayOdds 
            ? impliedProbabilityFromAmerican(odds.awayOdds) 
            : undefined,
        });
      } catch (error) {
        console.warn(`Failed to parse ESPN game ${event.id}:`, error);
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
   * ESPN odds structure can vary - this is a best-effort extraction
   */
  private extractOdds(event: any): { homeOdds?: number; awayOdds?: number } {
    const competitions = event.competitions || [];
    if (competitions.length === 0) return {};

    const competition = competitions[0];
    
    // Try various locations for odds
    // ESPN may have odds in competition.odds, competition.oddsDetails, or event.odds
    const oddsSource = competition.odds || competition.oddsDetails || event.odds || [];
    
    if (!Array.isArray(oddsSource) || oddsSource.length === 0) {
      return {};
    }

    // Look for moneyline odds
    const moneyline = oddsSource.find((o: any) => 
      o.type === 'moneyline' || 
      o.name === 'Moneyline' ||
      o.typeId === '1' // Common ID for moneyline
    );

    if (!moneyline) return {};

    // ESPN odds format can vary - try to extract from details or outcomes
    const details = moneyline.details || moneyline.outcomes || [];
    
    if (details.length < 2) return {};

    // Try to match outcomes to home/away teams
    const competitors = competition.competitors || [];
    const homeTeam = competitors.find((c: any) => c.homeAway === 'home')?.team;
    const awayTeam = competitors.find((c: any) => c.homeAway === 'away')?.team;

    let homeOdds: number | undefined;
    let awayOdds: number | undefined;

    for (const detail of details) {
      const teamName = detail.name || detail.label || '';
      const odds = detail.odds || detail.american || detail.price;

      if (odds === undefined || odds === null) continue;

      // Match to home/away team
      if (homeTeam && (teamName.includes(homeTeam.abbreviation) || teamName.includes(homeTeam.name))) {
        homeOdds = typeof odds === 'string' ? parseInt(odds) : odds;
      } else if (awayTeam && (teamName.includes(awayTeam.abbreviation) || teamName.includes(awayTeam.name))) {
        awayOdds = typeof odds === 'string' ? parseInt(odds) : odds;
      }
    }

    return { homeOdds, awayOdds };
  }
}
