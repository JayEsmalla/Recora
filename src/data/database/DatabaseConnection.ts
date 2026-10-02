export type DatabaseValue = string | number | null | Uint8Array;
export type DatabaseParams = readonly DatabaseValue[];

export interface DatabaseRunResult {
  lastInsertRowId: number;
  changes: number;
}

export interface DatabaseConnection {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: DatabaseParams): Promise<DatabaseRunResult>;
  first<T>(sql: string, params?: DatabaseParams): Promise<T | null>;
  all<T>(sql: string, params?: DatabaseParams): Promise<T[]>;
  transaction<T>(work: (connection: DatabaseConnection) => Promise<T>): Promise<T>;
}
