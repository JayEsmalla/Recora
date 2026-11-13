import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from 'react-native-safe-area-context';

import {
  captureReceiptWithCamera,
  importReceiptFromLibrary,
  MAX_RECEIPT_PHOTOS,
  recoverPendingImagePickerResult,
  type CaptureResult,
} from './src/capture/CaptureService';
import { ReceiptImageEditor } from './src/capture/ReceiptImageEditor';
import {
  clearStagedReceiptImages,
  pruneOrphanedReceiptImages,
  removePrivateReceiptImage,
  retainPreparedReceiptImage,
  finishRetainingReceiptImage,
} from './src/capture/ReceiptImageStore';
import type {
  PreparedReceiptImage,
  ReceiptImageSource,
} from './src/capture/types';
import { openRecoraDatabase } from './src/data/database/openDatabase';
import { recordLocalFailure } from './src/data/LocalDiagnostics';
import {
  OcrRepository,
  type StoredOcrRun,
} from './src/data/repositories/OcrRepository';
import {
  ReceiptRepository,
  type UnfinishedReceiptSummary,
} from './src/data/repositories/ReceiptRepository';
import { HistoryRepository } from './src/history/HistoryRepository';
import { HistoryScreen, type HistoryViewState } from './src/history/HistoryScreen';
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
import { responsiveLayout } from './src/ui/responsiveLayout';

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
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <RecoraApp />
    </SafeAreaProvider>
  );
}

