import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  captureReceiptWithCamera,
  importReceiptFromLibrary,
  recoverPendingImagePickerResult,
  type CaptureResult,
} from './src/capture/CaptureService';
import { ReceiptImageEditor } from './src/capture/ReceiptImageEditor';
import {
  clearStagedReceiptImages,
  pruneOrphanedReceiptImages,
  removePrivateReceiptImage,
  retainPreparedReceiptImage,
} from './src/capture/ReceiptImageStore';
import type {
  PreparedReceiptImage,
  ReceiptImageSource,
} from './src/capture/types';
import { openRecoraDatabase } from './src/data/database/openDatabase';
import {
  OcrRepository,
  type StoredOcrRun,
} from './src/data/repositories/OcrRepository';
import {
  ReceiptRepository,
  type UnfinishedReceiptSummary,
} from './src/data/repositories/ReceiptRepository';
import { HistoryRepository } from './src/history/HistoryRepository';
import { HistoryScreen } from './src/history/HistoryScreen';
import {
  HistoryService,
  type HistoryLoadMode,
  type HistoryOverview,
} from './src/history/HistoryService';
import { ItemHistoryScreen } from './src/history/ItemHistoryScreen';
import { NormalizationService } from './src/history/NormalizationService';
import { ReceiptDetailScreen } from './src/history/ReceiptDetailScreen';
import type {
  CategoryOption,
  HistoryFilters,
  HistoryLineItem,
  ItemHistorySummary,
  ItemSearchEntry,
  NormalizedItemOption,
  ReceiptHistoryDetail,
} from './src/history/types';
import { MlKitOcrEngine } from './src/ocr/MlKitOcrEngine';
import {
  OcrProcessingService,
  type OcrProgressEvent,
} from './src/ocr/OcrProcessingService';
import { ParserProcessingService } from './src/parser/ParserProcessingService';
import { ReceiptReviewScreen } from './src/review/ReceiptReviewScreen';
import { ReviewService } from './src/review/ReviewService';
import type { ReviewDraft, ReviewSession } from './src/review/types';
import { BrandMark } from './src/ui/BrandMark';
import { colors, radii, shadows, spacing, typography } from './src/ui/theme';

type BootState = 'loading' | 'ready' | 'error';
type AppScreen =
  | 'home'
  | 'editing'
  | 'prepared'
  | 'ocr-processing'
  | 'ocr-error'
  | 'review-loading'
  | 'review'
  | 'review-error'
  | 'saved'
  | 'history-loading'
  | 'history'
  | 'history-error'
  | 'receipt-detail-loading'
  | 'receipt-detail'
  | 'item-history-loading'
  | 'item-history';

