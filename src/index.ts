import cron from 'node-cron';
import { KalshiClient } from './clients/kalshiClient';
import { ESPNClient } from './clients/espnClient';
import { MispricingService } from './services/mispricingService';
import { TradingService } from './services/tradingService';
import { RiskService } from './services/riskService';
import { PositionManager } from './services/positionManager';
import { Mispricing, Market } from './types/markets';
import { parseTicker, parseTickerToGame } from './lib/ticker';

// Minimal type for games data (PDF generation disabled)
type GameSideData = {
  team: string;
  side: string;
  kalshiPrice: number;
  kalshiProb: number;
  espnOdds: number;
  espnProb: number;
  diffPct: number;
  isOverThreshold: boolean;
  isKalshiOvervaluing: boolean;
  hasPosition: boolean;
  positionCount?: number;
  positionSide?: string;
  positionPayout?: number;
};

type GameData = {
  sport: string;
  gameId: string;
  awayTeam: string;
  homeTeam: string;
  scheduledTime: string;
  status: string;
  sides: GameSideData[];
};
import { config } from './config';

async function runMispricingCheckForSport(sport: 'nba' | 'nfl' | 'nhl' | 'ncaab' | 'ncaaf', activePositions: any[] = [], activeOrders: any[] = [], tradingService?: TradingService, balance?: number | null, riskService?: RiskService): Promise<GameData[]> {
  const sportConfig = config.sports[sport];
  const sportName = sport.toUpperCase();
  const sportEmoji = sport === 'nba' ? '🏀' : sport === 'nfl' ? '🏈' : sport === 'nhl' ? '🏒' : sport === 'ncaab' ? '🏀' : sport === 'ncaaf' ? '🏈' : '';

  try {
    // Fetch data from both sources
    const kalshiClient = new KalshiClient();
    const kalshiMarkets = await kalshiClient.fetchMarkets(sportConfig.kalshiSeries, sport);
    console.log(`\n${sportEmoji} ${colors.bright}${colors.cyan}${sportName}${colors.reset}: Found ${colors.yellow}${kalshiMarkets.length}${colors.reset} Kalshi markets`);
    
    const espnClient = new ESPNClient();
    const espnOdds = await espnClient.fetchGamesWithOdds(sportConfig.espnPath);
    console.log(`${sportEmoji} ${colors.bright}${colors.cyan}${sportName}${colors.reset}: Found ${colors.yellow}${espnOdds.length}${colors.reset} ESPN games with odds`);

    // Find mispricings and comparisons (primary strategy only)
    const mispricingService = new MispricingService();
    const { mispricings, comparisons } = mispricingService.findMispricings(kalshiMarkets, espnOdds);
    console.log(`${sportEmoji} ${colors.bright}${colors.cyan}${sportName}${colors.reset}: Found ${colors.yellow}${comparisons.length}${colors.reset} games with comparison data`);

    // --- Tiered trading strategy orchestration ---
    if (tradingService && balance !== null && balance !== undefined) {
      // Primary: pure(ish) arbitrage across this sport's markets
      const arbBundles = tradingService.findArbitrageBundles(kalshiMarkets);
      if (arbBundles.length > 0) {
        console.log(
          `${sportEmoji} ${colors.bright}${colors.green}Arbitrage bundles found:${colors.reset} ${arbBundles.length}`
        );
        for (const bundle of arbBundles) {
          const shouldTrade = await tradingService.shouldPlaceTrade(balance);
          if (!shouldTrade) break;

          // Construct synthetic mispricing objects for each leg so we can
          // reuse the core order placement / sizing logic.
          const base: Omit<Mispricing, 'side' | 'kalshiPrice' | 'kalshiImpliedProbability'> = {
            game: bundle.game,
            sportsbookOdds: 0,
            sportsbookImpliedProbability: bundle.totalProb,
            difference: (1 - bundle.totalProb),
            differencePct: bundle.edgePct,
          };

          const homeMispricing: Mispricing = {
            ...base,
            side: 'home',
            kalshiPrice: bundle.home.price,
            kalshiImpliedProbability: bundle.home.impliedProbability,
            sportsbookImpliedProbability: bundle.totalProb / 2,
          } as Mispricing;

          const awayMispricing: Mispricing = {
            ...base,
            side: 'away',
            kalshiPrice: bundle.away.price,
            kalshiImpliedProbability: bundle.away.impliedProbability,
            sportsbookImpliedProbability: bundle.totalProb / 2,
          } as Mispricing;

          // Allocate half of desired capital to each leg; the per-strategy and
          // per-market caps in TradingService will enforce strict limits.
          const perLegStake = (config.trading.maxBetSize || 5) / 2;

          // Risk checks before placing trades
          if (riskService) {
            const homeCheck = riskService.canPlaceTrade(
              perLegStake,
              balance || 0,
              activePositions.length,
              activeOrders
            );
            if (!homeCheck.allowed) {
              console.log(`[RISK] Skipping arbitrage: ${homeCheck.reason}`);
              continue;
            }
            if (!riskService.checkMaxPositionsPerMarket(bundle.home.ticker, activePositions)) {
              console.log(`[RISK] Max positions per market reached for ${bundle.home.ticker}`);
              continue;
            }
          }

          const homeResult = await tradingService.placeTrade(
            'arbitrage',
            homeMispricing,
            bundle.home.ticker,
            activePositions,
            activeOrders,
            perLegStake,
            `YES+NO=${bundle.totalProb.toFixed(2)} arb (edge ${bundle.edgePct.toFixed(2)}pp)`
          );
          
          if (homeResult.success && riskService) {
            riskService.recordTrade(perLegStake);
          }

          if (riskService) {
            const awayCheck = riskService.canPlaceTrade(
              perLegStake,
              balance || 0,
              activePositions.length,
              activeOrders
            );
            if (!awayCheck.allowed) {
              console.log(`[RISK] Skipping arbitrage: ${awayCheck.reason}`);
              continue;
            }
            if (!riskService.checkMaxPositionsPerMarket(bundle.away.ticker, activePositions)) {
              console.log(`[RISK] Max positions per market reached for ${bundle.away.ticker}`);
              continue;
            }
          }

          const awayResult = await tradingService.placeTrade(
            'arbitrage',
            awayMispricing,
            bundle.away.ticker,
            activePositions,
            activeOrders,
            perLegStake,
            `YES+NO=${bundle.totalProb.toFixed(2)} arb (edge ${bundle.edgePct.toFixed(2)}pp)`
          );

          if (awayResult.success && riskService) {
            riskService.recordTrade(perLegStake);
          }

          if (homeResult.success && awayResult.success) {
            console.log(
              `${colors.green}✅ Executed arbitrage bundle on game ${bundle.game.awayTeam}@${bundle.game.homeTeam}${colors.reset}`
            );
          }
        }
      }

      // Secondary: spread farming at probability extremes if no arbitrage bundles
      if (!tradingService.findArbitrageBundles(kalshiMarkets).length) {
        const spreadCandidates = tradingService.findSpreadExtremes(kalshiMarkets);
        if (spreadCandidates.length > 0) {
          console.log(
            `${sportEmoji} ${colors.bright}${colors.yellow}Spread-farming candidates:${colors.reset} ${spreadCandidates.length}`
          );
          for (const mkt of spreadCandidates) {
            const shouldTrade = await tradingService.shouldPlaceTrade(balance);
            if (!shouldTrade) break;

            const implied = mkt.impliedProbability;
            const syntheticMispricing: Mispricing = {
              game: mkt.game,
              side: mkt.side,
              kalshiPrice: mkt.price,
              kalshiImpliedProbability: implied,
              sportsbookOdds: 0,
              sportsbookImpliedProbability: implied,
              difference: 0,
              differencePct: Math.abs(implied - 0.5) * 100,
              isKalshiOvervaluing: implied > 0.5,
            };

            // Use a smaller sizing than arbitrage (half of maxBetSize or $2 fallback)
            const stake = (config.trading.maxBetSize || 4) / 2;

            await tradingService.placeTrade(
              'spread',
              syntheticMispricing,
              mkt.ticker,
              activePositions,
              activeOrders,
              stake,
              syntheticMispricing.kalshiImpliedProbability <= 0.15
                ? 'prob<=0.15 extreme'
                : 'prob>=0.85 extreme'
            );
          }
        }
      }
    }
    
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

    // Collect games data for PDF report
    const gamesData: GameData[] = [];
    
    // Display all games with comparison data
    let gameIndex = 0;
    for (const comparison of comparisons) {
      // Only show games that have at least one side with both Kalshi and ESPN data
      if (!comparison.home.kalshi && !comparison.home.espn && !comparison.away.kalshi && !comparison.away.espn) {
        continue;
      }
      if (!comparison.home.kalshi && !comparison.away.kalshi) {
        continue; // Need at least one Kalshi market
      }
      if (!comparison.home.espn && !comparison.away.espn) {
        continue; // Need at least one ESPN odds
      }
      
      gameIndex++;
      
      // Format scheduled time
      const scheduledDate = new Date(comparison.game.scheduledTime);
      const scheduledStr = scheduledDate.toISOString().replace(/\.\d{3}Z$/, 'Z');
      
      // Format status
      const status = comparison.game.status || 'STATUS_UNKNOWN';
      const statusStr = status.toUpperCase().replace(/\s+/g, '_');
      
      // Display game header with clear team names
      const awayTeam = comparison.game.awayTeam;
      const homeTeam = comparison.game.homeTeam;
      const sportEmoji = sport === 'nba' ? '🏀' : sport === 'nfl' ? '🏈' : sport === 'nhl' ? '🏒' : sport === 'ncaab' ? '🏀' : sport === 'ncaaf' ? '🏈' : '';
      console.log(`\n${sportEmoji} ${colors.bright}${colors.yellow}[${gameIndex}]${colors.reset} ${colors.bright}${colors.cyan}${awayTeam}${colors.reset} ${colors.gray}@${colors.reset} ${colors.bright}${colors.magenta}${homeTeam}${colors.reset}`);
      console.log(`${colors.gray}    Game ID:${colors.reset} ${comparison.game.id}`);
      console.log(`${colors.gray}    Scheduled:${colors.reset} ${scheduledStr}`);
      console.log(`${colors.gray}    Status:${colors.reset} ${statusStr}`);
      console.log('');

      // Collect sides data for PDF
      const sidesData: GameSideData[] = [];
      
      // Show each team's comparison data
      const sidesToShow = [
        { side: 'away', team: awayTeam, opponent: homeTeam, data: comparison.away },
        { side: 'home', team: homeTeam, opponent: awayTeam, data: comparison.home },
      ];

      for (const { side, team, opponent, data } of sidesToShow) {
        // Only show if we have both Kalshi and ESPN data
        if (!data.kalshi || !data.espn) continue;
        const sideLabel = side.toUpperCase();
        const teamColor = side === 'home' ? colors.magenta : colors.cyan;
        const kalshiPct = (data.kalshi.prob * 100).toFixed(2);
        const espnPct = (data.espn.prob * 100).toFixed(2);
        const diffPct = data.diffPct ? data.diffPct.toFixed(2) : '0.00';
        const diffAbs = data.diff ? (data.diff * 100).toFixed(2) : '0.00';
        const espnOddsStr = data.espn.odds > 0 ? `+${data.espn.odds}` : `${data.espn.odds}`;
        const isOverThreshold = data.isOverThreshold || false;
        const isKalshiOvervaluing = data.kalshi.prob > data.espn.prob;
        
        // Find matching position by checking all positions for this game and team
        let positionInfo = '';
        const targetTeam = team;
        
        // Find all positions that match this game
        const matchingPositions: any[] = [];
        for (const [ticker, posArray] of positionsByTicker.entries()) {
          const tickerGameInfo = parseTickerToGame(ticker);
          if (tickerGameInfo) {
            // Check if this is the same game
            const isSameGame = (tickerGameInfo.awayTeam === comparison.game.awayTeam && 
                               tickerGameInfo.homeTeam === comparison.game.homeTeam) ||
                              (tickerGameInfo.awayTeam === comparison.game.homeTeam && 
                               tickerGameInfo.homeTeam === comparison.game.awayTeam);
            
            if (isSameGame) {
              // Check if this ticker is for the target team
              const tickerTeam = tickerGameInfo.teamSide;
              const isTargetTeam = tickerTeam === targetTeam || 
                                   targetTeam.startsWith(tickerTeam) || 
                                   tickerTeam.startsWith(targetTeam);
              
              if (isTargetTeam) {
                matchingPositions.push(...posArray);
              }
            }
          }
        }
        
        // Also try exact ticker match from market
        const market = kalshiMarkets.find(m => {
          const gameMatch = (m.game.awayTeam === comparison.game.awayTeam && 
                           m.game.homeTeam === comparison.game.homeTeam) ||
                          (m.game.awayTeam === comparison.game.homeTeam && 
                           m.game.homeTeam === comparison.game.awayTeam);
          return gameMatch && m.side === side;
        });
        
        if (market && market.ticker) {
          const exactTickerPositions = positionsByTicker.get(market.ticker) || [];
          matchingPositions.push(...exactTickerPositions);
        }
        
        // Remove duplicates
        const uniquePositions = Array.from(new Map(matchingPositions.map(p => [p.ticker + (p.market_result || ''), p])).values());
        
        let hasPosition = false;
        let positionCount = 0;
        let positionSide = '';
        let positionPayout = 0;
        
        if (uniquePositions.length > 0) {
          // Prioritize YES positions
          let position = uniquePositions.find(p => p.market_result === 'yes');
          if (!position) {
            position = uniquePositions[0];
          }
          
          if (position) {
            hasPosition = true;
            const posSide = position.market_result === 'yes' ? 'YES' : 'NO';
            positionCount = position.position || 0;
            const posColor = positionCount > 0 ? colors.green : colors.gray;
            positionPayout = posSide === 'YES' && positionCount > 0 ? positionCount * 1.00 : 0;
            const payoutText = positionPayout > 0 ? ` (Payout: $${positionPayout.toFixed(2)})` : '';
            positionInfo = ` | ${colors.bright}${colors.cyan}Active Position:${colors.reset} ${posColor}${positionCount} ${posSide}${payoutText}${colors.reset}`;
            positionSide = posSide;
          }
        }
        
        // Add to PDF data
        sidesData.push({
          team,
          side: sideLabel,
          kalshiPrice: data.kalshi.price,
          kalshiProb: data.kalshi.prob,
          espnOdds: data.espn.odds,
          espnProb: data.espn.prob,
          diffPct: data.diffPct || 0,
          isOverThreshold: isOverThreshold,
          isKalshiOvervaluing: isKalshiOvervaluing,
          hasPosition,
          positionCount,
          positionSide,
          positionPayout,
        });
        
        // Display team name with comparison data
        const thresholdIndicator = isOverThreshold ? `${colors.yellow}⚠️ ABOVE THRESHOLD${colors.reset}` : `${colors.gray}Below threshold${colors.reset}`;
        console.log(`    ${colors.bright}${teamColor}${team}${colors.reset} ${colors.gray}(${sideLabel})${colors.reset} ${colors.gray}vs ${opponent}${colors.reset}${positionInfo}`);
        console.log(`      ${colors.gray}Kalshi Price:${colors.reset} ${data.kalshi.price} → ${kalshiPct}% implied probability`);
        console.log(`      ${colors.gray}ESPN Odds:${colors.reset} ${espnOddsStr} → ${espnPct}% implied probability`);
        console.log(`      ${colors.gray}Difference:${colors.reset} ${diffPct} percentage points (${diffAbs}% absolute) ${thresholdIndicator}`);
        
        if (isOverThreshold) {
          if (isKalshiOvervaluing) {
            console.log(`      ${colors.yellow}💰 OPPORTUNITY:${colors.reset} Kalshi overvalues ${team} - bet against on Kalshi`);
          } else {
            console.log(`      ${colors.green}💰 OPPORTUNITY:${colors.reset} Kalshi undervalues ${team} - bet on Kalshi`);
          }
          
          // Attempt to place trade if trading is enabled
          if (tradingService && market) {
            // Check if we should place trade
            const shouldTrade = await tradingService.shouldPlaceTrade(balance || null);
            if (shouldTrade) {
              // Create a mispricing object for the trading service
              const mispricingForTrade: any = {
                game: comparison.game,
                side: side,
                kalshiPrice: data.kalshi.price,
                kalshiImpliedProbability: data.kalshi.prob,
                sportsbookOdds: data.espn.odds,
                sportsbookImpliedProbability: data.espn.prob,
                difference: data.diff || 0,
                differencePct: data.diffPct || 0,
                isKalshiOvervaluing: isKalshiOvervaluing,
              };
              const rationale = `ESPN edge ${diffPct}pp (${kalshiPct}% vs ${espnPct}%)`;
              
              // Risk checks
              const estimatedNotional = config.trading.maxBetSize || data.diffPct || 5;
              if (riskService) {
                const riskCheck = riskService.canPlaceTrade(
                  estimatedNotional,
                  balance || 0,
                  activePositions.length,
                  activeOrders
                );
                if (!riskCheck.allowed) {
                  console.log(`      [RISK] Skipping mispricing: ${riskCheck.reason}`);
                  continue;
                }
                if (!riskService.checkMaxPositionsPerMarket(market.ticker, activePositions)) {
                  console.log(`      [RISK] Max positions per market reached for ${market.ticker}`);
                  continue;
                }
              }
              
              const tradeResult = await tradingService.placeTrade(
                'mispricing',
                mispricingForTrade,
                market.ticker,
                activePositions,
                activeOrders,
                undefined,
                rationale
              );
              if (tradeResult.success) {
                if (riskService) {
                  riskService.recordTrade(estimatedNotional);
                }
                console.log(`      ${colors.green}✅ Trade placed: ${tradeResult.orderId || 'Order ID pending'}${colors.reset}`);
              } else if (tradeResult.error !== 'Existing position found' && tradeResult.error !== 'Pending order found') {
                // Only show error if it's not about existing position or pending order (those are expected)
                console.log(`      ${colors.red}❌ Trade failed: ${tradeResult.error}${colors.reset}`);
              }
            }
          }
        }
        console.log('');
      }
      
      // Add game to PDF data
      if (sidesData.length > 0) {
        gamesData.push({
          sport: sportName,
          gameId: comparison.game.id,
          awayTeam,
          homeTeam,
          scheduledTime: comparison.game.scheduledTime,
          status: statusStr,
          sides: sidesData,
        });
      }
    }
    
    if (comparisons.length === 0) {
      console.log(`${sportEmoji} ${colors.bright}${colors.cyan}${sportName}${colors.reset}: ${colors.gray}No games with both Kalshi and ESPN data found${colors.reset}`);
    }
    
    return gamesData;
  } catch (error: any) {
    console.error(`${sportEmoji} ${colors.bright}${colors.red}${sportName} Error:${colors.reset} ${error.message}`);
    if (error.stack) {
      console.error(`${colors.gray}${error.stack}${colors.reset}`);
    }
    return [];
  }
}

