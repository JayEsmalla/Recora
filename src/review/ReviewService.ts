import type { OcrRepository } from '../data/repositories/OcrRepository';
import type {
  ReceiptRepository,
  ReplaceReviewDataInput,
} from '../data/repositories/ReceiptRepository';
import type { ValidationState } from '../domain/receipt';
import type { ParserProcessingService } from '../parser/ParserProcessingService';
import {
  createReviewDraft,
  createReviewDraftFromStored,
  evaluateReviewDraft,
  reviewDraftToCandidate,
} from './ReviewModel';
import type { ReviewDraft, ReviewSession } from './types';

export class ReviewService {
  constructor(
    private readonly receipts: ReceiptRepository,
    private readonly ocr: OcrRepository,
    private readonly parser: ParserProcessingService,
  ) {}

  async load(receiptId: string, now = new Date()): Promise<ReviewSession> {
    const [receipt, run] = await Promise.all([
      this.receipts.getById(receiptId),
      this.ocr.getForReceipt(receiptId),
    ]);

    if (!receipt) {
      throw new Error(`Receipt not found: ${receiptId}`);
    }
    if (!run) {
      throw new Error('Receipt does not have completed OCR evidence.');
    }
    if (receipt.status === 'accepted') {
      throw new Error('Accepted receipts cannot be reopened as an unreviewed draft.');
    }

    let draft: ReviewDraft;
    let currentReceipt = receipt;

    if (receipt.status === 'review') {
      const stored = await this.receipts.getReviewData(receiptId);
      if (!stored) {
        throw new Error(`Receipt not found: ${receiptId}`);
      }
      draft = createReviewDraftFromStored(stored);
    } else {
      const candidate = await this.parser.parseReceipt(receiptId);
      draft = createReviewDraft(candidate, receiptId);
      const evaluation = evaluateReviewDraft(draft, now);

      if (evaluation.inputErrors.length === 0) {
        await this.receipts.replaceReviewData(
          buildPersistenceInput(
            receiptId,
            draft,
            evaluation,
            now.toISOString(),
          ),
        );
        currentReceipt =
          (await this.receipts.getById(receiptId)) ?? currentReceipt;
      }
    }

    return {
      receipt: currentReceipt,
      rawOcrText: run.rawText,
      draft,
      evaluation: evaluateReviewDraft(draft, now),
    };
  }

  async saveDraft(
    receiptId: string,
    draft: ReviewDraft,
    now = new Date(),
  ): Promise<ReviewSession> {
    const evaluation = evaluateReviewDraft(draft, now);

    if (evaluation.inputErrors.length > 0) {
      throw new Error('Correct invalid review fields before saving the draft.');
    }

    await this.receipts.replaceReviewData(
      buildPersistenceInput(receiptId, draft, evaluation, now.toISOString()),
    );

    const [receipt, run] = await Promise.all([
      this.receipts.getById(receiptId),
      this.ocr.getForReceipt(receiptId),
    ]);
    if (!receipt || !run) {
      throw new Error('Receipt review could not be reloaded after saving.');
    }

    return {
      receipt,
      rawOcrText: run.rawText,
      draft,
      evaluation,
    };
  }

  async saveAccepted(
    receiptId: string,
    draft: ReviewDraft,
    acknowledgeReview: boolean,
    now = new Date(),
  ): Promise<void> {
    const evaluation = evaluateReviewDraft(draft, now);

    if (evaluation.inputErrors.length > 0) {
      throw new Error('Correct invalid review fields before saving.');
    }
    if (evaluation.validation.state === 'mismatch') {
      throw new Error('Resolve receipt mismatches before saving purchase history.');
    }
    if (evaluation.validation.state === 'review' && !acknowledgeReview) {
      throw new Error(
        'Acknowledge the remaining review warnings before saving purchase history.',
      );
    }

    const receipt = await this.receipts.getById(receiptId);
    if (!receipt || receipt.status !== 'review') {
      throw new Error('Receipt must be saved as a review draft before acceptance.');
    }

    await this.receipts.saveAcceptedReview(
      buildPersistenceInput(receiptId, draft, evaluation, now.toISOString()),
    );
  }

  async discard(receiptId: string): Promise<string | null> {
    const receipt = await this.receipts.getById(receiptId);
    if (!receipt) {
      return null;
    }
    if (receipt.status === 'accepted') {
      throw new Error('Accepted receipts cannot be discarded as review drafts.');
    }

    await this.receipts.deleteReceipt(receiptId);
    return receipt.imageUri;
  }
}

function buildPersistenceInput(
  receiptId: string,
  draft: ReviewDraft,
  evaluation: ReturnType<typeof evaluateReviewDraft>,
  now: string,
): ReplaceReviewDataInput {
  const candidate = reviewDraftToCandidate(draft);
  const confidenceByField = new Map(
    evaluation.validation.confidence.map((field) => [
      field.fieldPath,
      field.confidenceBasisPoints,
    ]),
  );

  return {
    receiptId,
    merchantRawName: candidate.merchant?.rawName ?? null,
    purchasedAt: candidate.date?.isoDateTime ?? null,
    subtotalMinor: candidate.summary.subtotalMinor,
    totalMinor: candidate.summary.totalMinor,
    transactionType: candidate.transactionType,
    validationState: evaluation.validation.state,
    lineItems: candidate.items.map((item) => ({
      id: item.id,
      position: item.position,
      rawName: item.rawName,
      quantityMilli: item.quantityMilli,
      rawQuantityText: item.rawQuantityText,
      unitPriceMinor: item.unitPriceMinor,
      lineTotalMinor: item.lineTotalMinor,
      confidenceBasisPoints:
        confidenceByField.get(`items.${item.id}`) ?? null,
      reviewState: fieldState(
        `items.${item.id}`,
        evaluation.validation.issues,
      ),
    })),
    adjustments: candidate.summary.adjustments.map((adjustment) => ({
      id: adjustment.id,
      position: adjustment.position,
      kind: adjustment.kind,
      label: adjustment.label,
      amountMinor: adjustment.amountMinor,
      confidenceBasisPoints:
        confidenceByField.get(`adjustments.${adjustment.id}`) ?? null,
      reviewState: fieldState(
        `adjustments.${adjustment.id}`,
        evaluation.validation.issues,
      ),
    })),
    now,
  };
}

function fieldState(
  fieldPath: string,
  issues: readonly {
    fieldPath: string;
    state: Exclude<ValidationState, 'verified'>;
  }[],
): ValidationState {
  const relevant = issues.filter(
    (issue) =>
      issue.fieldPath === fieldPath ||
      issue.fieldPath.startsWith(`${fieldPath}.`),
  );

  if (relevant.some((issue) => issue.state === 'mismatch')) {
    return 'mismatch';
  }
  if (relevant.length > 0) {
    return 'review';
  }
  return 'verified';
}
