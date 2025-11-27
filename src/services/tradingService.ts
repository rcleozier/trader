import { PortfolioApi } from 'kalshi-typescript';
import { config } from '../config';
import { Mispricing } from '../types/markets';

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
};

export interface TradingConfig {
  liveTrades: boolean;
  minBalanceToBet: number;
  maxBetSize?: number;
}

export class TradingService {
  private portfolioApi: PortfolioApi;
  private tradingConfig: TradingConfig;

  constructor(portfolioApi: PortfolioApi, tradingConfig: TradingConfig) {
    this.portfolioApi = portfolioApi;
    this.tradingConfig = tradingConfig;
  }

  /**
   * Check if there's an existing position for a market ticker
   */
  hasExistingPosition(marketTicker: string, activePositions: any[]): boolean {
    const position = activePositions.find(pos => pos.ticker === marketTicker && pos.position && pos.position !== 0);
    return !!position;
  }

  /**
   * Place a buy order for a mispricing opportunity
   */
  async placeTrade(mispricing: Mispricing, marketTicker: string, activePositions: any[] = []): Promise<{ success: boolean; orderId?: string; error?: string }> {
    // Check if we already have a position on this market
    if (this.hasExistingPosition(marketTicker, activePositions)) {
      const existingPosition = activePositions.find(pos => pos.ticker === marketTicker && pos.position && pos.position !== 0);
      const posCount = existingPosition?.position || 0;
      console.log(`[TRADING] Skipping trade - already have position: ${posCount} contracts on ${marketTicker}`);
      return { success: false, error: 'Existing position found' };
    }

    // Determine if we should buy YES or NO
    // If Kalshi undervalues (Kalshi prob < ESPN prob), buy YES on Kalshi
    // If Kalshi overvalues (Kalshi prob > ESPN prob), buy NO on Kalshi
    const side = mispricing.isKalshiOvervaluing ? 'no' : 'yes';
    
    // Get current market price for the side we want to buy
    // For YES: use yes_price or last_price
    // For NO: use no_price or (100 - yes_price)
    const buyPrice = side === 'yes' ? mispricing.kalshiPrice : (100 - mispricing.kalshiPrice);
    
    // Calculate bet size in dollars based on MAX_BET_SIZE
    // Scale with mispricing size: larger mispricings get larger bets
    let betSizeDollars = 0;
    if (this.tradingConfig.maxBetSize) {
      // Use a percentage of max bet size based on mispricing size
      const mispricingSize = mispricing.differencePct;
      const betPercentage = Math.min(mispricingSize / 10, 1); // Scale with mispricing, max 100%
      betSizeDollars = this.tradingConfig.maxBetSize * betPercentage;
    } else {
      // Default: $1 per percentage point of mispricing if MAX_BET_SIZE not set
      betSizeDollars = mispricing.differencePct;
    }

    // Ensure minimum bet size (Kalshi minimum is typically $1)
    betSizeDollars = Math.max(betSizeDollars, 1);

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
    console.log(`\n[TRADING - ${tradeMode}] Would place trade:`);
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
        client_order_id: `mispricing-${Date.now()}`, // Unique client order ID
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
}