function RecoraApp() {
  const dimensions = useWindowDimensions();
  const layout = responsiveLayout(dimensions.width, dimensions.height, dimensions.fontScale);
  const [bootState, setBootState] = useState<BootState>('loading');
  const [screen, setScreen] = useState<AppScreen>('home');
  const [source, setSource] = useState<ReceiptImageSource | null>(null);
  const [queuedSources, setQueuedSources] = useState<ReceiptImageSource[]>([]);
  const [preparedPageCount, setPreparedPageCount] = useState(0);
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
  const [historyViewState, setHistoryViewState] = useState<HistoryViewState | null>(null);
  const [itemHistoryBackTarget, setItemHistoryBackTarget] = useState<'history' | 'receipt-detail'>('history');
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
          recordLocalFailure('cleanup', error);
        }

        setPendingReceipts(pending);
        setBootState('ready');

        // Optional post-accept organization is durable, bounded, and retried
        // after restart without delaying the first usable screen.
        void createHistoryService()
          .then((service) => service.processPendingMaintenance(5))
          .catch((error) => {
            recordLocalFailure('maintenance', error);
          });

        cleanupTimer = setTimeout(() => {
          if (!mounted) {
            return;
          }

          void repository
            .listImageUris()
            .then(async () => {
              // Refresh immediately before a synchronous prune. An older
              // reference snapshot can otherwise delete a newly saved page.
              const currentUris = await repository.listImageUris();
              if (mounted) {
                pruneOrphanedReceiptImages(currentUris);
              }
            })
            .catch((error) => {
              recordLocalFailure('cleanup', error);
            });
        }, 250);

        if (!recoveryAttempted.current) {
          recoveryAttempted.current = true;
          const recovered = await recoverPendingImagePickerResult();
          if (mounted && recovered?.status === 'captured') {
            setPreparedReceiptId(null);
            setPreparedPageCount(0);
            setSource(recovered.images[0] ?? null);
            setQueuedSources(recovered.images.slice(1));
            setScreen('editing');
          }
        }
      })
      .catch((error) => {
        recordLocalFailure('startup', error);
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

    if (screen === 'home') {
      setPreparedReceiptId(null);
      setPreparedPageCount(0);
      setQueuedSources([]);
    }

    setCaptureAction(sourceKind);
    setMessage(null);
    try {
      const result = await action();

      if (result.status === 'captured') {
        const remaining = MAX_RECEIPT_PHOTOS - preparedPageCount;

        if (result.images.length > remaining) {
          for (const image of result.images) {
            removePrivateReceiptImage(image.uri);
          }
          setMessage(
            `One receipt can contain up to ${MAX_RECEIPT_PHOTOS} photos. ` +
              `You can add ${remaining} more.`,
          );
          return;
        }

        setSource(result.images[0] ?? null);
        setQueuedSources(result.images.slice(1));
        setScreen('editing');
        return;
      }

      if (result.status === 'permission-denied') {
        setMessage(
          result.source === 'camera'
            ? 'Camera permission is required to photograph a receipt. You can still import existing photos.'
            : 'Photo access is required to import receipt images.',
        );
      }
    } catch (error) {
      setMessage(messageFromError(error, 'Recora could not open these receipt photos.'));
    } finally {
      setCaptureAction(null);
    }
  }

  function cancelEditing() {
    if (source) {
      removePrivateReceiptImage(source.uri);
    }
    for (const queued of queuedSources) {
      removePrivateReceiptImage(queued.uri);
    }

    setSource(null);
    setQueuedSources([]);
    setMessage(null);
    setScreen(preparedReceiptId ? 'prepared' : 'home');
  }

  async function savePreparedPage(image: PreparedReceiptImage) {
    const receiptId = preparedReceiptId ?? createReceiptId();
    let retained: PreparedReceiptImage | null = null;

    try {
      const database = await openRecoraDatabase();
      const repository = new ReceiptRepository(database);
      const existingPages = preparedReceiptId
        ? await repository.listPages(receiptId)
        : [];
      const pagePosition = existingPages.length;

      if (pagePosition >= MAX_RECEIPT_PHOTOS) {
        throw new Error(
          `A receipt can contain at most ${MAX_RECEIPT_PHOTOS} photos.`,
        );
      }

      retained = await retainPreparedReceiptImage(
        image,
        receiptId,
        pagePosition,
      );
      const now = new Date().toISOString();

      if (pagePosition === 0) {
        await repository.createDraft({
          id: receiptId,
          imageUri: retained.uri,
          imageWidth: retained.width,
          imageHeight: retained.height,
          now,
        });
      } else {
        await repository.addPage({
          receiptId,
          imageUri: retained.uri,
          imageWidth: retained.width,
          imageHeight: retained.height,
          now,
        });
      }

      finishRetainingReceiptImage(retained.uri);

      const nextPageCount = pagePosition + 1;
      const [nextSource, ...remainingQueue] = queuedSources;

      setPreparedReceiptId(receiptId);
      setPreparedPageCount(nextPageCount);
      setOcrError(null);
      setMessage(null);
      setQueuedSources(remainingQueue);

      void refreshPendingReceipts().catch((error) => {
        recordLocalFailure('capture', error);
      });

      if (nextSource) {
        setSource(nextSource);
        setScreen('editing');
      } else {
        setSource(null);
        setScreen('prepared');
      }
    } catch (error) {
      if (retained) {
        removePrivateReceiptImage(retained.uri);
        finishRetainingReceiptImage(retained.uri);
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
        recordLocalFailure('ocr', error);
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

    setHistoryViewState(null);
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
          recordLocalFailure('history', error);
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
    setItemHistoryBackTarget(screen === 'receipt-detail' ? 'receipt-detail' : 'history');
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
        recordLocalFailure('history', error);
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
    const imageUris = await service.deleteReceipt(receiptDetail.receiptId);
    for (const imageUri of imageUris ?? []) {
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
        recordLocalFailure('review', error);
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
      recordLocalFailure('review', error);
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
    setPreparedPageCount(0);
    setHistoryOverview(null);
    setScreen('saved');

    // The accepted receipt is already durable. Merchant-specific organization
    // is helpful but should never hold the user on a save spinner.
    void createHistoryService()
      .then((history) => history.applyKnownRules(receiptId))
      .catch((error) => {
        recordLocalFailure('maintenance', error);
      });

    void refreshPendingReceipts().catch((error) => {
      recordLocalFailure('review', error);
    });
  }

  async function discardReviewedReceipt(): Promise<void> {
    const receiptId = reviewSession?.receipt.id ?? preparedReceiptId;
    if (!receiptId) {
      throw new Error('No active receipt review was found.');
    }

    const service = await createReviewService();
    const imageUris = await service.discard(receiptId);
    for (const imageUri of imageUris ?? []) {
      removePrivateReceiptImage(imageUri);
    }

    setReviewSession(null);
    setPreparedReceiptId(null);
    setPreparedPageCount(0);
    setMessage(null);
    setScreen('home');
    void refreshPendingReceipts().catch((error) => {
      recordLocalFailure('review', error);
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

    const database = await openRecoraDatabase();
    const repository = new ReceiptRepository(database);
    setPreparedPageCount((await repository.listPages(receipt.id)).length);
    setScreen('prepared');
  }

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'review') {
        // Review owns its Back handler, which saves the current draft first.
        return false;
      }
      if (screen === 'editing') {
        cancelEditing();
        return true;
      }
      if (screen === 'ocr-processing') {
        cancelOfflineOcr();
        return true;
      }
      if (screen === 'item-history') {
        if (itemHistoryBackTarget === 'receipt-detail' && receiptDetail) {
          setScreen('receipt-detail');
        } else {
          void openHistory();
        }
        return true;
      }
      if (screen === 'receipt-detail') {
        void openHistory();
        return true;
      }
      if (screen === 'history' || screen === 'prepared' ||
          screen === 'saved' || screen === 'review-error' ||
          screen === 'ocr-error' || screen === 'history-error') {
        setScreen('home');
        return true;
      }
      if (screen === 'home') {
        return false;
      }
      // Avoid accidental app exit while a local operation is running.
      return true;
    });
    return () => subscription.remove();
  });

  if (bootState !== 'ready') {
    return <BootScreen state={bootState} />;
  }

  if (screen === 'editing' && source) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <ReceiptImageEditor
          key={source.uri}
          source={source}
          pageNumber={preparedPageCount + 1}
          totalPages={
            preparedPageCount + 1 + queuedSources.length
          }
          onCancel={cancelEditing}
          onReady={savePreparedPage}
        />
      </SafeAreaView>
    );
  }

  if (screen === 'review-loading') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <ScrollView style={styles.screen} contentContainerStyle={styles.centeredPage} showsVerticalScrollIndicator={false}>
          <ActivityIndicator size="large" />
          <Text style={styles.bootTitle}>Building your receipt</Text>
          <Text style={styles.centeredBody}>
            Organizing items and checking totals.
          </Text>
        </ScrollView>
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
          onBack={() => {
            setReviewSession(null);
            setPreparedReceiptId(null);
            setPreparedPageCount(0);
            setScreen('home');
          }}
        />
      </SafeAreaView>
    );
  }

  if (screen === 'review-error') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <ScrollView style={styles.screen} contentContainerStyle={styles.centeredPage} showsVerticalScrollIndicator={false}>
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
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === 'saved') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <ScrollView style={styles.screen} contentContainerStyle={styles.centeredPage} showsVerticalScrollIndicator={false}>
          <View style={styles.successMark}>
            <Text style={styles.successMarkText}>✓</Text>
          </View>
          <Text style={styles.pageTitle}>Receipt saved!</Text>
          <Text style={styles.centeredBody}>
            You can find this receipt anytime in Purchase history.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={openHistory}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>View purchase history</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setScreen('home')}
            style={styles.secondaryWideButton}
          >
            <Text style={styles.secondaryWideButtonText}>Back to home</Text>
          </Pressable>
        </ScrollView>
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
        <ScrollView style={styles.screen} contentContainerStyle={styles.centeredPage} showsVerticalScrollIndicator={false}>
          <ActivityIndicator size="large" />
          <Text style={styles.bootTitle}>Opening purchase history</Text>
          <Text style={styles.centeredBody}>Loading reviewed receipts.</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === 'history-error') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <ScrollView style={styles.screen} contentContainerStyle={styles.centeredPage} showsVerticalScrollIndicator={false}>
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
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === 'history' && historyOverview) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <HistoryScreen
          initialOverview={historyOverview}
          initialViewState={historyViewState}
          onSaveViewState={setHistoryViewState}
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
          onBack={() => {
            if (itemHistoryBackTarget === 'receipt-detail' && receiptDetail) {
              setScreen('receipt-detail');
            } else {
              void openHistory();
            }
          }}
        />
      </SafeAreaView>
    );
  }

  if (screen === 'ocr-processing') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <ScrollView style={styles.screen} contentContainerStyle={styles.centeredPage} showsVerticalScrollIndicator={false}>
          <BrandMark size={72} />
          <ActivityIndicator
            color={colors.primary}
            size="small"
            style={styles.processingIndicator}
          />
          <Text style={styles.bootTitle}>
            {ocrProgressTitle(ocrProgress)}
          </Text>
          <Text style={styles.centeredBody}>
            {ocrProgressMessage(ocrProgress)}
          </Text>

          <Pressable
            accessibilityRole="button"
            onPress={cancelOfflineOcr}
            style={styles.secondaryWideButton}
          >
            <Text style={styles.secondaryWideButtonText}>Cancel recognition</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === 'ocr-error') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <ScrollView style={styles.screen} contentContainerStyle={styles.centeredPage} showsVerticalScrollIndicator={false}>
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
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === 'prepared') {
    const remainingPhotos = MAX_RECEIPT_PHOTOS - preparedPageCount;

    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <ScrollView style={styles.screen} contentContainerStyle={styles.centeredPage} showsVerticalScrollIndicator={false}>
          <View style={styles.successMark}>
            <Ionicons name="images-outline" size={28} color={colors.success} />
          </View>
          <Text style={styles.pageTitle}>
            {preparedPageCount} {preparedPageCount === 1 ? 'photo' : 'photos'} ready
          </Text>
          <Text style={styles.centeredBody}>
            {remainingPhotos > 0
              ? 'Missing part of a long receipt? Add the next photo in order. Otherwise, tap Read receipt below.'
              : 'All 5 photos are ready. Tap Read receipt to continue.'}
          </Text>

          <View style={styles.pageCountRow}>
            {Array.from({ length: MAX_RECEIPT_PHOTOS }, (_, index) => (
              <View
                key={index}
                style={[
                  styles.pageDot,
                  index < preparedPageCount && styles.pageDotFilled,
                ]}
              />
            ))}
          </View>

          {message ? <InlineError message={message} /> : null}

          {remainingPhotos > 0 ? (
            <View style={[styles.addPhotoRow, layout.stackActionButtons && styles.addPhotoStack]}>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  startCapture('camera', captureReceiptWithCamera)
                }
                style={styles.addPhotoButton}
                disabled={captureAction !== null}
              >
                <Ionicons
                  name="camera-outline"
                  size={20}
                  color={colors.primary}
                />
                <Text style={styles.addPhotoButtonText}>Take next photo</Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  startCapture('library', () =>
                    importReceiptFromLibrary(remainingPhotos),
                  )
                }
                style={styles.addPhotoButton}
                disabled={captureAction !== null}
              >
                <Ionicons
                  name="images-outline"
                  size={20}
                  color={colors.primary}
                />
                <Text style={styles.addPhotoButtonText}>Add from photos</Text>
              </Pressable>
            </View>
          ) : null}

          {preparedReceiptId ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => runOfflineOcr(preparedReceiptId)}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>
                Read receipt
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setPreparedReceiptId(null);
              setPreparedPageCount(0);
              setQueuedSources([]);
              setMessage(null);
              setScreen('home');
            }}
            style={styles.secondaryWideButton}
          >
            <Text style={styles.secondaryWideButtonText}>Finish later (save draft)</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={[styles.homePage, { paddingHorizontal: layout.horizontalPadding }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brandRow}>
          <BrandMark size={layout.veryCompact ? 66 : 86} />
          <View style={styles.brandCopy}>
            <Text style={styles.brandName}>RECORA</Text>
            <Text style={styles.brandTag}>Private receipt organizer</Text>
          </View>
        </View>

        <Text style={styles.heroTitle}>Remember every purchase.</Text>
        <Text style={styles.bodyText}>
          Take a photo of your receipt, check the details, and save it to find later.
          No internet needed.
        </Text>

        <Pressable
          accessibilityRole="button"
          onPress={() =>
            startCapture('camera', captureReceiptWithCamera)
          }
          style={({ pressed }) => [
            styles.scanCard,
            pressed && styles.pressedAction,
            captureAction !== null && styles.disabledButton,
          ]}
          disabled={captureAction !== null}
        >
          <View style={styles.scanIcon}>
            <Ionicons name="camera-outline" size={25} color="#FFFFFF" />
          </View>
          <View style={styles.scanCopy}>
            <Text style={styles.scanPrimaryTitle}>
              {captureAction === 'camera' ? 'Opening camera…' : 'Take receipt photo'}
            </Text>
            <Text style={styles.scanPrimarySubtitle}>
              Start with one photo. Add more if needed.
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
          style={({ pressed }) => [
            styles.importButton,
            pressed && styles.pressedAction,
            captureAction !== null && styles.disabledButton,
          ]}
          disabled={captureAction !== null}
        >
          <Ionicons name="image-outline" size={19} color={colors.primary} />
          <Text style={styles.importButtonText}>
            {captureAction === 'library'
              ? 'Opening photos…'
              : 'Choose photos from phone'}
          </Text>
        </Pressable>

        {message ? <InlineError message={message} /> : null}

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
              style={({ pressed }) => [styles.resumeButton, pressed && styles.pressedAction]}
            >
              <Text style={styles.resumeButtonText}>Resume receipt</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={openHistory}
          style={({ pressed }) => [styles.historyCard, pressed && styles.pressedAction]}
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
              Find saved receipts, items, and prices
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={22}
            color={colors.textMuted}
          />
        </Pressable>

      </ScrollView>
    </SafeAreaView>
  );
}

