import * as SQLite from 'expo-sqlite';

import { ExpoSqliteConnection } from './ExpoSqliteConnection';
import { migrateDatabase } from './migrations';

const DATABASE_NAME = 'recora.db';

let connectionPromise: Promise<ExpoSqliteConnection> | null = null;

export function openRecoraDatabase(): Promise<ExpoSqliteConnection> {
  if (!connectionPromise) {
    connectionPromise = SQLite.openDatabaseAsync(DATABASE_NAME)
      .then(async (database) => {
        const connection = new ExpoSqliteConnection(database);
        await migrateDatabase(connection);
        return connection;
      })
      .catch((error) => {
        connectionPromise = null;
        throw error;
      });
  }

  return connectionPromise;
}
