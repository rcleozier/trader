import { PortfolioApi, MarketsApi } from 'kalshi-typescript';
import { config } from '../config';
import { Mispricing, Market, Game } from '../types/markets';
import { KalshiClient } from '../clients/kalshiClient';
import { parseTickerToGame } from '../lib/ticker';

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
};

type StrategyName = 'arbitrage' | 'spread' | 'mispricing';

export interface TradingConfig {
  liveTrades: boolean;
  minBalanceToBet: number;
  maxBetSize?: number;
  // Optional capital controls (all in dollars)
  maxPerMarket?: number;
  maxPerStrategyArbitrage?: number;
  maxPerStrategySpread?: number;
  maxPerStrategyMispricing?: number;
   maxHoldTimeHours?: number;
   maxOpenSpreadPositions?: number;
}

export class TradingService {
  private portfolioApi: PortfolioApi;
  private marketsApi: MarketsApi;
  private tradingConfig: TradingConfig;
  private kalshiClient?: KalshiClient;
  /**
   * In-memory set of games we've already traded in this process run.
   * Prevents placing trades on both sides of the same game within a single run,
   * even before the new positions appear in the API responses.
   */
  private tradedGameKeys: Set<string> = new Set();

  /**
   * Per-strategy capital usage for the current process run (in dollars).
   * This resets whenever the process restarts (e.g. each cron invocation).
   */
  private strategyCapitalUsed: Record<StrategyName, number> = {
    arbitrage: 0,
    spread: 0,
    mispricing: 0,
  };

  constructor(portfolioApi: PortfolioApi, marketsApi: MarketsApi, tradingConfig: TradingConfig, kalshiClient?: KalshiClient) {
    this.portfolioApi = portfolioApi;
    this.marketsApi = marketsApi;
    this.tradingConfig = tradingConfig;
    this.kalshiClient = kalshiClient;
  }

  private getStrategyLimit(strategy: StrategyName): number | undefined {
    switch (strategy) {
      case 'arbitrage':
        return this.tradingConfig.maxPerStrategyArbitrage;
      case 'spread':
        return this.tradingConfig.maxPerStrategySpread;
      case 'mispricing':
        return this.tradingConfig.maxPerStrategyMispricing;
      default:
        return undefined;
    }
  }

  private getRemainingStrategyCapital(strategy: StrategyName): number {
    const limit = this.getStrategyLimit(strategy);
    if (limit === undefined) return Number.POSITIVE_INFINITY;
    return Math.max(0, limit - this.strategyCapitalUsed[strategy]);
  }

  private registerStrategySpend(strategy: StrategyName, amountDollars: number): void {
    if (!Number.isFinite(amountDollars) || amountDollars <= 0) return;
    this.strategyCapitalUsed[strategy] += amountDollars;
  }

  private isSpreadMarketTicker(ticker: string): boolean {
    if (!ticker) return false;
    const upper = ticker.toUpperCase();
    return (
      upper.startsWith('KXCBAGAME') ||
      upper.startsWith('KXNBLGAME') ||
      upper.startsWith('KXEUROLEAGUEGAME')
    );
  }

  getOpenSpreadPositionsCount(activePositions: any[]): number {
    if (!activePositions || activePositions.length === 0) return 0;
    return activePositions.filter(
      (p) =>
        p &&
        p.ticker &&
        this.isSpreadMarketTicker(p.ticker) &&
        (p.position || 0) !== 0
    ).length;
  }

  /**
   * Normalize a ticker into a game key.
   * Primary method: use the core part of the Kalshi ticker (date + teams),
   * which is shared by both sides of the same game regardless of prefix/sport.
   * Fallback: derive from parsed away/home team names.
   */
  private getGameKeyFromTicker(ticker: string): string | null {
    if (!ticker) return null;

    // Example: KXNFLGAME-25NOV30ARITB-TB or KXNCAAFGAME-25NOV29VANTENN-TENN
    // Core "game id" is the middle segment (25NOV30ARITB / 25NOV29VANTENN)
    const coreMatch = ticker.match(/^[A-Z]+GAME-([A-Z0-9]+)-[A-Z0-9]+$/);
    if (coreMatch) {
      return coreMatch[1];
    }

    // Fallback: use parsed teams if regex didn't match
    const game = parseTickerToGame(ticker);
    if (!game) return null;
    const teams = [game.awayTeam, game.homeTeam].sort();
    return `${teams[0]}-${teams[1]}`;
  }

