import type { OcrDocument, OcrFrame } from '../../ocr/types';
import type { DatabaseConnection } from '../database/DatabaseConnection';

export interface StoredOcrRun {
  id: string;
  receiptId: string;
  engine: string;
  imageWidth: number;
  imageHeight: number;
  rawText: string;
  createdAt: string;
  observations: StoredOcrObservation[];
}

export interface StoredOcrObservation {
  id: string;
  parentId: string | null;
  kind: 'block' | 'line' | 'element';
  position: number;
  text: string;
  frame: OcrFrame;
  confidence: number | null;
}

export class OcrRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async replaceForReceipt(
    receiptId: string,
    document: OcrDocument,
    now: string,
  ): Promise<StoredOcrRun> {
    const runId = `ocr-${receiptId}`;
    const observations = flattenDocument(document);

    await this.database.transaction(async (transaction) => {
      const receipt = await transaction.first<{ status: string }>(
        'SELECT status FROM receipts WHERE id = ?;',
        [receiptId],
      );

      if (!receipt) {
        throw new Error(`Receipt not found: ${receiptId}`);
      }

      if (receipt.status !== 'draft' && receipt.status !== 'processing') {
        throw new Error(
          'OCR evidence can only be replaced for an unreviewed receipt.',
        );
      }

      await transaction.run('DELETE FROM ocr_runs WHERE receipt_id = ?;', [
        receiptId,
      ]);

      await transaction.run(
        `INSERT INTO ocr_runs (
          id, receipt_id, engine, image_width, image_height, raw_text, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
        [
          runId,
          receiptId,
          document.engine,
          document.imageWidth,
          document.imageHeight,
          document.rawText,
          now,
        ],
      );

      await insertObservationChunks(
        transaction,
        runId,
        observations,
      );

      const update = await transaction.run(
        'UPDATE receipts SET raw_ocr_text = ?, updated_at = ? WHERE id = ?;',
        [document.rawText, now, receiptId],
      );

      if (update.changes !== 1) {
        throw new Error(`Receipt not found: ${receiptId}`);
      }
    });

    return {
      id: runId,
      receiptId,
      engine: document.engine,
      imageWidth: document.imageWidth,
      imageHeight: document.imageHeight,
      rawText: document.rawText,
      createdAt: now,
      observations,
    };
  }

  async getForReceipt(receiptId: string): Promise<StoredOcrRun | null> {
    const run = await this.database.first<OcrRunRow>(
      'SELECT * FROM ocr_runs WHERE receipt_id = ?;',
      [receiptId],
    );

    if (!run) {
      return null;
    }

    const rows = await this.database.all<OcrObservationRow>(
      `SELECT * FROM ocr_observations
       WHERE ocr_run_id = ?
       ORDER BY
         CASE kind WHEN 'block' THEN 0 WHEN 'line' THEN 1 ELSE 2 END,
         position ASC;`,
      [run.id],
    );

    return {
      id: run.id,
      receiptId: run.receipt_id,
      engine: run.engine,
      imageWidth: run.image_width,
      imageHeight: run.image_height,
      rawText: run.raw_text,
      createdAt: run.created_at,
      observations: rows.map((row) => mapObservation(row, run.id)),
    };
  }
}

interface OcrRunRow {
  id: string;
  receipt_id: string;
  engine: string;
  image_width: number;
  image_height: number;
  raw_text: string;
  created_at: string;
}

interface OcrObservationRow {
  id: string;
  parent_id: string | null;
  kind: 'block' | 'line' | 'element';
  position: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number | null;
}

function flattenDocument(document: OcrDocument): StoredOcrObservation[] {
  const observations: StoredOcrObservation[] = [];

  document.blocks.forEach((block, blockIndex) => {
    observations.push({
      id: block.id,
      parentId: null,
      kind: 'block',
      position: blockIndex,
      text: block.text,
      frame: block.frame,
      confidence: block.confidence,
    });

    block.lines.forEach((line, lineIndex) => {
      observations.push({
        id: line.id,
        parentId: block.id,
        kind: 'line',
        position: lineIndex,
        text: line.text,
        frame: line.frame,
        confidence: line.confidence,
      });

      line.elements.forEach((element, elementIndex) => {
        observations.push({
          id: element.id,
          parentId: line.id,
          kind: 'element',
          position: elementIndex,
          text: element.text,
          frame: element.frame,
          confidence: element.confidence,
        });
      });
    });
  });

  return observations;
}

async function insertObservationChunks(
  database: DatabaseConnection,
  runId: string,
  observations: readonly StoredOcrObservation[],
): Promise<void> {
  // 11 bound values per row. A conservative chunk of 75 stays under the
  // common SQLite parameter ceiling while drastically reducing native bridge
  // round-trips for long receipts.
  const chunkSize = 75;

  for (let offset = 0; offset < observations.length; offset += chunkSize) {
    const chunk = observations.slice(offset, offset + chunkSize);
    const placeholders = chunk
      .map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .join(', ');
    const params = chunk.flatMap((observation) => [
      persistedObservationId(runId, observation.id),
      runId,
      observation.parentId
        ? persistedObservationId(runId, observation.parentId)
        : null,
      observation.kind,
      observation.position,
      observation.text,
      observation.frame.x,
      observation.frame.y,
      observation.frame.width,
      observation.frame.height,
      observation.confidence,
    ]);

    await database.run(
      `INSERT INTO ocr_observations (
        id, ocr_run_id, parent_id, kind, position, text,
        x, y, width, height, confidence
      ) VALUES ${placeholders};`,
      params,
    );
  }
}

function mapObservation(
  row: OcrObservationRow,
  runId: string,
): StoredOcrObservation {
  return {
    id: logicalObservationId(runId, row.id),
    parentId: row.parent_id
      ? logicalObservationId(runId, row.parent_id)
      : null,
    kind: row.kind,
    position: row.position,
    text: row.text,
    frame: {
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
    },
    confidence: row.confidence,
  };
}

function persistedObservationId(runId: string, observationId: string): string {
  return `${runId}::${observationId}`;
}

function logicalObservationId(runId: string, persistedId: string): string {
  const prefix = `${runId}::`;
  return persistedId.startsWith(prefix)
    ? persistedId.slice(prefix.length)
    : persistedId;
}
