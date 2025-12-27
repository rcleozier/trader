import fs from 'fs';
import path from 'path';

type StrategyLabel = 'ARBITRAGE' | 'SPREAD_FARM' | 'MISPRICING';

export interface LedgerEntry {
  order_id?: string;
  position_id?: string;
  strategy: StrategyLabel;
  rationale: string;
  created_at: string;
  market_id: string;
  side: 'YES' | 'NO';
  price: number; // cents
  qty: number; // contracts
  expected_edge_pct?: number;
}

const ledgerPath = path.resolve(process.cwd(), 'strategy_ledger.jsonl');

const inMemoryByOrderId = new Map<string, LedgerEntry>();
const inMemoryByPositionId = new Map<string, LedgerEntry>();

export async function appendLedgerEntry(entry: LedgerEntry): Promise<void> {
  const line = JSON.stringify(entry) + '\n';

  try {
    await fs.promises.appendFile(ledgerPath, line, { encoding: 'utf8' });
  } catch {
    // Best-effort only; avoid crashing the bot because of I/O.
  }

  if (entry.order_id) {
    inMemoryByOrderId.set(entry.order_id, entry);
  }
  if (entry.position_id) {
    inMemoryByPositionId.set(entry.position_id, entry);
  }
}

export function getLedgerEntryByOrderId(orderId: string): LedgerEntry | undefined {
  return inMemoryByOrderId.get(orderId);
}

export function getLedgerEntryByPositionId(positionId: string): LedgerEntry | undefined {
  return inMemoryByPositionId.get(positionId);
}