  /**
   * Determine if two tickers belong to the same underlying game (regardless of side).
   */
  private isSameGameTicker(tickerA: string, tickerB: string): boolean {
    const keyA = this.getGameKeyFromTicker(tickerA);
    const keyB = this.getGameKeyFromTicker(tickerB);
    return !!keyA && !!keyB && keyA === keyB;
  }

  /**
   * Find an existing position for this market *or the same game* (any side).
   * Returns the position object if found, otherwise null.
   */
  private findExistingPositionForMarket(marketTicker: string, activePositions: any[]): any | null {
    if (!activePositions || activePositions.length === 0) return null;

    const position = activePositions.find(pos => {
      if (!pos || !pos.ticker) return false;
      const posCount = pos.position || 0;
      if (posCount === 0) return false;

      // Same exact market
      if (pos.ticker === marketTicker) return true;

      // Different ticker but same underlying game (e.g. opposite team)
      return this.isSameGameTicker(pos.ticker, marketTicker);
    });

    return position || null;
  }

  /**
   * Check if there's an existing position for a market ticker or the same game.
   */
  hasExistingPosition(marketTicker: string, activePositions: any[]): boolean {
    return !!this.findExistingPositionForMarket(marketTicker, activePositions);
  }

  /**
   * Check if there's a pending/resting order for a market ticker
   * Checks for ANY order on this market, regardless of side or status
   */
  hasPendingOrder(marketTicker: string, activeOrders: any[]): boolean {
    // Check for any order on this market ticker with remaining count > 0
    const matchingOrders = activeOrders.filter(
      order => {
        const tickerMatch =
          order.ticker === marketTicker ||
          this.isSameGameTicker(order.ticker, marketTicker);
        const hasStatus = order.status === 'resting' || order.status === 'pending' || order.status === 'executed';
        const hasRemaining = order.remaining_count && order.remaining_count > 0;
        return tickerMatch && hasStatus && hasRemaining;
      }
    );
    
    if (matchingOrders.length > 0) {
      // Log details for debugging
      matchingOrders.forEach(order => {
        console.log(`[TRADING] Found existing order: ${order.ticker} - ${order.side} ${order.action} ${order.remaining_count} @ ${order.yes_price || order.no_price} (status: ${order.status})`);
      });
      return true;
    }
    
    return false;
  }