function BootScreen({ state }: { state: BootState }) {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView style={styles.screen} contentContainerStyle={styles.centeredPage} showsVerticalScrollIndicator={false}>
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
      </ScrollView>
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
  progress: OcrProgressEvent | null,
): string {
  if (
    progress?.stage === 'recognizing-text' &&
    progress.pageCount &&
    progress.pageCount > 1 &&
    progress.pageIndex !== undefined
  ) {
    return `Reading photo ${progress.pageIndex + 1} of ${progress.pageCount}`;
  }

  switch (progress?.stage) {
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
  progress: OcrProgressEvent | null,
): string {
  if (
    progress?.stage === 'recognizing-text' &&
    progress.pageCount &&
    progress.pageCount > 1
  ) {
    return 'Reading each photo separately to keep long-receipt processing memory-safe.';
  }

  switch (progress?.stage) {
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
    flexGrow: 1,
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
    minWidth: 0,
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
    minWidth: 0,
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
  pageCountRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 18,
  },
  pageDot: {
    width: 28,
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.border,
  },
  pageDotFilled: {
    backgroundColor: colors.primary,
  },
  addPhotoStack: { flexDirection: 'column' },
  addPhotoRow: {
    width: '100%',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 18,
  },
  addPhotoButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  addPhotoButtonText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
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
    paddingHorizontal: 12,
    paddingVertical: 10,
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
  pressedAction: { opacity: 0.78 },
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
