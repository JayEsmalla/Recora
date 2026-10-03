import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  migrateDatabase,
  migrations,
} from '../src/data/database/migrations';
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
    expect(row?.count).toBe(4);
  });

  it('installs ordered receipt-page storage with a five-photo limit', async () => {
    const columns = await database.all<{ name: string }>(
      'PRAGMA table_info(receipt_pages);',
    );
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'receipt_id',
        'position',
        'image_uri',
        'image_width',
        'image_height',
      ]),
    );

    const tableSql = await database.first<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'receipt_pages';",
    );
    expect(tableSql?.sql).toContain('position BETWEEN 0 AND 4');
  });

  it('backfills an existing single-image receipt into page zero on upgrade', async () => {
    const legacy = await createSqlJsConnection();
    const now = '2026-10-03T00:00:00.000Z';

    try {
      await legacy.exec('PRAGMA foreign_keys = ON;');
      await legacy.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
      `);

      for (const migration of migrations.filter((item) => item.version <= 3)) {
        await legacy.exec(migration.sql);
        await legacy.run(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?);',
          [migration.version, migration.name, now],
        );
      }

      await legacy.run(
        `INSERT INTO receipts (
          id, currency_code, transaction_type, status, validation_state,
          image_uri, image_width, image_height, created_at, updated_at
        ) VALUES (?, 'PHP', 'purchase', 'draft', 'review', ?, ?, ?, ?, ?);`,
        ['legacy-receipt', 'file:///private/legacy.jpg', 800, 1600, now, now],
      );

      await migrateDatabase(legacy);

      const page = await legacy.first<{
        position: number;
        image_uri: string;
        image_width: number;
        image_height: number;
      }>(
        'SELECT position, image_uri, image_width, image_height FROM receipt_pages WHERE receipt_id = ?;',
        ['legacy-receipt'],
      );

      expect(page).toEqual({
        position: 0,
        image_uri: 'file:///private/legacy.jpg',
        image_width: 800,
        image_height: 1600,
      });
    } finally {
      legacy.close();
    }
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

  it('installs history categories and the enriched accepted price-history view', async () => {
    const categories = await database.all<{ id: string; name: string }>(
      'SELECT id, name FROM categories ORDER BY name ASC;',
    );
    expect(categories.map((category) => category.name)).toEqual(
      expect.arrayContaining([
        'Food & Groceries',
        'Dining',
        'Household',
        'Personal Care',
        'Health',
        'Transport',
        'Other',
      ]),
    );

    const columns = await database.all<{ name: string }>(
      'PRAGMA table_info(correction_rules);',
    );
    expect(columns.map((column) => column.name)).toContain('normalized_item_id');

    const viewSql = await database.first<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'view' AND name = 'accepted_price_history';",
    );
    expect(viewSql?.sql).toContain('receipt_id');
    expect(viewSql?.sql).toContain('normalized_name');
    expect(viewSql?.sql).toContain('category_name');
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
