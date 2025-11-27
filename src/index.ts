import cron from 'node-cron';
import { KalshiClient } from './clients/kalshiClient';
import { ESPNClient } from './clients/espnClient';
import { MispricingService } from './services/mispricingService';
import { config } from './config';

async function runMispricingCheckForSport(sport: 'nba' | 'nfl' | 'nhl', activePositions: any[] = []): Promise<void> {
  const sportConfig = config.sports[sport];

  try {
    // Fetch data from both sources
    const kalshiClient = new KalshiClient();
    const kalshiMarkets = await kalshiClient.fetchMarkets(sportConfig.kalshiSeries, sport);
    
    const espnClient = new ESPNClient();
    const espnOdds = await espnClient.fetchGamesWithOdds(sportConfig.espnPath);

    // Find mispricings
    const mispricingService = new MispricingService();
    const { mispricings } = mispricingService.findMispricings(kalshiMarkets, espnOdds);
    
    // Create a map of positions by ticker - store array since there can be both YES and NO positions
    const positionsByTicker = new Map<string, any[]>();
    for (const pos of activePositions) {
      if (pos.ticker) {
        if (!positionsByTicker.has(pos.ticker)) {
          positionsByTicker.set(pos.ticker, []);
        }
        positionsByTicker.get(pos.ticker)!.push(pos);
      }
    }

    // Group mispricings by game
    const gameMap = new Map<string, typeof mispricings>();
    for (const mispricing of mispricings) {
      const gameKey = mispricing.game.id || `${mispricing.game.awayTeam}-${mispricing.game.homeTeam}`;
      if (!gameMap.has(gameKey)) {
        gameMap.set(gameKey, []);
      }
      gameMap.get(gameKey)!.push(mispricing);
    }

    // Display in the requested format
    let gameIndex = 0;
    for (const [gameKey, gameMispricings] of gameMap.entries()) {
      if (gameMispricings.length === 0) continue;
      
      gameIndex++;
      const firstMispricing = gameMispricings[0];
      const gameLabel = `${firstMispricing.game.awayTeam} @ ${firstMispricing.game.homeTeam}`;
      
      // Format scheduled time
      const scheduledDate = new Date(firstMispricing.game.scheduledTime);
      const scheduledStr = scheduledDate.toISOString().replace(/\.\d{3}Z$/, 'Z');
      
      // Format status
      const status = firstMispricing.game.status || 'STATUS_UNKNOWN';
      const statusStr = status.toUpperCase().replace(/\s+/g, '_');
      
      // Display game header with clear team names
      const awayTeam = firstMispricing.game.awayTeam;
      const homeTeam = firstMispricing.game.homeTeam;
      const sportEmoji = sport === 'nba' ? '🏀' : sport === 'nfl' ? '🏈' : sport === 'nhl' ? '🏒' : '';
      console.log(`${colors.bright}${colors.yellow}[${gameIndex}]${colors.reset} ${sportEmoji} ${colors.bright}${colors.cyan}${awayTeam}${colors.reset} ${colors.gray}@${colors.reset} ${colors.bright}${colors.magenta}${homeTeam}${colors.reset}`);
      console.log(`${colors.gray}    Game ID:${colors.reset} ${firstMispricing.game.id || gameKey}`);
      console.log(`${colors.gray}    Scheduled:${colors.reset} ${scheduledStr}`);
      console.log(`${colors.gray}    Status:${colors.reset} ${statusStr}`);
      console.log('');

      // Show each team's mispricing
      for (const mispricing of gameMispricings) {
        const team = mispricing.side === 'home' ? mispricing.game.homeTeam : mispricing.game.awayTeam;
        const opponent = mispricing.side === 'home' ? mispricing.game.awayTeam : mispricing.game.homeTeam;
        const side = mispricing.side.toUpperCase();
        const teamColor = mispricing.side === 'home' ? colors.magenta : colors.cyan;
        const kalshiPct = (mispricing.kalshiImpliedProbability * 100).toFixed(2);
        const espnPct = (mispricing.sportsbookImpliedProbability * 100).toFixed(2);
        const diffPct = mispricing.differencePct.toFixed(2);
        const diffAbs = (mispricing.difference * 100).toFixed(2);
        const espnOddsStr = mispricing.sportsbookOdds > 0 ? `+${mispricing.sportsbookOdds}` : `${mispricing.sportsbookOdds}`;
        
        // Find matching position by ticker - need to find the market ticker for this mispricing
        // Match by game teams and side
        let positionInfo = '';
        const mispricingMarket = kalshiMarkets.find(m => {
          const gameMatch = (m.game.awayTeam === mispricing.game.awayTeam && 
                           m.game.homeTeam === mispricing.game.homeTeam) ||
                          (m.game.awayTeam === mispricing.game.homeTeam && 
                           m.game.homeTeam === mispricing.game.awayTeam);
          return gameMatch && m.side === mispricing.side;
        });
        
        if (mispricingMarket && mispricingMarket.ticker) {
          const positions = positionsByTicker.get(mispricingMarket.ticker) || [];
          // Show any position on this market (YES or NO)
          // For this mispricing (which is for a team winning), YES = team wins, NO = team loses
          if (positions.length > 0) {
            // Find YES position first (most relevant for team winning), otherwise show any position
            let position = positions.find(p => p.market_result === 'yes');
            if (!position) {
              position = positions[0]; // Show any position if no YES found
            }
            
            if (position) {
              const posSide = position.market_result === 'yes' ? 'YES' : 'NO';
              const posCount = position.position || 0;
              const posColor = posCount > 0 ? colors.green : colors.gray;
              // Calculate payout for YES position (each contract pays $1 if it wins)
              // For NO positions, payout would be different, but we'll show it anyway
              const payout = posSide === 'YES' && posCount > 0 ? posCount * 1.00 : 0;
              const payoutText = payout > 0 ? ` (Payout: $${payout.toFixed(2)})` : '';
              positionInfo = ` | ${colors.bright}${colors.cyan}Active Position:${colors.reset} ${posColor}${posCount} ${posSide}${payoutText}${colors.reset}`;
            }
          }
        }
        
        // Display team name more prominently with opponent context
        console.log(`    ${colors.bright}${teamColor}${team}${colors.reset} ${colors.gray}(${side})${colors.reset} ${colors.gray}vs ${opponent}${colors.reset}${positionInfo}`);
        console.log(`      ${colors.gray}Kalshi Price:${colors.reset} ${mispricing.kalshiPrice} → ${kalshiPct}% implied probability`);
        console.log(`      ${colors.gray}ESPN Odds:${colors.reset} ${espnOddsStr} → ${espnPct}% implied probability`);
        console.log(`      ${colors.gray}Difference:${colors.reset} ${diffPct} percentage points (${diffAbs}% absolute)`);
        
        if (mispricing.isKalshiOvervaluing) {
          console.log(`      ${colors.yellow}💰 OPPORTUNITY:${colors.reset} Kalshi overvalues ${team} - bet against on Kalshi`);
        } else {
          console.log(`      ${colors.green}💰 OPPORTUNITY:${colors.reset} Kalshi undervalues ${team} - bet on Kalshi`);
        }
        console.log('');
      }
    }
  } catch (error: any) {
    // Silently continue - don't log errors
  }
}

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

