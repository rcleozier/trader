const { ethers } = require('ethers');
const config = require('../config');
const logger = require('../utils/logger');

class KashiService {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.kashi.rpcUrl);
    this.wallet = new ethers.Wallet(config.kashi.privateKey, this.provider);
    this.contractAddress = config.kashi.contractAddress;
    
    // Kashi ABI - you'll need to update this with the actual Kashi contract ABI
    this.abi = [
      "function createMarket(string memory description, uint256 endTime, uint256[] memory outcomes) external",
      "function placeBet(uint256 marketId, uint256 outcome, uint256 amount) external",
      "function getMarket(uint256 marketId) external view returns (tuple(string description, uint256 endTime, uint256[] outcomes, bool resolved))",
      "function getOutcomeOdds(uint256 marketId, uint256 outcome) external view returns (uint256)",
      "function resolveMarket(uint256 marketId, uint256 winningOutcome) external",
      "function getMarketCount() external view returns (uint256)",
      "event MarketCreated(uint256 indexed marketId, string description, uint256 endTime)",
      "event BetPlaced(uint256 indexed marketId, address indexed user, uint256 outcome, uint256 amount)",
      "event MarketResolved(uint256 indexed marketId, uint256 winningOutcome)"
    ];
    
    this.contract = new ethers.Contract(this.contractAddress, this.abi, this.wallet);
  }

  /**
   * Create a new market for an NBA game
   */
  async createMarket(description, endTime, outcomes) {
    try {
      if (config.bot.dryRun) {
        logger.info(`[DRY RUN] Would create market: ${description}`);
        return { success: true, marketId: Math.floor(Math.random() * 1000) };
      }

      const tx = await this.contract.createMarket(description, endTime, outcomes);
      const receipt = await tx.wait();
      
      logger.info(`Market created with tx hash: ${receipt.hash}`);
      
      // Extract market ID from event logs
      const event = receipt.logs.find(log => {
        try {
          const parsed = this.contract.interface.parseLog(log);
          return parsed.name === 'MarketCreated';
        } catch {
          return false;
        }
      });
      
      if (event) {
        const parsed = this.contract.interface.parseLog(event);
        return { success: true, marketId: parsed.args.marketId.toString() };
      }
      
      return { success: true, marketId: null };
    } catch (error) {
      logger.error('Error creating market:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Place a bet on a market
   */
  async placeBet(marketId, outcome, amount) {
    try {
      if (config.bot.dryRun) {
        logger.info(`[DRY RUN] Would place bet: Market ${marketId}, Outcome ${outcome}, Amount ${amount}`);
        return { success: true, txHash: 'dry-run-tx' };
      }

      const tx = await this.contract.placeBet(marketId, outcome, ethers.parseEther(amount.toString()));
      const receipt = await tx.wait();
      
      logger.info(`Bet placed with tx hash: ${receipt.hash}`);
      return { success: true, txHash: receipt.hash };
    } catch (error) {
      logger.error('Error placing bet:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get market details
   */
  async getMarket(marketId) {
    try {
      const market = await this.contract.getMarket(marketId);
      return {
        description: market[0],
        endTime: market[1].toString(),
        outcomes: market[2].map(outcome => outcome.toString()),
        resolved: market[3],
      };
    } catch (error) {
      logger.error(`Error fetching market ${marketId}:`, error.message);
      return null;
    }
  }

  /**
   * Get odds for a specific outcome
   */
  async getOutcomeOdds(marketId, outcome) {
    try {
      const odds = await this.contract.getOutcomeOdds(marketId, outcome);
      return ethers.formatEther(odds);
    } catch (error) {
      logger.error(`Error fetching odds for market ${marketId}, outcome ${outcome}:`, error.message);
      return null;
    }
  }

  /**
   * Resolve a market
   */
  async resolveMarket(marketId, winningOutcome) {
    try {
      if (config.bot.dryRun) {
        logger.info(`[DRY RUN] Would resolve market ${marketId} with winning outcome ${winningOutcome}`);
        return { success: true, txHash: 'dry-run-tx' };
      }

      const tx = await this.contract.resolveMarket(marketId, winningOutcome);
      const receipt = await tx.wait();
      
      logger.info(`Market resolved with tx hash: ${receipt.hash}`);
      return { success: true, txHash: receipt.hash };
    } catch (error) {
      logger.error('Error resolving market:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get total number of markets
   */
  async getMarketCount() {
    try {
      const count = await this.contract.getMarketCount();
      return count.toString();
    } catch (error) {
      logger.error('Error fetching market count:', error.message);
      return '0';
    }
  }

  /**
   * Check if wallet has sufficient balance
   */
  async getBalance() {
    try {
      const balance = await this.provider.getBalance(this.wallet.address);
      return ethers.formatEther(balance);
    } catch (error) {
      logger.error('Error fetching balance:', error.message);
      return '0';
    }
  }

  /**
   * Listen for market events
   */
  startEventListener() {
    this.contract.on('MarketCreated', (marketId, description, endTime, event) => {
      logger.info(`New market created: ${marketId} - ${description}`);
    });

    this.contract.on('BetPlaced', (marketId, user, outcome, amount, event) => {
      logger.info(`Bet placed: Market ${marketId}, User ${user}, Outcome ${outcome}, Amount ${ethers.formatEther(amount)}`);
    });

    this.contract.on('MarketResolved', (marketId, winningOutcome, event) => {
      logger.info(`Market resolved: ${marketId}, Winning outcome: ${winningOutcome}`);
    });
  }
}

module.exports = KashiService;