  /**
   * Core order placement used by all strategies.
   * - Applies per-market and per-strategy capital caps.
   * - Ensures we don't double-enter the same game.
   * - Logs which strategy triggered the trade.
   */
  async placeTrade(
    strategy: StrategyName,
    mispricing: Mispricing,
    marketTicker: string,
    activePositions: any[] = [],
    activeOrders: any[] = [],
    desiredStakeDollars?: number
  ): Promise<{ success: boolean; orderId?: string; error?: string }> {
    // First, block if we've already traded this game in this run
    const gameKey = this.getGameKeyFromTicker(marketTicker);
    if (gameKey && this.tradedGameKeys.has(gameKey)) {
      console.log(`[TRADING] Skipping trade - already traded game ${gameKey} earlier in this run (ticker: ${marketTicker})`);
      return { success: false, error: 'Game already traded in this run' };
    }

    // Refresh active orders right before checking to catch any recently placed orders
    let currentActiveOrders = activeOrders;
    if (this.kalshiClient) {
      try {
        const refreshedOrders = await this.kalshiClient.getActiveOrders();
        currentActiveOrders = refreshedOrders;
        // Log if we found new orders
        if (refreshedOrders.length > activeOrders.length) {
          console.log(`[TRADING] Refreshed orders: found ${refreshedOrders.length} active orders (was ${activeOrders.length})`);
        }
      } catch (error: any) {
        // If refresh fails, use the original list
        console.log(`[TRADING] Warning: Could not refresh orders, using cached list: ${error.message}`);
      }
    }

    // Check if we already have a position on this market or the same game
    const existingPosition = this.findExistingPositionForMarket(marketTicker, activePositions);
    if (existingPosition) {
      const posCount = existingPosition.position || 0;
      const existingTicker = existingPosition.ticker || marketTicker;
      console.log(`[TRADING] Skipping trade - already have position: ${posCount} contracts on ${existingTicker} (same game as ${marketTicker})`);
      return { success: false, error: 'Existing position found' };
    }

    // Check if there's already a pending/resting order for this market (using refreshed list)
    if (this.hasPendingOrder(marketTicker, currentActiveOrders)) {
      const existingOrders = currentActiveOrders.filter(
        order => order.ticker === marketTicker && 
                 (order.status === 'resting' || order.status === 'pending') &&
                 order.remaining_count && order.remaining_count > 0
      );
      const totalRemaining = existingOrders.reduce((sum, order) => sum + (order.remaining_count || 0), 0);
      console.log(`[TRADING] Skipping trade - already have ${existingOrders.length} active order(s) with ${totalRemaining} contracts remaining on ${marketTicker}`);
      return { success: false, error: 'Pending order found' };
    }

    // Determine if we should buy YES or NO (mispricing direction)
    // If Kalshi undervalues (Kalshi prob < ESPN prob), buy YES on Kalshi
    // If Kalshi overvalues (Kalshi prob > ESPN prob), buy NO on Kalshi
    const side = mispricing.isKalshiOvervaluing ? 'no' : 'yes';
    
    // Fetch current market data to get the ask price (so order executes immediately)
    let buyPrice: number;
    try {
      // Get the current market to fetch ask prices
      const marketResponse = await this.marketsApi.getMarkets(
        1, // limit
        undefined, // cursor
        undefined, // eventTicker
        undefined, // seriesTicker
        undefined, // maxCloseTs
        undefined, // minCloseTs
        undefined, // status
        marketTicker // tickers - get this specific market (single ticker string)
      );
      
      const market = marketResponse.data?.markets?.[0];
      if (market) {
        // Use ask price for immediate execution
        if (side === 'yes') {
          // For YES, use yes_ask if available, otherwise yes_bid, otherwise last_price
          buyPrice = market.yes_ask !== undefined && market.yes_ask !== null
            ? market.yes_ask
            : market.yes_bid !== undefined && market.yes_bid !== null
            ? market.yes_bid
            : market.last_price !== undefined && market.last_price !== null
            ? market.last_price
            : mispricing.kalshiPrice;
        } else {
          // For NO, use no_ask if available, otherwise calculate from yes_ask/bid
          if (market.no_ask !== undefined && market.no_ask !== null) {
            buyPrice = market.no_ask;
          } else if (market.no_bid !== undefined && market.no_bid !== null) {
            buyPrice = market.no_bid;
          } else if (market.yes_ask !== undefined && market.yes_ask !== null) {
            // NO price = 100 - YES price
            buyPrice = 100 - market.yes_ask;
          } else if (market.yes_bid !== undefined && market.yes_bid !== null) {
            buyPrice = 100 - market.yes_bid;
          } else if (market.last_price !== undefined && market.last_price !== null) {
            buyPrice = 100 - market.last_price;
          } else {
            buyPrice = 100 - mispricing.kalshiPrice;
          }
        }
        console.log(`  Market ask price: ${buyPrice.toFixed(1)} cents (${side === 'yes' ? 'YES' : 'NO'})`);
      } else {
        // Fallback to using mispricing price if market not found
        buyPrice = side === 'yes' ? mispricing.kalshiPrice : (100 - mispricing.kalshiPrice);
        console.log(`  Warning: Could not fetch market data, using cached price: ${buyPrice.toFixed(1)} cents`);
      }
    } catch (error: any) {
      // Fallback to using mispricing price if fetch fails
      buyPrice = side === 'yes' ? mispricing.kalshiPrice : (100 - mispricing.kalshiPrice);
      console.log(`  Warning: Could not fetch ask price, using cached price: ${buyPrice.toFixed(1)} cents (${error.message})`);
    }
    
    // Base bet size for this opportunity.
    // Priority:
    // 1) Caller-provided desiredStakeDollars (e.g. arbitrage bundle sizing)
    // 2) Configured maxBetSize
    // 3) Default: $1 per percentage point of edge
    let betSizeDollars =
      desiredStakeDollars ??
      (this.tradingConfig.maxBetSize ?? mispricing.differencePct);

    // Ensure minimum bet size (Kalshi minimum is typically $1)
    betSizeDollars = Math.max(betSizeDollars, 1);

    // Apply per-market cap if configured
    if (this.tradingConfig.maxPerMarket !== undefined) {
      betSizeDollars = Math.min(betSizeDollars, this.tradingConfig.maxPerMarket);
    }

    // Apply per-strategy remaining capital cap
    const remainingForStrategy = this.getRemainingStrategyCapital(strategy);
    betSizeDollars = Math.min(betSizeDollars, remainingForStrategy);

    if (betSizeDollars < 1) {
      console.log(
        `[TRADING] Skipping trade for ${marketTicker} via ${strategy} - not enough remaining strategy capital.`
      );
      return { success: false, error: 'Strategy capital exhausted' };
    }

    // Calculate number of contracts based on desired dollar amount and price
    // Cost per contract = price / 100 dollars
    // Number of contracts = betSizeDollars / (price / 100) = betSizeDollars * 100 / price
    const costPerContract = buyPrice / 100; // in dollars
    const contractCount = Math.floor(betSizeDollars / costPerContract);
    
    // Ensure minimum of 1 contract
    const finalContractCount = Math.max(contractCount, 1);
    const actualBetSizeDollars = (finalContractCount * costPerContract).toFixed(2);
    
    // Always log trade details (even in dry run mode)
    const tradeMode = this.tradingConfig.liveTrades ? 'LIVE' : 'DRY RUN';
    console.log(`\n[TRADING - ${tradeMode}] Strategy: ${strategy.toUpperCase()}`);
    console.log(`[TRADING] Would place trade:`);
    console.log(`  Game: ${mispricing.game.awayTeam} @ ${mispricing.game.homeTeam}`);
    console.log(`  Side: ${mispricing.side.toUpperCase()} (${side.toUpperCase()})`);
    console.log(`  Market: ${marketTicker}`);
    console.log(`  Kalshi Price: ${mispricing.kalshiPrice} → ${(mispricing.kalshiImpliedProbability * 100).toFixed(2)}%`);
    console.log(`  ESPN Odds: ${mispricing.sportsbookOdds > 0 ? '+' : ''}${mispricing.sportsbookOdds} → ${(mispricing.sportsbookImpliedProbability * 100).toFixed(2)}%`);
    console.log(`  Difference: ${mispricing.differencePct.toFixed(2)} percentage points`);
    console.log(`  Action: Buy ${side.toUpperCase()} @ ${buyPrice.toFixed(1)} cents`);
    console.log(`  Bet Size: $${actualBetSizeDollars} (${finalContractCount} contracts @ $${costPerContract.toFixed(4)} per contract)`);
    console.log(`  Direction: ${mispricing.isKalshiOvervaluing ? 'Kalshi overvalues - bet NO' : 'Kalshi undervalues - bet YES'}`);

    // Check if live trades are enabled
    if (!this.tradingConfig.liveTrades) {
      console.log(`  Status: ${colors.yellow}DRY RUN - No actual trade placed${colors.reset}`);
      // Register theoretical spend for logging consistency
      this.registerStrategySpend(strategy, parseFloat(actualBetSizeDollars));
      return { success: true, orderId: 'dry-run-order-id' };
    }

    try {
      // Create order request
      // Kalshi uses count in contracts (not cents), and price in cents (0-100)
      // For limit orders, we need to specify yes_price or no_price
      const orderRequest: any = {
        ticker: marketTicker,
        side: side,
        action: 'buy',
        count: finalContractCount, // Number of contracts
        type: 'limit',
        client_order_id: `${strategy}-entry-${Date.now()}`, // Unique client order ID
      };

      // Set price based on side
      if (side === 'yes') {
        orderRequest.yes_price = Math.floor(buyPrice);
      } else {
        orderRequest.no_price = Math.floor(buyPrice);
      }

      console.log(`  Executing: Placing ${side.toUpperCase()} order...`);
      
      const response = await this.portfolioApi.createOrder(orderRequest);
      
      if (response.data?.order) {
        const orderId = response.data.order.order_id;
        console.log(`  ${colors.green}✅ Order placed successfully: ${orderId}${colors.reset}`);
        // Mark this game as traded for the rest of this process run
        if (gameKey) {
          this.tradedGameKeys.add(gameKey);
        }
        // For spread-farming entries, immediately place a take-profit GTC limit order
        if (strategy === 'spread') {
          const entryPrice = Math.floor(buyPrice);
          const tpRaw = Math.min(entryPrice + 4, Math.round(entryPrice * 1.3));
          // Clamp to a valid Kalshi price range
          const targetPrice = Math.max(1, Math.min(99, tpRaw));

          const tpOrder: any = {
            ticker: marketTicker,
            side: side,
            action: 'sell',
            count: finalContractCount,
            type: 'limit',
            client_order_id: `spread-tp-${Date.now()}`,
          };

          if (side === 'yes') {
            tpOrder.yes_price = targetPrice;
          } else {
            tpOrder.no_price = targetPrice;
          }

          try {
            console.log(
              `  Placing spread take-profit order: SELL ${side.toUpperCase()} ${finalContractCount} @ ${targetPrice} cents`
            );
            await this.portfolioApi.createOrder(tpOrder);
          } catch (tpError: any) {
            console.log(
              `  ${colors.yellow}Warning: Failed to place spread take-profit order: ${tpError.message}${colors.reset}`
            );
          }
        }
        // Track capital spent for this strategy
        this.registerStrategySpend(strategy, parseFloat(actualBetSizeDollars));
        return { success: true, orderId };
      } else {
        console.log(`  ${colors.red}❌ No order returned from API${colors.reset}`);
        return { success: false, error: 'No order returned from API' };
      }
    } catch (error: any) {
      console.error(`  ${colors.red}❌ Failed to place order: ${error.message}${colors.reset}`);
      if (error.response?.data) {
        console.error('Error details:', JSON.stringify(error.response.data, null, 2));
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if we should place a trade based on balance and config
   */
  async shouldPlaceTrade(currentBalance: number | null): Promise<boolean> {
    if (!currentBalance) {
      console.log('[TRADING] No balance available, skipping trade');
      return false;
    }

    if (currentBalance < this.tradingConfig.minBalanceToBet) {
      console.log(`[TRADING] Balance ($${currentBalance.toFixed(2)}) below minimum ($${this.tradingConfig.minBalanceToBet}), skipping trade`);
      return false;
    }

    return true;
  }

  /**
   * Enforce maximum hold time on spread-farming positions.
   * If a spread position has been open longer than maxHoldTimeHours,
   * place a best-effort exit order at the current best price.
   */
  async enforceSpreadMaxHoldTime(
    activePositions: any[],
    activeOrders: any[] = []
  ): Promise<void> {
    const hours = this.tradingConfig.maxHoldTimeHours;
    if (!hours || hours <= 0) return;

    const nowSec = Math.floor(Date.now() / 1000);
    const maxAgeSec = hours * 3600;

    for (const pos of activePositions || []) {
      if (!pos || !pos.ticker || (pos.position || 0) === 0) continue;
      if (!this.isSpreadMarketTicker(pos.ticker)) continue;

      // Best-effort: try multiple possible timestamp fields
      const openedTs =
        (typeof pos.open_ts === 'number' && pos.open_ts) ||
        (typeof pos.open_time === 'number' && pos.open_time) ||
        (typeof pos.ts === 'number' && pos.ts) ||
        undefined;

      if (!openedTs) continue;

      const ageSec = nowSec - openedTs;
      if (ageSec < maxAgeSec) continue;

      const openCount = pos.position || 0;
      if (openCount <= 0) continue;

      // Calculate remaining quantity not already covered by resting sell orders
      const restingSells = (activeOrders || []).filter(
        (o: any) =>
          o &&
          o.ticker === pos.ticker &&
          o.action === 'sell' &&
          (o.status === 'resting' || o.status === 'pending') &&
          (o.remaining_count || 0) > 0
      );
      const alreadyOffered = restingSells.reduce(
        (sum: number, o: any) => sum + (o.remaining_count || 0),
        0
      );
      const qtyToExit = openCount - alreadyOffered;
      if (qtyToExit <= 0) continue;

      try {
        const marketResponse = await this.marketsApi.getMarkets(
          1,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'open',
          pos.ticker
        );
        const market = marketResponse.data?.markets?.[0];
        if (!market) continue;

        const isYes = pos.market_result === 'yes';
        let exitPrice: number | null = null;

        if (isYes) {
          exitPrice =
            (market.yes_bid !== undefined && market.yes_bid !== null && market.yes_bid) ||
            (market.last_price !== undefined && market.last_price !== null && market.last_price) ||
            null;
        } else {
          // NO position: use no_bid if available, otherwise derive from yes_ask/bid
          if (market.no_bid !== undefined && market.no_bid !== null) {
            exitPrice = market.no_bid;
          } else if (market.yes_ask !== undefined && market.yes_ask !== null) {
            exitPrice = 100 - market.yes_ask;
          } else if (market.yes_bid !== undefined && market.yes_bid !== null) {
            exitPrice = 100 - market.yes_bid;
          } else if (market.last_price !== undefined && market.last_price !== null) {
            exitPrice = 100 - market.last_price;
          }
        }

        if (exitPrice === null) continue;

        const exitOrder: any = {
          ticker: pos.ticker,
          side: isYes ? 'yes' : 'no',
          action: 'sell',
          count: qtyToExit,
          type: 'limit',
          client_order_id: `spread-ttl-exit-${Date.now()}`,
        };

        if (isYes) {
          exitOrder.yes_price = Math.max(1, Math.min(99, Math.floor(exitPrice)));
        } else {
          exitOrder.no_price = Math.max(1, Math.min(99, Math.floor(exitPrice)));
        }

        console.log(
          `[TRADING] Max hold time reached for spread position ${pos.ticker} (age=${(
            ageSec / 3600
          ).toFixed(2)}h). Placing time-based exit for ${qtyToExit} contracts.`
        );
        await this.portfolioApi.createOrder(exitOrder);
      } catch (error: any) {
        console.log(
          `[TRADING] Warning: Failed to place time-based exit for ${pos.ticker}: ${error.message}`
        );
      }
    }
  }

  /**
   * Primary strategy: search for near risk-free bundles where
   * HOME_YES + AWAY_YES < 1.0 (after buffer) so buying both sides
   * locks in profit regardless of outcome.
   *
   * Note: This is an approximation using game-side markets as proxies
   * for YES/NO; real orderbook-level arbitrage would require per-side
   * bid/ask depth which is not modeled here.
   */
  findArbitrageBundles(markets: Market[], feeBuffer: number = 0.01): Array<{
    game: Game;
    home: Market;
    away: Market;
    totalProb: number;
    edgePct: number;
  }> {
    const byGame = new Map<string, { home?: Market; away?: Market; game: Game }>();

    for (const m of markets) {
      const key = m.gameId;
      if (!byGame.has(key)) {
        byGame.set(key, { game: m.game });
      }
      const entry = byGame.get(key)!;
      if (m.side === 'home') entry.home = m;
      else entry.away = m;
    }

    const bundles: Array<{
      game: Game;
      home: Market;
      away: Market;
      totalProb: number;
      edgePct: number;
    }> = [];

    for (const { game, home, away } of byGame.values()) {
      if (!home || !away) continue;

      const homeProb = home.impliedProbability;
      const awayProb = away.impliedProbability;
      const totalProb = homeProb + awayProb;

      // Arbitrage if probabilities sum to strictly less than 1 minus buffer
      if (totalProb < 1 - feeBuffer) {
        const edge = (1 - feeBuffer - totalProb) * 100;
        bundles.push({
          game,
          home,
          away,
          totalProb,
          edgePct: edge,
        });
      }
    }

    // Highest edge first
    return bundles.sort((a, b) => b.edgePct - a.edgePct);
  }

  /**
   * Secondary strategy: spread farming at probability extremes.
   * YES ≤ 0.15 or YES ≥ 0.85, prefer higher volume/tighter spreads
   * (approximated here by using more extreme probabilities).
   */
  findSpreadExtremes(markets: Market[]): Market[] {
    const EXTREME_LOW = 0.15;
    const EXTREME_HIGH = 0.85;

    const candidates = markets.filter((m) => {
      const p = m.impliedProbability;
      return p <= EXTREME_LOW || p >= EXTREME_HIGH;
    });

    // Prefer more extreme probabilities first (farther from 0.5)
    return candidates.sort((a, b) => {
      const da = Math.abs(a.impliedProbability - 0.5);
      const db = Math.abs(b.impliedProbability - 0.5);
      return db - da;
    });
  }
}

