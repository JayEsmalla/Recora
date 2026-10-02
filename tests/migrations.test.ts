import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../src/data/database/migrations';
import { createSqlJsConnection, type SqlJsConnection } from './helpers/SqlJsConnection';

describe('database migrations', () => {
  let database: SqlJsConnection;

  beforeEach(async () => {
    database = await createSqlJsConnection();
    await migrateDatabase(database);
  });

  afterEach(() => {
    database.close();
  });

  it('is idempotent and records the applied migration once', async () => {
    await migrateDatabase(database);
    const row = await database.first<{ count: number }>(
      'SELECT COUNT(*) AS count FROM schema_migrations;',
    );
    expect(row?.count).toBe(2);
  });

  it('enables receipt cascade deletion', async () => {
    const now = '2026-10-03T00:00:00.000Z';
    await database.run(
      `INSERT INTO receipts (
        id, currency_code, transaction_type, status, validation_state,
        created_at, updated_at
      ) VALUES (?, 'PHP', 'purchase', 'review', 'review', ?, ?);`,
      ['receipt-1', now, now],
    );
    await database.run(
      `INSERT INTO line_items (
        id, receipt_id, position, raw_name, review_state, created_at, updated_at
      ) VALUES (?, ?, 0, ?, 'review', ?, ?);`,
      ['item-1', 'receipt-1', 'Milk', now, now],
    );

    await database.run('DELETE FROM receipts WHERE id = ?;', ['receipt-1']);

    const row = await database.first<{ count: number }>(
      'SELECT COUNT(*) AS count FROM line_items WHERE receipt_id = ?;',
      ['receipt-1'],
    );
    expect(row?.count).toBe(0);
  });

  it('derives price history from accepted receipts only', async () => {
    const now = '2026-10-03T00:00:00.000Z';
    await database.run(
      `INSERT INTO receipts (
        id, merchant_raw_name, purchased_at, currency_code, transaction_type,
        status, validation_state, created_at, updated_at
      ) VALUES (?, ?, ?, 'PHP', 'purchase', 'review', 'verified', ?, ?);`,
      ['receipt-1', 'Store', now, now, now],
    );
    await database.run(
      `INSERT INTO line_items (
        id, receipt_id, position, raw_name, unit_price_minor, line_total_minor,
        review_state, created_at, updated_at
      ) VALUES (?, ?, 0, ?, ?, ?, 'verified', ?, ?);`,
      ['item-1', 'receipt-1', 'Coffee', 12000, 12000, now, now],
    );

    let rows = await database.all('SELECT * FROM accepted_price_history;');
    expect(rows).toHaveLength(0);

    await database.run(
      "UPDATE receipts SET status = 'accepted' WHERE id = ?;",
      ['receipt-1'],
    );

    rows = await database.all('SELECT * FROM accepted_price_history;');
    expect(rows).toHaveLength(1);
  });

  it('rejects non-integer persisted money', async () => {
    const now = '2026-10-03T00:00:00.000Z';
    await expect(
      database.run(
        `INSERT INTO receipts (
          id, subtotal_minor, currency_code, transaction_type, status,
          validation_state, created_at, updated_at
        ) VALUES (?, ?, 'PHP', 'purchase', 'draft', 'review', ?, ?);`,
        ['receipt-float', 12.5, now, now],
      ),
    ).rejects.toThrow();
  });
});
