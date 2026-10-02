import initSqlJs, { type Database } from 'sql.js';

import type {
  DatabaseConnection,
  DatabaseParams,
  DatabaseRunResult,
} from '../../src/data/database/DatabaseConnection';

export async function createSqlJsConnection(): Promise<SqlJsConnection> {
  const SQL = await initSqlJs();
  const database = new SQL.Database();
  return new SqlJsConnection(database);
}

export class SqlJsConnection implements DatabaseConnection {
  constructor(private readonly database: Database) {}

  async exec(sql: string): Promise<void> {
    this.database.run(sql);
  }

  async run(sql: string, params: DatabaseParams = []): Promise<DatabaseRunResult> {
    this.database.run(sql, [...params]);
    const changes = this.database.getRowsModified();
    const row = this.firstSync<{ id: number }>('SELECT last_insert_rowid() AS id;');
    return {
      lastInsertRowId: row?.id ?? 0,
      changes,
    };
  }

  async first<T>(sql: string, params: DatabaseParams = []): Promise<T | null> {
    return this.firstSync<T>(sql, params);
  }

  async all<T>(sql: string, params: DatabaseParams = []): Promise<T[]> {
    const statement = this.database.prepare(sql);
    try {
      statement.bind([...params]);
      const rows: T[] = [];
      while (statement.step()) {
        rows.push(statement.getAsObject() as T);
      }
      return rows;
    } finally {
      statement.free();
    }
  }

  async transaction<T>(
    work: (connection: DatabaseConnection) => Promise<T>,
  ): Promise<T> {
    this.database.run('BEGIN IMMEDIATE;');
    try {
      const result = await work(this);
      this.database.run('COMMIT;');
      return result;
    } catch (error) {
      this.database.run('ROLLBACK;');
      throw error;
    }
  }

  close(): void {
    this.database.close();
  }

  private firstSync<T>(
    sql: string,
    params: DatabaseParams = [],
  ): T | null {
    const statement = this.database.prepare(sql);
    try {
      statement.bind([...params]);
      return statement.step() ? (statement.getAsObject() as T) : null;
    } finally {
      statement.free();
    }
  }
}
