export interface Game {
  id: string;
  homeTeam: string;
  awayTeam: string;
  scheduledTime: string;
  status?: string;
}

export interface Market {
  gameId: string;
  game: Game;
  marketId: string;
  ticker: string;
  title: string;
  side: 'home' | 'away';
  price: number; // Kalshi price (0-100 or 0-1)
  impliedProbability: number;
}

export interface SportsbookOdds {
  gameId: string;
  game: Game;
  homeOdds?: number; // American odds format
  awayOdds?: number; // American odds format
  homeImpliedProbability?: number;
  awayImpliedProbability?: number;
}

export interface Mispricing {
  game: Game;
  side: 'home' | 'away';
  /**
   * Optional Kalshi market ticker for this mispricing (if available).
   * Useful for mapping back to a specific market when placing trades.
   */
  ticker?: string;
  kalshiPrice: number;
  kalshiImpliedProbability: number;
  sportsbookOdds: number;
  sportsbookImpliedProbability: number;
  difference: number; // Absolute difference in probability
  differencePct: number; // Difference as percentage points
  isKalshiOvervaluing?: boolean; // True if Kalshi has higher implied probability than ESPN
}