/**
 * Spread-farming-only runner for additional series where we don't
 * have external odds (e.g. Chinese basketball KXCBAGAME).
 */
async function runSpreadFarmingForSeries(
  seriesTicker: string,
  sport: 'nba' | 'nfl' | 'nhl' | 'ncaab' | 'ncaaf' | 'cba' | 'nbl' | 'euro',
  label: string,
  emoji: string,
  activePositions: any[],
  activeOrders: any[],
  tradingService?: TradingService,
  balance?: number | null,
  riskService?: RiskService
): Promise<void> {
  if (!tradingService || balance == null) return;

  try {
    const kalshiClient = new KalshiClient();
    const markets: Market[] = await kalshiClient.fetchMarkets(seriesTicker, sport);
    console.log(
      `\n${emoji} ${colors.bright}${colors.cyan}${label}${colors.reset}: Found ${colors.yellow}${markets.length}${colors.reset} Kalshi markets (spread farming only)`
    );

    // Enforce global cap on open spread-farming positions
    const maxOpen = config.trading.maxOpenSpreadPositions;
    const openCount = tradingService.getOpenSpreadPositionsCount(activePositions);
    if (maxOpen !== undefined && openCount >= maxOpen) {
      console.log(
        `${emoji} ${colors.bright}${colors.cyan}${label}${colors.reset}: ` +
          `${colors.gray}Spread-farming paused (open positions ${openCount}/${maxOpen})${colors.reset}`
      );
      return;
    }

    // Check reserve cash requirement for spread farming
    if (balance !== null && balance !== undefined) {
      const reserveCash = config.risk.spreadReserveCash;
      const reserveCashPct = config.risk.spreadReserveCashPct;
      let requiredReserve = 0;
      if (reserveCash !== undefined) {
        requiredReserve = reserveCash;
      } else if (reserveCashPct !== undefined) {
        requiredReserve = balance * (reserveCashPct / 100);
      }
      if (balance < requiredReserve) {
        console.log(
          `${emoji} ${colors.bright}${colors.cyan}${label}${colors.reset}: ` +
            `${colors.gray}Spread-farming paused (balance $${balance.toFixed(2)} < reserve $${requiredReserve.toFixed(2)})${colors.reset}`
        );
        return;
      }
    }

    const spreadCandidates = tradingService.findSpreadExtremes(markets);
    if (spreadCandidates.length === 0) {
      console.log(
        `${emoji} ${colors.bright}${colors.cyan}${label}${colors.reset}: ${colors.gray}No extreme spread candidates found${colors.reset}`
      );
      return;
    }

    console.log(
      `${emoji} ${colors.bright}${colors.yellow}Spread-farming candidates (${label}):${colors.reset} ${spreadCandidates.length}`
    );

    for (const mkt of spreadCandidates) {
      const shouldTrade = await tradingService.shouldPlaceTrade(balance);
      if (!shouldTrade) break;

      const implied = mkt.impliedProbability;
      const syntheticMispricing: Mispricing = {
        game: mkt.game,
        side: mkt.side,
        kalshiPrice: mkt.price,
        kalshiImpliedProbability: implied,
        sportsbookOdds: 0,
        sportsbookImpliedProbability: implied,
        difference: 0,
        differencePct: Math.abs(implied - 0.5) * 100,
        isKalshiOvervaluing: implied > 0.5,
      };

      // Use smaller sizing for spread farming; per-strategy caps still apply.
      const stake = (config.trading.maxBetSize || 4) / 2;

      // Risk checks
      if (riskService) {
        const riskCheck = riskService.canPlaceTrade(
          stake,
          balance || 0,
          activePositions.length,
          activeOrders
        );
        if (!riskCheck.allowed) {
          console.log(`  [RISK] Skipping spread: ${riskCheck.reason}`);
          continue;
        }
        if (!riskService.checkMaxPositionsPerMarket(mkt.ticker, activePositions)) {
          console.log(`  [RISK] Max positions per market reached for ${mkt.ticker}`);
          continue;
        }
      }

      await tradingService.placeTrade(
        'spread',
        syntheticMispricing,
        mkt.ticker,
        activePositions,
        activeOrders,
        stake,
        syntheticMispricing.kalshiImpliedProbability <= 0.15
          ? 'prob<=0.15 extreme'
          : 'prob>=0.85 extreme'
      );

      if (riskService) {
        riskService.recordTrade(stake);
      }
    }
  } catch (error: any) {
    console.error(
      `${emoji} ${colors.bright}${colors.red}${label} spread farming error:${colors.reset} ${error.message}`
    );
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
      const sportEmoji = gameInfo?.sport === 'NBA' ? '🏀' : gameInfo?.sport === 'NFL' ? '🏈' : gameInfo?.sport === 'NHL' ? '🏒' : gameInfo?.sport === 'NCAAB' ? '🏀' : gameInfo?.sport === 'NCAAF' ? '🏈' : '';
      
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
      let priceText = '';
      if (pos.current_price !== undefined) {
        priceText = ` @ ${colors.cyan}${pos.current_price.toFixed(1)}¢${colors.reset}`;
      }
      
      // Human-friendly single-line summary
      const positionWord = positionCount < 0 ? 'Short' : 'Long';
      const absCount = Math.abs(positionCount);
      const contractsText = `${absCount} contract${absCount === 1 ? '' : 's'}`;
      
      console.log(`  ${colors.bright}${idx + 1}.${colors.reset} ${sportEmoji} ${colors.bright}${colors.yellow}${matchDisplay}${colors.reset}${teamDisplay}`);
      console.log(
        `     ${positionColor}${positionWord} ${contractsText}${colors.reset} ` +
        `on ${sideLabel}${priceText} ` +
        `| ${colors.gray}Cost${colors.reset} ${costLabel}${payoutInfo} ` +
        `| ${colors.gray}Realized P&L${colors.reset} ${pnlLabel}`
      );
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

// Exported so it can be re-used by other entrypoints (e.g. Vercel cron)
export async function runMispricingCheck(): Promise<void> {
  // Display account info first and get active positions and orders
  const kalshiClient = new KalshiClient();
  const balance = await kalshiClient.getBalance();
  const activePositions = await kalshiClient.getActivePositions();
  const activeOrders = await kalshiClient.getActiveOrders();
  
  // Log active orders count for debugging
  if (activeOrders.length > 0) {
    console.log(`\n${colors.bright}${colors.cyan}📋 Found ${activeOrders.length} active orders${colors.reset}`);
    activeOrders.forEach((order, idx) => {
      console.log(`  ${idx + 1}. ${order.ticker} - ${order.side} ${order.action} ${order.remaining_count || 0} (status: ${order.status})`);
    });
  }
  
  // Display account info
  await displayAccountInfo();
  
  // Initialize services
  const riskService = new RiskService();
  let tradingService: TradingService | undefined;
  let positionManager: PositionManager | undefined;
  
  if (config.trading) {
    // Use the same KalshiClient instance to access PortfolioApi, MarketsApi and refresh orders
    tradingService = new TradingService(kalshiClient.portfolioApi, kalshiClient.marketsApi, config.trading, kalshiClient);
    positionManager = new PositionManager(
      kalshiClient.portfolioApi,
      kalshiClient.marketsApi,
      kalshiClient
    );
    
    if (config.trading.liveTrades) {
      console.log(`\n${colors.bright}${colors.yellow}⚠️  LIVE TRADING ENABLED${colors.reset}`);
    } else {
      console.log(`\n${colors.bright}${colors.gray}DRY RUN MODE - No actual trades will be placed${colors.reset}`);
    }
  }

  // Print daily risk stats
  const dailyStats = riskService.getDailyStats();
  if (dailyStats) {
    console.log(`\n${colors.bright}${colors.cyan}📊 Daily Stats:${colors.reset}`);
    console.log(`  Trades: ${dailyStats.tradesCount}${config.risk.maxDailyTrades ? `/${config.risk.maxDailyTrades}` : ''}`);
    console.log(`  Notional: $${dailyStats.notionalSpent.toFixed(2)}${config.risk.maxDailyNotional ? `/$${config.risk.maxDailyNotional.toFixed(2)}` : ''}`);
    console.log(`  Realized P&L: ${dailyStats.realizedPnl >= 0 ? colors.green : colors.red}$${dailyStats.realizedPnl.toFixed(2)}${colors.reset}${config.risk.maxDailyLoss ? ` (limit: -$${config.risk.maxDailyLoss.toFixed(2)})` : ''}`);
  }

  // CRITICAL: Manage positions FIRST (exits before entries)
  if (positionManager && activePositions.length > 0) {
    console.log(`\n${colors.bright}${colors.cyan}🔄 Managing ${activePositions.length} open positions...${colors.reset}`);
    const managedCount = await positionManager.managePositions(activePositions, activeOrders);
    if (managedCount > 0) {
      console.log(`  ${colors.green}✅ Evaluated ${managedCount} positions for exit${colors.reset}`);
    }
    // Refresh positions/orders after exits
    const refreshedPositions = await kalshiClient.getActivePositions();
    const refreshedOrders = await kalshiClient.getActiveOrders();
    Object.assign(activePositions, refreshedPositions);
    Object.assign(activeOrders, refreshedOrders);
  }

  // Before opening any new positions, enforce spread-farming max hold time exits
  if (tradingService) {
    await tradingService.enforceSpreadMaxHoldTime(activePositions, activeOrders);
  }
  
  // Run checks for all sports, passing active positions, orders, trading service, and risk service
  // Run mispricing strategy only (arbitrage and spread farming disabled)
  await runMispricingCheckForSport('nba', activePositions, activeOrders, tradingService, balance, riskService);
  await runMispricingCheckForSport('nfl', activePositions, activeOrders, tradingService, balance, riskService);
  await runMispricingCheckForSport('nhl', activePositions, activeOrders, tradingService, balance, riskService);
  await runMispricingCheckForSport('ncaab', activePositions, activeOrders, tradingService, balance, riskService);
  await runMispricingCheckForSport('ncaaf', activePositions, activeOrders, tradingService, balance, riskService);

  // Spread farming disabled - was causing losses
  // await runSpreadFarmingForSeries(...)
}

// Main execution for CLI usage only
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

// Only attach process handlers and start the bot when this file
// is executed directly (e.g. "node dist/index.js"), not when imported.
if (require.main === module) {
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
}