function formatBalance(balance: number): string {
  const color = balance > 0 ? colors.green : colors.red;
  return `${colors.bright}${color}💰 Kalshi Balance: $${balance.toFixed(2)}${colors.reset}`;
}

function formatPnl(pnl: number): string {
  const color = pnl >= 0 ? colors.green : colors.red;
  const sign = pnl >= 0 ? '+' : '';
  return `${color}${sign}$${Math.abs(pnl).toFixed(2)}${colors.reset}`;
}

function parseTicker(ticker: string): { sport: string; teams: string; side: string } | null {
  // Format: KXNBAGAME-25NOV26MINOKC-OKC or KXNFLGAME-25NOV30LACAR-LA or KXNHLGAME-25NOV30TORMTL-TOR
  const match = ticker.match(/^(KXNBA|KXNFL|KXNHL)GAME-(\d+)([A-Z]+)-([A-Z]+)$/);
  if (!match) return null;
  
  const sportPrefix = match[1];
  const sport = sportPrefix === 'KXNBA' ? 'NBA' : sportPrefix === 'KXNFL' ? 'NFL' : 'NHL';
  const combined = match[3];
  const side = match[4];
  
  // Try to extract team names (simplified - would need full team mapping for accuracy)
  return { sport, teams: combined, side };
}

