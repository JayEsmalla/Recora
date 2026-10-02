import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  DatabaseConnection,
  DatabaseParams,
  DatabaseRunResult,
} from './DatabaseConnection';

export class ExpoSqliteConnection implements DatabaseConnection {
  constructor(private readonly database: SQLiteDatabase) {}

  exec(sql: string): Promise<void> {
    return this.database.execAsync(sql);
  }

  async run(sql: string, params: DatabaseParams = []): Promise<DatabaseRunResult> {
    const result = await this.database.runAsync(sql, [...params]);
    return {
      lastInsertRowId: result.lastInsertRowId,
      changes: result.changes,
    };
  }

  first<T>(sql: string, params: DatabaseParams = []): Promise<T | null> {
    return this.database.getFirstAsync<T>(sql, [...params]);
  }

  all<T>(sql: string, params: DatabaseParams = []): Promise<T[]> {
    return this.database.getAllAsync<T>(sql, [...params]);
  }

  async transaction<T>(
    work: (connection: DatabaseConnection) => Promise<T>,
  ): Promise<T> {
    let completed = false;
    let result!: T;

    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      result = await work(new ExpoSqliteConnection(transaction));
      completed = true;
    });

    if (!completed) {
      throw new Error('Database transaction did not complete.');
    }

    return result;
  }
}
