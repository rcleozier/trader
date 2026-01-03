import { PortfolioApi, MarketsApi } from 'kalshi-typescript';
import { config } from '../config';
import { KalshiClient } from '../clients/kalshiClient';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

interface ExitRule {
  takeProfitCentsPerContract?: number;
  takeProfitPctOfCost?: number;
  maxHoldMinutes?: number;
  stopLossPct?: number;
}

export class PositionManager {
  private portfolioApi: PortfolioApi;
  private marketsApi: MarketsApi;
  private kalshiClient: KalshiClient;
  private exitRules: ExitRule;

  constructor(
    portfolioApi: PortfolioApi,
    marketsApi: MarketsApi,
    kalshiClient: KalshiClient
  ) {
    this.portfolioApi = portfolioApi;
    this.marketsApi = marketsApi;
    this.kalshiClient = kalshiClient;
    this.exitRules = {
      takeProfitCentsPerContract: config.risk.takeProfitCentsPerContract,
      takeProfitPctOfCost: config.risk.takeProfitPctOfCost,
      maxHoldMinutes: config.risk.maxHoldMinutes,
      stopLossPct: config.risk.stopLossPct,
    };
  }

  /**
   * Manage all open positions - check exit conditions and place exit orders
   * Returns number of positions managed
   */
  async managePositions(activePositions: any[], activeOrders: any[]): Promise<number> {
    if (!activePositions || activePositions.length === 0) return 0;

    let managedCount = 0;

    for (const pos of activePositions) {
      if (!pos || !pos.ticker || (pos.position || 0) === 0) continue;

      const exitResult = await this.evaluatePositionExit(pos, activeOrders);
      if (exitResult.shouldExit) {
        await this.placeExitOrder(pos, exitResult.exitPrice, exitResult.reason);
        managedCount++;
      }
    }

    return managedCount;
  }