function parseTickerToGame(ticker: string): { awayTeam: string; homeTeam: string; teamSide: string; sport: string } | null {
  // Format: KXNFLGAME-25NOV30LACAR-LA or KXNHLGAME-25NOV30TORMTL-TOR
  // combined = LACAR (LAR + CAR), side = LA (which is LAR)
  const match = ticker.match(/^(KXNBA|KXNFL|KXNHL)GAME-(\d+)([A-Z]+)-([A-Z]+)$/);
  if (!match) return null;
  
  const sportPrefix = match[1];
  const sport = sportPrefix === 'KXNBA' ? 'NBA' : sportPrefix === 'KXNFL' ? 'NFL' : 'NHL';
  const combined = match[3];
  const sideAbbrev = match[4];
  
  // Team abbreviation maps
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
  
  const teamAbbrevMap = sport === 'NFL' ? nflTeamAbbrevMap : sport === 'NHL' ? nhlTeamAbbrevMap : nbaTeamAbbrevMap;
  
  // Handle partial abbreviations
  const partialToFull: { [key: string]: string } = sport === 'NFL' ? {
    'LA': 'LAR', // Los Angeles Rams
  } : sport === 'NHL' ? {
    'LA': 'LAK', // Los Angeles Kings
    'SJ': 'SJS', // San Jose Sharks
    'NJ': 'NJD', // New Jersey Devils
    'TB': 'TBL', // Tampa Bay Lightning
  } : {};
  
  const fullSideAbbrev = partialToFull[sideAbbrev] || sideAbbrev;
  
  // Try to split combined abbreviations
  const possibleSplits = [[3, 3], [3, 4], [4, 3], [3, 2], [2, 3], [4, 4], [2, 4], [4, 2]];
  
  let awayTeam: string | null = null;
  let homeTeam: string | null = null;
  
  for (const [len1, len2] of possibleSplits) {
    if (combined.length >= len1 + len2) {
      const abbrev1 = combined.substring(0, len1);
      const abbrev2 = combined.substring(len1, len1 + len2);
      
      let abbrev1Full = teamAbbrevMap[abbrev1];
      let abbrev2Full = teamAbbrevMap[abbrev2];
      
      // Try partial mapping
      if (!abbrev1Full && partialToFull[abbrev1]) {
        abbrev1Full = teamAbbrevMap[partialToFull[abbrev1]];
      }
      if (!abbrev2Full && partialToFull[abbrev2]) {
        abbrev2Full = teamAbbrevMap[partialToFull[abbrev2]];
      }
      
      // Check prefix matches
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
        // Determine which is home/away based on which matches the side abbreviation
        if (abbrev1Full === fullSideAbbrev || abbrev1 === sideAbbrev || abbrev1Full.startsWith(sideAbbrev)) {
          homeTeam = abbrev1Full;
          awayTeam = abbrev2Full;
        } else if (abbrev2Full === fullSideAbbrev || abbrev2 === sideAbbrev || abbrev2Full.startsWith(sideAbbrev)) {
          homeTeam = abbrev2Full;
          awayTeam = abbrev1Full;
        } else {
          // Default: first is away, second is home
          awayTeam = abbrev1Full;
          homeTeam = abbrev2Full;
        }
        break;
      }
    }
  }
  
  // Special case for LAARI
  if (!awayTeam && combined === 'LAARI' && sport === 'NFL') {
    awayTeam = 'LAR';
    homeTeam = 'ARI';
  }
  
  if (!awayTeam || !homeTeam) {
    return null;
  }
  
  return { awayTeam, homeTeam, teamSide: fullSideAbbrev, sport };
}