export default function App() {
  const [bootState, setBootState] = useState<BootState>('loading');
  const [screen, setScreen] = useState<AppScreen>('home');
  const [source, setSource] = useState<ReceiptImageSource | null>(null);
  const [captureAction, setCaptureAction] = useState<
    'camera' | 'library' | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [preparedReceiptId, setPreparedReceiptId] = useState<string | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState<OcrProgressEvent | null>(null);
  const [reviewSession, setReviewSession] = useState<ReviewSession | null>(null);
  const [pendingReceipts, setPendingReceipts] = useState<
    UnfinishedReceiptSummary[]
  >([]);
  const [historyOverview, setHistoryOverview] = useState<HistoryOverview | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [receiptDetail, setReceiptDetail] = useState<ReceiptHistoryDetail | null>(null);
  const [itemHistory, setItemHistory] = useState<ItemHistorySummary | null>(null);
  const [historyCategories, setHistoryCategories] = useState<CategoryOption[]>([]);
  const [normalizedItems, setNormalizedItems] = useState<NormalizedItemOption[]>([]);
  const recoveryAttempted = useRef(false);
  const ocrAbortController = useRef<AbortController | null>(null);

  useEffect(() => {
    let mounted = true;
    let cleanupTimer: ReturnType<typeof setTimeout> | null = null;

    openRecoraDatabase()
      .then(async (database) => {
        if (!mounted) {
          return;
        }

        const repository = new ReceiptRepository(database);
        const pending = await repository.listUnfinished();

        if (!mounted) {
          return;
        }

        // Staging files are never durable drafts, so clear them before
        // capture becomes interactive. Orphaned retained-image scanning stays
        // off the boot critical path.
        try {
          clearStagedReceiptImages();
        } catch (error) {
          console.warn('Recora staging cleanup could not finish.', error);
        }

        setPendingReceipts(pending);
        setBootState('ready');

        cleanupTimer = setTimeout(() => {
          if (!mounted) {
            return;
          }

          void repository
            .listImageUris()
            .then((referencedUris) => {
              pruneOrphanedReceiptImages(referencedUris);
            })
            .catch((error) => {
              console.warn('Recora startup storage cleanup could not finish.', error);
            });
        }, 250);

        if (!recoveryAttempted.current) {
          recoveryAttempted.current = true;
          const recovered = await recoverPendingImagePickerResult();
          if (mounted && recovered?.status === 'captured') {
            setSource(recovered.image);
            setScreen('editing');
          }
        }
      })
      .catch((error) => {
        console.error('Recora database initialization failed.', error);
        if (mounted) {
          setBootState('error');
        }
      });

    return () => {
      mounted = false;
      if (cleanupTimer) {
        clearTimeout(cleanupTimer);
      }
    };
  }, []);

  async function startCapture(
    sourceKind: 'camera' | 'library',
    action: () => Promise<CaptureResult>,
  ): Promise<void> {
    if (captureAction) {
      return;
    }

    setCaptureAction(sourceKind);
    setMessage(null);
    try {
      const result = await action();

      if (result.status === 'captured') {
        setSource(result.image);
        setScreen('editing');
        return;
      }

      if (result.status === 'permission-denied') {
        setMessage(
          result.source === 'camera'
            ? 'Camera permission is required to photograph a receipt. You can still import an existing image.'
            : 'Photo access is required to import a receipt image.',
        );
      }
    } catch (error) {
      setMessage(messageFromError(error, 'Recora could not open this receipt image.'));
    } finally {
      setCaptureAction(null);
    }
  }

  function cancelEditing() {
    if (source) {
      removePrivateReceiptImage(source.uri);
    }
    setSource(null);
    setMessage(null);
    setScreen('home');
  }

  async function savePreparedDraft(image: PreparedReceiptImage) {
    const receiptId = createReceiptId();
    let retained: PreparedReceiptImage | null = null;

    try {
      retained = await retainPreparedReceiptImage(image, receiptId);
      const database = await openRecoraDatabase();
      const repository = new ReceiptRepository(database);
      const now = new Date().toISOString();

      await repository.createDraft({
        id: receiptId,
        imageUri: retained.uri,
        imageWidth: retained.width,
        imageHeight: retained.height,
        now,
      });

      if (source) {
        removePrivateReceiptImage(source.uri);
      }

      setSource(null);
      setPreparedReceiptId(receiptId);
      setOcrError(null);
      setMessage(null);

      // The user already approved the prepared image. Start OCR immediately
      // instead of inserting a redundant confirmation screen and extra tap.
      void refreshPendingReceipts().catch((error) => {
        console.warn('Could not refresh unfinished receipts after capture.', error);
      });
      void runOfflineOcr(receiptId);
    } catch (error) {
      if (retained) {
        removePrivateReceiptImage(retained.uri);
      }
      throw error;
    }
  }

  async function runOfflineOcr(receiptId: string): Promise<void> {
    const controller = new AbortController();
    ocrAbortController.current = controller;
    setOcrError(null);
    setOcrProgress(null);
    setMessage(null);
    setScreen('ocr-processing');

    try {
      const database = await openRecoraDatabase();
      const service = new OcrProcessingService(
        new MlKitOcrEngine(),
        new ReceiptRepository(database),
        new OcrRepository(database),
      );

      const run = await service.process({
        receiptId,
        signal: controller.signal,
        onProgress(event) {
          setOcrProgress(event);
        },
      });

      if (controller.signal.aborted) {
        return;
      }

      void refreshPendingReceipts().catch((error) => {
        console.warn('Could not refresh unfinished receipts after OCR.', error);
      });
      await openReview(receiptId, run);
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        setMessage('Offline text recognition was cancelled. The receipt draft is still safe.');
        setScreen('prepared');
        return;
      }

      setOcrError(
        messageFromError(
          error,
          'Offline text recognition failed. The receipt draft was not changed.',
        ),
      );
      setScreen('ocr-error');
    } finally {
      if (ocrAbortController.current === controller) {
        ocrAbortController.current = null;
      }
    }
  }

  function cancelOfflineOcr() {
    ocrAbortController.current?.abort();
    setMessage('Cancelling text recognition…');
  }

  async function refreshPendingReceipts(): Promise<void> {
    const database = await openRecoraDatabase();
    const repository = new ReceiptRepository(database);
    setPendingReceipts(await repository.listUnfinished());
  }

  async function createReviewService(): Promise<ReviewService> {
    const database = await openRecoraDatabase();
    const receipts = new ReceiptRepository(database);
    const ocr = new OcrRepository(database);
    return new ReviewService(
      receipts,
      ocr,
      new ParserProcessingService(ocr),
    );
  }

  async function createHistoryService(): Promise<HistoryService> {
    const database = await openRecoraDatabase();
    const repository = new HistoryRepository(database);
    return new HistoryService(
      repository,
      new NormalizationService(repository),
    );
  }

  async function openHistory(): Promise<void> {
    setHistoryError(null);

    if (historyOverview) {
      setScreen('history');
      return;
    }

    const loadingTimer = setTimeout(() => {
      setScreen('history-loading');
    }, 120);

    try {
      const service = await createHistoryService();
      const overview = await service.loadOverview({}, 'receipts');
      clearTimeout(loadingTimer);
      setHistoryOverview(overview);
      setHistoryCategories(overview.categories);
      setScreen('history');
    } catch (error) {
      clearTimeout(loadingTimer);
      setHistoryError(
        messageFromError(error, 'Recora could not load local purchase history.'),
      );
      setScreen('history-error');
    }
  }

  async function searchHistory(
    filters: HistoryFilters,
    mode: HistoryLoadMode,
  ): Promise<HistoryOverview> {
    const service = await createHistoryService();
    // Search/filter state belongs to the mounted History screen. Keep the
    // app-level cache as the unfiltered overview so reopening History cannot
    // silently show stale filtered results with empty controls.
    return service.loadOverview(filters, mode, false);
  }

  async function openReceiptDetail(receiptId: string): Promise<void> {
    setHistoryError(null);
    const loadingTimer = setTimeout(() => {
      setScreen('receipt-detail-loading');
    }, 120);

    try {
      const service = await createHistoryService();
      const detail = await service.getReceiptDetail(receiptId);

      if (!detail) {
        throw new Error('Accepted receipt could not be found.');
      }

      clearTimeout(loadingTimer);
      setReceiptDetail(detail);
      setScreen('receipt-detail');

      // Identity suggestions are optional assistance. Do not make receipt
      // detail wait for them.
      void service
        .listNormalizedItems()
        .then(setNormalizedItems)
        .catch((error) => {
          console.warn('Could not refresh normalized item suggestions.', error);
        });
    } catch (error) {
      clearTimeout(loadingTimer);
      setHistoryError(
        messageFromError(error, 'Recora could not open this saved receipt.'),
      );
      setScreen('history-error');
    }
  }

  async function openItemHistory(
    item: ItemSearchEntry | HistoryLineItem,
  ): Promise<void> {
    setHistoryError(null);
    const loadingTimer = setTimeout(() => {
      setScreen('item-history-loading');
    }, 120);

    try {
      const service = await createHistoryService();
      const summary = await service.getItemHistory(
        item.normalizedItemId
          ? { normalizedItemId: item.normalizedItemId }
          : { rawName: item.rawName },
      );

      if (!summary) {
        throw new Error('No accepted purchase history was found for this item.');
      }

      clearTimeout(loadingTimer);
      setItemHistory(summary);
      setScreen('item-history');
    } catch (error) {
      clearTimeout(loadingTimer);
      setHistoryError(
        messageFromError(error, 'Recora could not load this item history.'),
      );
      setScreen('history-error');
    }
  }

  async function assignHistoryItemIdentity(input: {
    lineItemId: string;
    canonicalName: string;
    categoryId: string | null;
    rememberForMerchant: boolean;
  }): Promise<ReceiptHistoryDetail> {
    if (!receiptDetail) {
      throw new Error('No saved receipt is open.');
    }

    const service = await createHistoryService();
    await service.assignItemIdentity(input);

    const detail = await service.getReceiptDetail(receiptDetail.receiptId);

    if (!detail) {
      throw new Error('Saved receipt could not be reloaded after organizing the item.');
    }

    setReceiptDetail(detail);
    setHistoryOverview(null);
    void service
      .listNormalizedItems()
      .then(setNormalizedItems)
      .catch((error) => {
        console.warn('Could not refresh normalized item suggestions.', error);
      });
    return detail;
  }

  async function unlinkHistoryItemIdentity(
    lineItemId: string,
  ): Promise<ReceiptHistoryDetail> {
    if (!receiptDetail) {
      throw new Error('No saved receipt is open.');
    }

    const service = await createHistoryService();
    await service.unlinkItemIdentity(lineItemId);
    const detail = await service.getReceiptDetail(receiptDetail.receiptId);

    if (!detail) {
      throw new Error('Saved receipt could not be reloaded after unlinking the item.');
    }

    setReceiptDetail(detail);
    setHistoryOverview(null);
    return detail;
  }

  async function resetHistoryRules(): Promise<number> {
    if (!receiptDetail) {
      throw new Error('No saved receipt is open.');
    }

    const service = await createHistoryService();
    return service.resetRulesForReceipt(receiptDetail.receiptId);
  }

  async function deleteHistoryReceipt(): Promise<void> {
    if (!receiptDetail) {
      throw new Error('No saved receipt is open.');
    }

    const service = await createHistoryService();
    const imageUri = await service.deleteReceipt(receiptDetail.receiptId);
    if (imageUri) {
      removePrivateReceiptImage(imageUri);
    }

    setReceiptDetail(null);
    setItemHistory(null);
    setHistoryOverview(null);
    await openHistory();
  }

  async function openReview(
    receiptId: string,
    run?: StoredOcrRun,
  ): Promise<void> {
    setPreparedReceiptId(receiptId);
    setMessage(null);

    const loadingTimer = run
      ? null
      : setTimeout(() => {
          setScreen('review-loading');
        }, 120);

    try {
      const service = await createReviewService();
      const session = await service.load(receiptId, new Date(), run);
      if (loadingTimer) {
        clearTimeout(loadingTimer);
      }
      setReviewSession(session);
      setScreen('review');
      void refreshPendingReceipts().catch((error) => {
        console.warn('Could not refresh unfinished receipts after review load.', error);
      });
    } catch (error) {
      if (loadingTimer) {
        clearTimeout(loadingTimer);
      }
      setOcrError(
        messageFromError(
          error,
          'Recora could not prepare this receipt for review.',
        ),
      );
      setScreen('review-error');
    }
  }

  async function saveReviewDraft(
    draft: ReviewDraft,
  ): Promise<ReviewSession> {
    const receiptId = reviewSession?.receipt.id ?? preparedReceiptId;
    if (!receiptId) {
      throw new Error('No active receipt review was found.');
    }

    const service = await createReviewService();
    const session = await service.saveDraft(receiptId, draft);
    setReviewSession(session);
    void refreshPendingReceipts().catch((error) => {
      console.warn('Could not refresh unfinished receipts after draft save.', error);
    });
    return session;
  }

  async function acceptReviewedReceipt(
    draft: ReviewDraft,
    acknowledgeReview: boolean,
  ): Promise<void> {
    const receiptId = reviewSession?.receipt.id ?? preparedReceiptId;
    if (!receiptId) {
      throw new Error('No active receipt review was found.');
    }

    const service = await createReviewService();
    await service.saveAccepted(receiptId, draft, acknowledgeReview);

    setReviewSession(null);
    setPreparedReceiptId(null);
    setHistoryOverview(null);
    setScreen('saved');

    // The accepted receipt is already durable. Merchant-specific organization
    // is helpful but should never hold the user on a save spinner.
    void createHistoryService()
      .then((history) => history.applyKnownRules(receiptId))
      .catch((error) => {
        console.warn(
          'Accepted receipt was saved, but local normalization rules could not be applied.',
          error,
        );
      });

    void refreshPendingReceipts().catch((error) => {
      console.warn('Could not refresh unfinished receipts after save.', error);
    });
  }

  async function discardReviewedReceipt(): Promise<void> {
    const receiptId = reviewSession?.receipt.id ?? preparedReceiptId;
    if (!receiptId) {
      throw new Error('No active receipt review was found.');
    }

    const service = await createReviewService();
    const imageUri = await service.discard(receiptId);
    if (imageUri) {
      removePrivateReceiptImage(imageUri);
    }

    setReviewSession(null);
    setPreparedReceiptId(null);
    setMessage(null);
    setScreen('home');
    void refreshPendingReceipts().catch((error) => {
      console.warn('Could not refresh unfinished receipts after discard.', error);
    });
  }

  async function resumeReceipt(
    receipt: UnfinishedReceiptSummary,
  ): Promise<void> {
    setPreparedReceiptId(receipt.id);
    setMessage(null);

    if (receipt.status === 'review' || receipt.hasOcrText) {
      await openReview(receipt.id);
      return;
    }

    setScreen('prepared');
  }

  if (bootState !== 'ready') {
    return <BootScreen state={bootState} />;
  }

  if (screen === 'editing' && source) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <ReceiptImageEditor
          source={source}
          onCancel={cancelEditing}
          onReady={savePreparedDraft}
        />
      </SafeAreaView>
    );
  }

  if (screen === 'review-loading') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.centeredPage}>
          <ActivityIndicator size="large" />
          <Text style={styles.bootTitle}>Building your receipt</Text>
          <Text style={styles.centeredBody}>
            Organizing items and checking totals.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (screen === 'review' && reviewSession) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <ReceiptReviewScreen
          initialSession={reviewSession}
          onSaveDraft={saveReviewDraft}
          onAccept={acceptReviewedReceipt}
          onDiscard={discardReviewedReceipt}
          onBack={() => setScreen('home')}
        />
      </SafeAreaView>
    );
  }

  if (screen === 'review-error') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.centeredPage}>
          <Text style={styles.errorMark}>!</Text>
          <Text style={styles.bootTitle}>Receipt review could not open</Text>
          <Text style={styles.centeredBody}>
            {ocrError ??
              'The receipt draft remains stored locally and can be retried.'}
          </Text>
          {preparedReceiptId ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => openReview(preparedReceiptId)}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Retry review</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => setScreen('home')}
            style={styles.secondaryWideButton}
          >
            <Text style={styles.secondaryWideButtonText}>Back to home</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (screen === 'saved') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.centeredPage}>
          <View style={styles.successMark}>
            <Text style={styles.successMarkText}>✓</Text>
          </View>
          <Text style={styles.pageTitle}>Receipt saved</Text>
          <Text style={styles.centeredBody}>
            Added to your purchase history.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setScreen('home')}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Back to home</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (
    screen === 'history-loading' ||
    screen === 'receipt-detail-loading' ||
    screen === 'item-history-loading'
  ) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.centeredPage}>
          <ActivityIndicator size="large" />
          <Text style={styles.bootTitle}>Opening purchase history</Text>
          <Text style={styles.centeredBody}>Loading reviewed receipts.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (screen === 'history-error') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.centeredPage}>
          <Text style={styles.errorMark}>!</Text>
          <Text style={styles.bootTitle}>Purchase history could not open</Text>
          <Text style={styles.centeredBody}>
            {historyError ??
              'Your accepted receipts remain stored locally. Retry the history view.'}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={openHistory}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Retry history</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setScreen('home')}
            style={styles.secondaryWideButton}
          >
            <Text style={styles.secondaryWideButtonText}>Back to home</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (screen === 'history' && historyOverview) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <HistoryScreen
          initialOverview={historyOverview}
          onSearch={searchHistory}
          onOpenReceipt={openReceiptDetail}
          onOpenItem={openItemHistory}
          onBack={() => setScreen('home')}
        />
      </SafeAreaView>
    );
  }

  if (screen === 'receipt-detail' && receiptDetail) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <ReceiptDetailScreen
          initialDetail={receiptDetail}
          categories={historyCategories}
          normalizedItems={normalizedItems}
          onAssignIdentity={assignHistoryItemIdentity}
          onUnlinkIdentity={unlinkHistoryItemIdentity}
          onResetRules={resetHistoryRules}
          onDelete={deleteHistoryReceipt}
          onOpenItemHistory={openItemHistory}
          onBack={openHistory}
        />
      </SafeAreaView>
    );
  }

  if (screen === 'item-history' && itemHistory) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <ItemHistoryScreen
          summary={itemHistory}
          onOpenReceipt={openReceiptDetail}
          onBack={openHistory}
        />
      </SafeAreaView>
    );
  }

  if (screen === 'ocr-processing') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.centeredPage}>
          <BrandMark size={72} />
          <ActivityIndicator
            color={colors.primary}
            size="small"
            style={styles.processingIndicator}
          />
          <Text style={styles.bootTitle}>
            {ocrProgressTitle(ocrProgress?.stage)}
          </Text>
          <Text style={styles.centeredBody}>
            {ocrProgressMessage(ocrProgress?.stage)}
          </Text>

          <Pressable
            accessibilityRole="button"
            onPress={cancelOfflineOcr}
            style={styles.secondaryWideButton}
          >
            <Text style={styles.secondaryWideButtonText}>Cancel recognition</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (screen === 'ocr-error') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.centeredPage}>
          <Text style={styles.errorMark}>!</Text>
          <Text style={styles.bootTitle}>Couldn’t read this receipt</Text>
          <Text style={styles.centeredBody}>
            {ocrError ??
              'The receipt draft is still stored safely. You can retry without recapturing it.'}
          </Text>
          {preparedReceiptId ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => runOfflineOcr(preparedReceiptId)}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Try again</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => setScreen('prepared')}
            style={styles.secondaryWideButton}
          >
            <Text style={styles.secondaryWideButtonText}>Back to draft</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (screen === 'prepared') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.centeredPage}>
          <View style={styles.successMark}>
            <Text style={styles.successMarkText}>✓</Text>
          </View>
          <Text style={styles.pageTitle}>Receipt ready</Text>
          <Text style={styles.centeredBody}>Draft saved locally.</Text>
          {message ? <InlineError message={message} /> : null}
          {preparedReceiptId ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => runOfflineOcr(preparedReceiptId)}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Continue</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setPreparedReceiptId(null);
              setMessage(null);
              setScreen('home');
            }}
            style={styles.secondaryWideButton}
          >
            <Text style={styles.secondaryWideButtonText}>Back to home</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.homePage}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brandRow}>
          <BrandMark size={86} />
          <View style={styles.brandCopy}>
            <Text style={styles.brandName}>RECORA</Text>
            <Text style={styles.brandTag}>Private receipt organizer</Text>
          </View>
        </View>

        <Text style={styles.heroTitle}>Know what you bought.</Text>
        <Text style={styles.bodyText}>
          Turn printed receipts into clean, searchable purchase records—right on
          your device.
        </Text>

        <Pressable
          accessibilityRole="button"
          onPress={() =>
            startCapture('camera', captureReceiptWithCamera)
          }
          style={[
            styles.scanCard,
            captureAction !== null && styles.disabledButton,
          ]}
          disabled={captureAction !== null}
        >
          <View style={styles.scanIcon}>
            <Ionicons name="camera-outline" size={25} color="#FFFFFF" />
          </View>
          <View style={styles.scanCopy}>
            <Text style={styles.scanPrimaryTitle}>
              {captureAction === 'camera' ? 'Opening camera…' : 'Scan receipt'}
            </Text>
            <Text style={styles.scanPrimarySubtitle}>
              Capture and reconstruct a purchase
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={22}
            color="#FFFFFF"
          />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() =>
            startCapture('library', importReceiptFromLibrary)
          }
          style={[
            styles.importButton,
            captureAction !== null && styles.disabledButton,
          ]}
          disabled={captureAction !== null}
        >
          <Ionicons name="image-outline" size={19} color={colors.primary} />
          <Text style={styles.importButtonText}>
            {captureAction === 'library'
              ? 'Opening photos…'
              : 'Import from photos'}
          </Text>
        </Pressable>

        {message ? <InlineError message={message} /> : null}

        <Pressable
          accessibilityRole="button"
          onPress={openHistory}
          style={styles.historyCard}
        >
          <View style={styles.historyCardIcon}>
            <Ionicons
              name="receipt-outline"
              size={24}
              color={colors.primaryAlt}
            />
          </View>
          <View style={styles.scanCopy}>
            <Text style={styles.cardTitle}>Purchase history</Text>
            <Text style={styles.cardSubtitle}>
              Receipts, items, and price history
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={22}
            color={colors.textMuted}
          />
        </Pressable>

        {pendingReceipts[0] ? (
          <View style={styles.foundationCard}>
            <Text style={styles.sectionLabel}>CONTINUE WHERE YOU LEFT OFF</Text>
            <Text style={styles.foundationTitle}>
              {pendingReceipts[0].status === 'review'
                ? 'Continue receipt review'
                : pendingReceipts[0].hasOcrText
                  ? 'Review reconstructed receipt'
                  : 'Continue receipt processing'}
            </Text>
            <Text style={styles.foundationText}>Draft saved on this device.</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => resumeReceipt(pendingReceipts[0]!)}
              style={styles.resumeButton}
            >
              <Text style={styles.resumeButtonText}>Resume receipt</Text>
            </Pressable>
          </View>
        ) : null}

      </ScrollView>
    </SafeAreaView>
  );
}