  private async evaluatePositionExit(
    position: any,
    activeOrders: any[]
  ): Promise<{ shouldExit: boolean; exitPrice?: number; reason?: string }> {
    const positionCount = position.position || 0;
    if (positionCount === 0) return { shouldExit: false };

    // Check if there's already an exit order
    const existingExitOrders = activeOrders.filter(
      (o: any) =>
        o &&
        o.ticker === position.ticker &&
        o.action === 'sell' &&
        (o.status === 'resting' || o.status === 'pending') &&
        (o.remaining_count || 0) > 0
    );
    const alreadyOffered = existingExitOrders.reduce(
      (sum: number, o: any) => sum + (o.remaining_count || 0),
      0
    );
    const qtyToExit = positionCount - alreadyOffered;
    if (qtyToExit <= 0) return { shouldExit: false };

    // Fetch current market prices
    let currentPrice: number | null = null;
    let bestBid: number | null = null;
    let bestAsk: number | null = null;

    try {
      const marketResponse = await this.marketsApi.getMarkets(
        1,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'open',
        position.ticker
      );
      const market = marketResponse.data?.markets?.[0];
      if (!market) return { shouldExit: false };

      const isYesPosition = position.market_result === 'yes';
      if (isYesPosition) {
        bestBid = market.yes_bid !== undefined && market.yes_bid !== null ? market.yes_bid : null;
        bestAsk = market.yes_ask !== undefined && market.yes_ask !== null ? market.yes_ask : null;
        currentPrice = market.last_price !== undefined && market.last_price !== null
          ? market.last_price
          : bestBid;
      } else {
        // NO position: prices are inverted
        const yesBid = market.yes_bid !== undefined && market.yes_bid !== null ? market.yes_bid : null;
        const yesAsk = market.yes_ask !== undefined && market.yes_ask !== null ? market.yes_ask : null;
        bestBid = yesAsk !== null ? 100 - yesAsk : null;
        bestAsk = yesBid !== null ? 100 - yesBid : null;
        const yesPrice = market.last_price !== undefined && market.last_price !== null
          ? market.last_price
          : yesBid;
        currentPrice = yesPrice !== null ? 100 - yesPrice : null;
      }
    } catch (error: any) {
      console.log(`[POSITION_MGR] Could not fetch market for ${position.ticker}: ${error.message}`);
      return { shouldExit: false };
    }

    if (currentPrice === null || bestBid === null) return { shouldExit: false };

    // Calculate entry price and cost
    const entryPrice = position.avg_price !== undefined && position.avg_price !== null
      ? position.avg_price
      : position.total_cost && position.total_cost > 0 && positionCount > 0
      ? position.total_cost / positionCount / 100 // convert cents to price
      : null;

    if (entryPrice === null) return { shouldExit: false };

    const entryPriceCents = Math.round(entryPrice * 100);
    const costPerContract = entryPriceCents;
    const totalCost = costPerContract * positionCount;

    // Calculate unrealized PnL
    const currentValue = currentPrice * positionCount;
    const unrealizedPnl = currentValue - totalCost;
    const unrealizedPnlPct = (unrealizedPnl / totalCost) * 100;

    // Check exit conditions
    const rules = this.exitRules;

    // 1. Take profit: cents per contract
    if (rules.takeProfitCentsPerContract !== undefined) {
      const profitCents = currentPrice - entryPriceCents;
      if (profitCents >= rules.takeProfitCentsPerContract) {
        return {
          shouldExit: true,
          exitPrice: bestBid,
          reason: `TP: +${profitCents.toFixed(1)}¢/contract`,
        };
      }
    }

    // 2. Take profit: percentage of cost
    if (rules.takeProfitPctOfCost !== undefined) {
      if (unrealizedPnlPct >= rules.takeProfitPctOfCost) {
        return {
          shouldExit: true,
          exitPrice: bestBid,
          reason: `TP: +${unrealizedPnlPct.toFixed(2)}% of cost`,
        };
      }
    }

    // 3. Stop loss: percentage
    if (rules.stopLossPct !== undefined) {
      if (unrealizedPnlPct <= -rules.stopLossPct) {
        return {
          shouldExit: true,
          exitPrice: bestBid,
          reason: `SL: ${unrealizedPnlPct.toFixed(2)}% loss`,
        };
      }
    }

    // 4. Max hold time
    if (rules.maxHoldMinutes !== undefined) {
      const openedTs =
        (typeof position.open_ts === 'number' && position.open_ts) ||
        (typeof position.open_time === 'number' && position.open_time) ||
        (typeof position.ts === 'number' && position.ts) ||
        undefined;

      if (openedTs) {
        const nowSec = Math.floor(Date.now() / 1000);
        const ageMinutes = (nowSec - openedTs) / 60;
        if (ageMinutes >= rules.maxHoldMinutes) {
          return {
            shouldExit: true,
            exitPrice: bestBid,
            reason: `Max hold time: ${ageMinutes.toFixed(1)}min`,
          };
        }
      }
    }

    return { shouldExit: false };
  }

  private async placeExitOrder(
    position: any,
    exitPrice: number,
    reason: string
  ): Promise<void> {
    const positionCount = position.position || 0;
    if (positionCount <= 0) return;

    const isYesPosition = position.market_result === 'yes';
    const side = isYesPosition ? 'yes' : 'no';

    // Use best bid, or improve by 1 tick if configured
    let finalPrice = Math.floor(exitPrice);
    if (config.risk.improveExitByOneTick) {
      finalPrice = Math.max(1, finalPrice - 1);
    }
    finalPrice = Math.max(1, Math.min(99, finalPrice));

    const exitOrder: any = {
      ticker: position.ticker,
      side: side,
      action: 'sell',
      count: positionCount,
      type: 'limit',
      client_order_id: `exit-${Date.now()}`,
    };

    if (side === 'yes') {
      exitOrder.yes_price = finalPrice;
    } else {
      exitOrder.no_price = finalPrice;
    }

    try {
      if (config.trading.liveTrades) {
        await this.portfolioApi.createOrder(exitOrder);
        console.log(
          `[POSITION_MGR] ${colors.green}Exit order placed${colors.reset}: ${position.ticker} ` +
            `SELL ${side.toUpperCase()} ${positionCount} @ ${finalPrice}¢ (${reason})`
        );
      } else {
        console.log(
          `[POSITION_MGR] ${colors.yellow}DRY RUN${colors.reset}: Would exit ${position.ticker} ` +
            `SELL ${side.toUpperCase()} ${positionCount} @ ${finalPrice}¢ (${reason})`
        );
      }
    } catch (error: any) {
      console.error(
        `[POSITION_MGR] ${colors.red}Failed to place exit order${colors.reset}: ${error.message}`
      );
    }
  }
}