async function displayAccountInfo(): Promise<void> {
  const kalshiClient = new KalshiClient();
  
  // Get balance
  const balance = await kalshiClient.getBalance();
  if (balance !== null) {
    console.log(formatBalance(balance));
  }
  
  // Get active positions
  const positions = await kalshiClient.getActivePositions();
  if (positions.length > 0) {
    console.log(`\n${colors.bright}${colors.cyan}📊 Active Positions (${positions.length}):${colors.reset}`);
    positions.forEach((pos, idx) => {
      const side = pos.market_result === 'yes' ? 'YES' : 'NO';
      const positionCount = pos.position || 0;
      
      // Try to get cost - use total_cost if available, otherwise use estimated_value
      let totalCost = 0;
      let costLabel = '';
      if (pos.total_cost && pos.total_cost > 0) {
        totalCost = pos.total_cost / 100; // Convert from cents to dollars
        costLabel = `${colors.gray}$${totalCost.toFixed(2)}${colors.reset}`;
      } else if (pos.estimated_value && pos.estimated_value > 0) {
        totalCost = pos.estimated_value / 100; // Convert from cents to dollars
        costLabel = `${colors.yellow}~$${totalCost.toFixed(2)}${colors.reset} ${colors.gray}(est)${colors.reset}`;
      } else {
        costLabel = `${colors.gray}N/A${colors.reset}`;
      }
      
      const realizedPnl = pos.realized_pnl ? (pos.realized_pnl / 100) : 0;
      
      // Parse ticker to get game info
      const gameInfo = pos.ticker ? parseTickerToGame(pos.ticker) : null;
      const sportEmoji = gameInfo?.sport === 'NBA' ? '🏀' : gameInfo?.sport === 'NFL' ? '🏈' : gameInfo?.sport === 'NHL' ? '🏒' : '';
      
      // Display match in readable format
      let matchDisplay = pos.ticker || 'N/A';
      let teamDisplay = '';
      if (gameInfo) {
        matchDisplay = `${gameInfo.awayTeam} @ ${gameInfo.homeTeam}`;
        // Determine which team this position is on
        const isHomeTeam = gameInfo.teamSide === gameInfo.homeTeam || 
                          gameInfo.homeTeam.startsWith(gameInfo.teamSide) ||
                          gameInfo.teamSide.startsWith(gameInfo.homeTeam);
        const teamName = isHomeTeam ? gameInfo.homeTeam : gameInfo.awayTeam;
        const teamSideLabel = isHomeTeam ? 'HOME' : 'AWAY';
        teamDisplay = ` | ${colors.bright}${teamName}${colors.reset} (${teamSideLabel})`;
      }
      
      // Color code the side
      const sideColor = side === 'YES' ? colors.green : colors.red;
      const sideLabel = `${sideColor}${side}${colors.reset}`;
      
      // Format position count with color
      const positionColor = positionCount > 0 ? colors.cyan : colors.gray;
      const positionLabel = `${positionColor}${positionCount}${colors.reset}`;
      
      // Format P&L with color
      const pnlLabel = formatPnl(realizedPnl);
      
      // Calculate potential payout if position wins
      let payoutInfo = '';
      if (pos.current_price !== undefined && positionCount > 0) {
        // Payout = position_count * 100 (if it wins, each contract pays $1 = 100 cents)
        const payout = positionCount * 100; // in cents
        const payoutDollars = payout / 100;
        payoutInfo = ` | ${colors.gray}Payout:${colors.reset} ${colors.green}$${payoutDollars.toFixed(2)}${colors.reset}`;
      }
      
      // Show current price if available
      let priceInfo = '';
      if (pos.current_price !== undefined) {
        priceInfo = ` | ${colors.gray}Price:${colors.reset} ${colors.cyan}${pos.current_price.toFixed(1)}${colors.reset}`;
      }
      
      // Display with better formatting
      console.log(`  ${colors.bright}${idx + 1}.${colors.reset} ${sportEmoji} ${colors.bright}${colors.yellow}${matchDisplay}${colors.reset}${teamDisplay}`);
      console.log(`     ${colors.gray}Side:${colors.reset} ${sideLabel} | ${colors.gray}Position:${colors.reset} ${positionLabel} | ${colors.gray}Cost:${colors.reset} ${costLabel}${priceInfo}${payoutInfo} | ${colors.gray}P&L:${colors.reset} ${pnlLabel}`);
    });
  } else {
    console.log(`\n${colors.bright}${colors.cyan}📊 Active Positions:${colors.reset} ${colors.gray}None${colors.reset}`);
  }
  
  // Get active orders
  const orders = await kalshiClient.getActiveOrders();
  if (orders.length > 0) {
    console.log(`\n${colors.bright}${colors.magenta}📋 Active Orders (${orders.length}):${colors.reset}`);
    orders.forEach((order, idx) => {
      const side = order.side === 'yes' ? 'YES' : 'NO';
      const action = order.action === 'buy' ? 'BUY' : 'SELL';
      const price = order.yes_price !== undefined ? order.yes_price : order.no_price || 0;
      const remaining = order.remaining_count || 0;
      const status = order.status || 'unknown';
      
      // Color code action
      const actionColor = action === 'BUY' ? colors.green : colors.red;
      const actionLabel = `${actionColor}${action}${colors.reset}`;
      
      // Color code side
      const sideColor = side === 'YES' ? colors.green : colors.red;
      const sideLabel = `${sideColor}${side}${colors.reset}`;
      
      // Color code status
      const statusColor = status === 'resting' ? colors.yellow : status === 'pending' ? colors.blue : colors.gray;
      const statusLabel = `${statusColor}${status}${colors.reset}`;
      
      console.log(`  ${colors.bright}${idx + 1}.${colors.reset} ${colors.yellow}${order.ticker || 'N/A'}${colors.reset} - ${actionLabel} ${sideLabel} @ ${colors.cyan}${price}${colors.reset} | ${colors.gray}Remaining:${colors.reset} ${remaining} | ${colors.gray}Status:${colors.reset} ${statusLabel}`);
    });
  } else {
    console.log(`\n${colors.bright}${colors.magenta}📋 Active Orders:${colors.reset} ${colors.gray}None${colors.reset}`);
  }
  console.log('');
}

async function runMispricingCheck(): Promise<void> {
  // Display account info first and get active positions
  const kalshiClient = new KalshiClient();
  const activePositions = await kalshiClient.getActivePositions();
  
  // Display account info
  await displayAccountInfo();
  
  // Run checks for NBA, NFL, and NHL, passing active positions
  await runMispricingCheckForSport('nba', activePositions);
  await runMispricingCheckForSport('nfl', activePositions);
  await runMispricingCheckForSport('nhl', activePositions);
}

// Main execution
async function main(): Promise<void> {
  // Run once immediately
  await runMispricingCheck();

  // Schedule recurring runs if cron expression is provided
  if (config.bot.runScheduleCron) {
    cron.schedule(config.bot.runScheduleCron, async () => {
      await runMispricingCheck();
    });
  } else {
    process.exit(0);
  }
}

// Handle errors and graceful shutdown
process.on('unhandledRejection', (error: Error) => {
  process.exit(1);
});

process.on('SIGINT', () => {
  process.exit(0);
});

// Start the bot
main().catch((error) => {
  process.exit(1);
});