const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

class NBAService {
  constructor() {
    this.apiKey = config.nba.apiKey;
    this.baseUrl = config.nba.baseUrl;
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
      },
    });
  }

  /**
   * Get today's NBA games
   */
  async getTodaysGames() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const response = await this.client.get(`/trial/v7/en/games/${today}/schedule.json?api_key=${this.apiKey}`);
      
      if (response.data && response.data.games) {
        return response.data.games.filter(game => 
          game.status === 'scheduled' || game.status === 'inprogress'
        );
      }
      return [];
    } catch (error) {
      logger.error('Error fetching today\'s games:', error.message);
      throw error;
    }
  }

  /**
   * Get game details including odds
   */
  async getGameDetails(gameId) {
    try {
      const response = await this.client.get(`/trial/v7/en/games/${gameId}/boxscore.json?api_key=${this.apiKey}`);
      return response.data;
    } catch (error) {
      logger.error(`Error fetching game details for ${gameId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get team standings
   */
  async getStandings() {
    try {
      const response = await this.client.get(`/trial/v7/en/seasons/2023/standings.json?api_key=${this.apiKey}`);
      return response.data;
    } catch (error) {
      logger.error('Error fetching standings:', error.message);
      throw error;
    }
  }

  /**
   * Get player statistics
   */
  async getPlayerStats(playerId, season = '2023') {
    try {
      const response = await this.client.get(`/trial/v7/en/players/${playerId}/profile.json?api_key=${this.apiKey}`);
      return response.data;
    } catch (error) {
      logger.error(`Error fetching player stats for ${playerId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get upcoming games for the next N days
   */
  async getUpcomingGames(days = 7) {
    try {
      const games = [];
      const today = new Date();
      
      for (let i = 0; i < days; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        const dateString = date.toISOString().split('T')[0];
        
        try {
          const response = await this.client.get(`/trial/v7/en/games/${dateString}/schedule.json?api_key=${this.apiKey}`);
          if (response.data && response.data.games) {
            games.push(...response.data.games);
          }
        } catch (error) {
          logger.warn(`No games found for ${dateString}`);
        }
      }
      
      return games;
    } catch (error) {
      logger.error('Error fetching upcoming games:', error.message);
      throw error;
    }
  }

  /**
   * Parse game data into market format
   */
  parseGameToMarket(game) {
    if (!game || !game.home || !game.away) {
      return null;
    }

    return {
      id: game.id,
      homeTeam: {
        id: game.home.id,
        name: game.home.name,
        alias: game.home.alias,
      },
      awayTeam: {
        id: game.away.id,
        name: game.away.name,
        alias: game.away.alias,
      },
      scheduled: game.scheduled,
      status: game.status,
      venue: game.venue,
      // Add more fields as needed for your trading strategy
      marketType: 'game_winner',
      odds: this.calculateOdds(game), // You'll need to implement this based on your data source
    };
  }

  /**
   * Calculate odds based on team performance (placeholder implementation)
   */
  calculateOdds(game) {
    // This is a placeholder - you'll need to implement actual odds calculation
    // based on team stats, recent performance, etc.
    return {
      home: 1.8,
      away: 2.0,
    };
  }
}

module.exports = NBAService;

