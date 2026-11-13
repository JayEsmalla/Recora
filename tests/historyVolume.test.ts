import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/data/database/migrations';
import { HistoryRepository } from '../src/history/HistoryRepository';
import { HistoryService } from '../src/history/HistoryService';
import { NormalizationService } from '../src/history/NormalizationService';
import { createSqlJsConnection, type SqlJsConnection } from './helpers/SqlJsConnection';

describe('large local purchase history', () => {
  let database: SqlJsConnection;
  let history: HistoryRepository;

  beforeEach(async () => {
    database = await createSqlJsConnection();
    await migrateDatabase(database);
    history = new HistoryRepository(database);

    // Generate a substantial realistic relational fixture within SQLite,
    // rather than performing thousands of JavaScript bridge round-trips.
    await database.exec(`
WITH RECURSIVE seq(n) AS (
  SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 1500
)
INSERT INTO receipts (
  id, merchant_raw_name, purchased_at, status, total_minor,
  created_at, updated_at
)
SELECT
  'volume-' || n,
  CASE WHEN n % 2 = 0 THEN 'Store Alpha' ELSE 'Store Beta' END,
  '2026-10-03', 'accepted', 10000 + n,
  '2026-10-03T00:00:00Z', '2026-10-03T00:00:00Z'
FROM seq;
`);
    await database.exec(`
INSERT INTO line_items (
  id, receipt_id, position, raw_name, line_total_minor,
  review_state, created_at, updated_at
)
SELECT
  'item-' || id, id, 0,
  CASE WHEN merchant_raw_name = 'Store Alpha'
    THEN 'RICE 1KG' ELSE 'SOAP BAR' END,
  total_minor, 'verified', created_at, updated_at
FROM receipts WHERE status = 'accepted';
`);
  });

  afterEach(() => database.close());

  it('retrieves deep pages and accurate totals without truncating 1500 receipts', async () => {
    const service = new HistoryService(history, new NormalizationService(history));
    const first = await service.loadOverview({ limit: 10, offset: 0 }, 'receipts', false);
    const last = await service.loadOverview({ limit: 10, offset: 1490 }, 'receipts', false);
    expect(first.receiptTotal).toBe(1500);
    expect(first.receipts).toHaveLength(10);
    expect(last.receiptTotal).toBe(1500);
    expect(last.receipts).toHaveLength(10);
    expect(new Set([...first.receipts, ...last.receipts].map((r) => r.receiptId)).size).toBe(20);
  });

  it('preserves filtering and accurate item counts across deep pagination', async () => {
    const service = new HistoryService(history, new NormalizationService(history));
    const filtered = await service.loadOverview(
      { merchantQuery: 'Alpha', limit: 10, offset: 740 },
      'receipts',
      false,
    );
    expect(filtered.receiptTotal).toBe(750);
    expect(filtered.receipts).toHaveLength(10);
    expect(filtered.receipts.every((r) => r.merchantName === 'Store Alpha')).toBe(true);

    const items = await service.loadOverview(
      { query: 'rice', limit: 10, offset: 740 },
      'items',
      false,
    );
    expect(items.itemTotal).toBe(750);
    expect(items.items).toHaveLength(10);
    expect(items.items.every((item) => item.rawName === 'RICE 1KG')).toBe(true);
  });

  it('omits all unfinished records from counts and pages', async () => {
    await database.run(
      `INSERT INTO receipts (id, status, created_at, updated_at)
       VALUES ('draft-in-volume', 'draft', '2026-10-03', '2026-10-03');`,
    );
    expect(await history.countReceipts()).toBe(1500);
    expect(await history.countItems()).toBe(1500);
  });
});