function BootScreen({ state }: { state: BootState }) {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.centeredPage}>
        {state === 'loading' ? (
          <>
            <BrandMark size={88} />
            <ActivityIndicator
              color={colors.primary}
              style={styles.processingIndicator}
            />
            <Text style={styles.bootTitle}>Opening Recora</Text>
            <Text style={styles.centeredBody}>
              Preparing your private purchase library.
            </Text>
          </>
        ) : (
          <>
            <BrandMark size={76} />
            <Text style={styles.errorMark}>!</Text>
            <Text style={styles.bootTitle}>Recora could not start</Text>
            <Text style={styles.centeredBody}>
              Your local data was not changed. Restart the app and try again.
            </Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <View style={styles.errorCard}>
      <Text style={styles.errorCardText}>{message}</Text>
    </View>
  );
}

function createReceiptId(): string {
  return `receipt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function ocrProgressTitle(
  stage: OcrProgressEvent['stage'] | undefined,
): string {
  switch (stage) {
    case 'loading-receipt':
      return 'Preparing receipt';
    case 'recognizing-text':
      return 'Reading receipt';
    case 'redacting-sensitive-data':
      return 'Protecting sensitive details';
    case 'persisting-evidence':
      return 'Checking and saving';
    case 'complete':
      return 'Receipt read';
    default:
      return 'Preparing receipt';
  }
}

function ocrProgressMessage(
  stage: OcrProgressEvent['stage'] | undefined,
): string {
  switch (stage) {
    case 'loading-receipt':
      return 'Getting the image ready.';
    case 'recognizing-text':
      return 'Finding the store, items, prices, and total.';
    case 'redacting-sensitive-data':
      return 'Protecting sensitive details before saving.';
    case 'persisting-evidence':
      return 'Checking the result and saving it locally.';
    case 'complete':
      return 'Opening your reconstructed receipt.';
    default:
      return 'Everything stays on this device.';
  }
}

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  homePage: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: 28,
    paddingBottom: spacing.xxxl,
  },
  page: {
    flexGrow: 1,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  centeredPage: {
    flex: 1,
    justifyContent: 'center',
    padding: 28,
    alignItems: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  brandCopy: {
    flex: 1,
  },
  brandName: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 2.2,
  },
  brandTag: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 3,
  },
  heroTitle: {
    color: colors.text,
    ...typography.hero,
    maxWidth: 520,
  },
  eyebrow: {
    color: colors.primaryAlt,
    ...typography.label,
    letterSpacing: 1.4,
    marginTop: 14,
    marginBottom: 8,
  },
  pageTitle: {
    color: colors.text,
    ...typography.title,
  },
  bodyText: {
    color: colors.textMuted,
    ...typography.body,
    marginTop: spacing.md,
    maxWidth: 520,
  },
  centeredBody: {
    color: colors.textMuted,
    ...typography.body,
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 440,
  },
  scanCard: {
    marginTop: 28,
    backgroundColor: colors.primary,
    borderRadius: radii.xl,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    ...shadows.card,
  },
  importButton: {
    width: '100%',
    minHeight: 48,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  importButtonText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },
  historyCard: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    ...shadows.card,
  },
  historyCardIcon: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanIcon: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanCopy: {
    flex: 1,
  },
  scanPrimaryTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
  },
  scanPrimarySubtitle: {
    color: 'rgba(255,255,255,0.76)',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  cardSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 28,
  },
  foundationCard: {
    marginTop: spacing.lg,
    backgroundColor: colors.accentSoft,
    borderRadius: radii.lg,
    padding: 18,
    borderWidth: 1,
    borderColor: '#CFE0D6',
  },
  sectionLabel: {
    color: colors.primaryAlt,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  foundationTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    marginTop: 7,
  },
  foundationText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  resumeButton: {
    alignSelf: 'flex-start',
    minHeight: 42,
    justifyContent: 'center',
    marginTop: 14,
    paddingHorizontal: 14,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
  },
  resumeButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  primaryButton: {
    width: '100%',
    minHeight: 54,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    marginTop: 20,
    paddingHorizontal: 18,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryWideButton: {
    width: '100%',
    minHeight: 52,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    marginTop: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryWideButtonText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '800',
  },
  disabledButton: {
    opacity: 0.7,
  },
  errorCard: {
    marginTop: 16,
    borderRadius: radii.md,
    backgroundColor: colors.errorSoft,
    padding: 14,
  },
  errorCardText: {
    color: colors.error,
    fontSize: 13,
    lineHeight: 19,
  },
  successMark: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  successMarkText: {
    color: colors.success,
    fontSize: 30,
    fontWeight: '900',
  },
  processingIndicator: {
    marginTop: spacing.lg,
  },
  bootTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    marginTop: 14,
  },
  errorMark: {
    color: colors.error,
    fontSize: 34,
    fontWeight: '900',
  },
});
