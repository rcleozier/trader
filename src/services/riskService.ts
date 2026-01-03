import { config } from '../config';
import * as fs from 'fs';
import * as path from 'path';

interface DailyStats {
  date: string; // YYYY-MM-DD
  tradesCount: number;
  notionalSpent: number; // dollars
  realizedPnl: number; // dollars
  startBalance: number;
  endBalance: number;
}

const statsFilePath = path.resolve(process.cwd(), 'daily_stats.json');

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

function loadDailyStats(): DailyStats | null {
  try {
    if (!fs.existsSync(statsFilePath)) return null;
    const data = fs.readFileSync(statsFilePath, 'utf8');
    const stats = JSON.parse(data);
    const today = getTodayDate();
    if (stats.date === today) {
      return stats;
    }
    return null; // Different day, reset
  } catch {
    return null;
  }
}

function saveDailyStats(stats: DailyStats): void {
  try {
    fs.writeFileSync(statsFilePath, JSON.stringify(stats, null, 2), 'utf8');
  } catch (error: any) {
    console.error(`[RISK] Failed to save daily stats: ${error.message}`);
  }
}

export class RiskService {
  private dailyStats: DailyStats | null = null;

  constructor() {
    this.dailyStats = loadDailyStats();
    if (!this.dailyStats) {
      this.dailyStats = {
        date: getTodayDate(),
        tradesCount: 0,
        notionalSpent: 0,
        realizedPnl: 0,
        startBalance: 0,
        endBalance: 0,
      };
    }
  }

  /**
   * Check if we can place a new trade based on hard risk limits
   */
  canPlaceTrade(
    orderNotional: number,
    currentBalance: number,
    totalPositions: number,
    activeOrders: any[]
  ): { allowed: boolean; reason?: string } {
    const riskConfig = config.risk;

    // Max positions total
    if (riskConfig.maxPositionsTotal !== undefined) {
      if (totalPositions >= riskConfig.maxPositionsTotal) {
        return {
          allowed: false,
          reason: `Max positions limit reached (${totalPositions}/${riskConfig.maxPositionsTotal})`,
        };
      }
    }

    // Max order notional
    if (riskConfig.maxOrderNotional !== undefined) {
      if (orderNotional > riskConfig.maxOrderNotional) {
        return {
          allowed: false,
          reason: `Order notional ($${orderNotional.toFixed(2)}) exceeds max ($${riskConfig.maxOrderNotional})`,
        };
      }
    }

    // Max daily trades
    if (riskConfig.maxDailyTrades !== undefined) {
      if (this.dailyStats!.tradesCount >= riskConfig.maxDailyTrades) {
        return {
          allowed: false,
          reason: `Max daily trades reached (${this.dailyStats!.tradesCount}/${riskConfig.maxDailyTrades})`,
        };
      }
    }

    // Max daily notional
    if (riskConfig.maxDailyNotional !== undefined) {
      const projectedDaily = this.dailyStats!.notionalSpent + orderNotional;
      if (projectedDaily > riskConfig.maxDailyNotional) {
        return {
          allowed: false,
          reason: `Daily notional would exceed limit ($${projectedDaily.toFixed(2)}/${riskConfig.maxDailyNotional})`,
        };
      }
    }

    // Max daily loss (check realized PnL)
    if (riskConfig.maxDailyLoss !== undefined) {
      if (this.dailyStats!.realizedPnl <= -riskConfig.maxDailyLoss) {
        return {
          allowed: false,
          reason: `Daily loss limit reached ($${Math.abs(this.dailyStats!.realizedPnl).toFixed(2)})`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Record a trade execution
   */
  recordTrade(notional: number): void {
    if (!this.dailyStats) return;
    this.dailyStats.tradesCount++;
    this.dailyStats.notionalSpent += notional;
    saveDailyStats(this.dailyStats);
  }

  /**
   * Update realized PnL (call when positions close)
   */
  updateRealizedPnl(pnl: number): void {
    if (!this.dailyStats) return;
    this.dailyStats.realizedPnl += pnl;
    saveDailyStats(this.dailyStats);
  }

  /**
   * Get current daily stats
   */
  getDailyStats(): DailyStats | null {
    return this.dailyStats;
  }

  /**
   * Check max positions per market
   */
  checkMaxPositionsPerMarket(marketTicker: string, activePositions: any[]): boolean {
    const riskConfig = config.risk;
    if (riskConfig.maxPositionsPerMarket === undefined) return true;

    const positionsOnMarket = activePositions.filter(
      (p) => p && p.ticker === marketTicker && (p.position || 0) !== 0
    ).length;

    return positionsOnMarket < riskConfig.maxPositionsPerMarket;
  }
}


