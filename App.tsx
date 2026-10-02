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
import { ReceiptRepository } from './src/data/repositories/ReceiptRepository';
import type { Receipt } from './src/domain/receipt';
import { HistoryRepository } from './src/history/HistoryRepository';
import { HistoryScreen } from './src/history/HistoryScreen';
import { HistoryService, type HistoryOverview } from './src/history/HistoryService';
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
import { OcrProcessingService } from './src/ocr/OcrProcessingService';
import { ParserProcessingService } from './src/parser/ParserProcessingService';
import { ReceiptReviewScreen } from './src/review/ReceiptReviewScreen';
import { ReviewService } from './src/review/ReviewService';
import type { ReviewDraft, ReviewSession } from './src/review/types';

type BootState = 'loading' | 'ready' | 'error';
type AppScreen =
  | 'home'
  | 'capture-guide'
  | 'editing'
  | 'prepared'
  | 'ocr-processing'
  | 'ocr-result'
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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [preparedReceiptId, setPreparedReceiptId] = useState<string | null>(null);
  const [ocrRun, setOcrRun] = useState<StoredOcrRun | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [reviewSession, setReviewSession] = useState<ReviewSession | null>(null);
  const [pendingReceipts, setPendingReceipts] = useState<Receipt[]>([]);
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

    openRecoraDatabase()
      .then(async (database) => {
        if (!mounted) {
          return;
        }

        const pending = await new ReceiptRepository(database).listUnfinished();
        if (!mounted) {
          return;
        }

        setPendingReceipts(pending);
        setBootState('ready');

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
    };
  }, []);

  async function startCapture(
    action: () => Promise<CaptureResult>,
  ): Promise<void> {
    if (busy) {
      return;
    }

    setBusy(true);
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
      setBusy(false);
    }
  }

  function cancelEditing() {
    if (source) {
      removePrivateReceiptImage(source.uri);
    }
    setSource(null);
    setMessage(null);
    setScreen('capture-guide');
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
      setPendingReceipts(await repository.listUnfinished());

      if (source) {
        removePrivateReceiptImage(source.uri);
      }

      setSource(null);
      setPreparedReceiptId(receiptId);
      setOcrRun(null);
      setOcrError(null);
      setMessage(null);
      setScreen('prepared');
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
      });

      if (controller.signal.aborted) {
        return;
      }

      setOcrRun(run);
      await refreshPendingReceipts();
      setScreen('ocr-result');
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
    setScreen('history-loading');

    try {
      const service = await createHistoryService();
      const [overview, identities] = await Promise.all([
        service.loadOverview(),
        service.listNormalizedItems(),
      ]);
      setHistoryOverview(overview);
      setHistoryCategories(overview.categories);
      setNormalizedItems(identities);
      setScreen('history');
    } catch (error) {
      setHistoryError(
        messageFromError(error, 'Recora could not load local purchase history.'),
      );
      setScreen('history-error');
    }
  }

  async function searchHistory(
    filters: HistoryFilters,
  ): Promise<HistoryOverview> {
    const service = await createHistoryService();
    const overview = await service.loadOverview(filters);
    setHistoryOverview(overview);
    setHistoryCategories(overview.categories);
    return overview;
  }

  async function openReceiptDetail(receiptId: string): Promise<void> {
    setHistoryError(null);
    setScreen('receipt-detail-loading');

    try {
      const service = await createHistoryService();
      const [detail, identities] = await Promise.all([
        service.getReceiptDetail(receiptId),
        service.listNormalizedItems(),
      ]);

      if (!detail) {
        throw new Error('Accepted receipt could not be found.');
      }

      setReceiptDetail(detail);
      setNormalizedItems(identities);
      setScreen('receipt-detail');
    } catch (error) {
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
    setScreen('item-history-loading');

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

      setItemHistory(summary);
      setScreen('item-history');
    } catch (error) {
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

    const [detail, identities] = await Promise.all([
      service.getReceiptDetail(receiptDetail.receiptId),
      service.listNormalizedItems(),
    ]);

    if (!detail) {
      throw new Error('Saved receipt could not be reloaded after organizing the item.');
    }

    setReceiptDetail(detail);
    setNormalizedItems(identities);
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
    await openHistory();
  }

  async function openReview(receiptId: string): Promise<void> {
    setPreparedReceiptId(receiptId);
    setMessage(null);
    setScreen('review-loading');

    try {
      const service = await createReviewService();
      const session = await service.load(receiptId);
      setReviewSession(session);
      await refreshPendingReceipts();
      setScreen('review');
    } catch (error) {
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
    await refreshPendingReceipts();
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

    try {
      const history = await createHistoryService();
      await history.applyKnownRules(receiptId);
    } catch (error) {
      console.warn('Accepted receipt was saved, but local normalization rules could not be applied.', error);
    }

    setReviewSession(null);
    setPreparedReceiptId(null);
    setOcrRun(null);
    await refreshPendingReceipts();
    setScreen('saved');
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
    setOcrRun(null);
    setMessage(null);
    await refreshPendingReceipts();
    setScreen('home');
  }

  async function resumeReceipt(receipt: Receipt): Promise<void> {
    setPreparedReceiptId(receipt.id);
    setOcrRun(null);
    setMessage(null);

    if (receipt.status === 'review' || receipt.rawOcrText) {
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
          <Text style={styles.bootTitle}>Reconstructing receipt</Text>
          <Text style={styles.centeredBody}>
            Recora is rebuilding structured items from saved OCR evidence and
            checking the arithmetic before review.
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
          <Text style={styles.pageTitle}>Receipt saved.</Text>
          <Text style={styles.centeredBody}>
            The reviewed receipt is now part of local purchase history. Only the
            values you confirmed are used for tracking.
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
          <Text style={styles.bootTitle}>Loading local purchase history</Text>
          <Text style={styles.centeredBody}>
            Recora is reading reviewed receipts from the on-device database.
          </Text>
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

  if (screen === 'capture-guide') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.page}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setMessage(null);
              setScreen('home');
            }}
            style={styles.backButton}
          >
            <Text style={styles.backButtonText}>‹ Home</Text>
          </Pressable>

          <Text style={styles.eyebrow}>CAPTURE RECEIPT</Text>
          <Text style={styles.pageTitle}>Make the receipt easy to read.</Text>
          <Text style={styles.bodyText}>
            Recora keeps processing on your device. A clear image is the strongest
            input for reliable item reconstruction later.
          </Text>

          <View style={styles.guideCard}>
            <GuideStep number="1" title="Lay it flat">
              Avoid folds and steep angles. Keep the receipt as straight as practical.
            </GuideStep>
            <GuideStep number="2" title="Fill the frame">
              Include the store header, every item row, and the final total.
            </GuideStep>
            <GuideStep number="3" title="Protect small text">
              Use even light, avoid glare, and hold still until prices look sharp.
            </GuideStep>
          </View>

          {message ? <InlineError message={message} /> : null}

          <Pressable
            accessibilityRole="button"
            onPress={() => startCapture(captureReceiptWithCamera)}
            style={[styles.primaryButton, busy && styles.disabledButton]}
            disabled={busy}
          >
            {busy ? <ActivityIndicator color="#FFFFFF" /> : null}
            <Text style={styles.primaryButtonText}>
              {busy ? 'Opening camera…' : 'Take receipt photo'}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => startCapture(importReceiptFromLibrary)}
            style={styles.secondaryWideButton}
            disabled={busy}
          >
            <Text style={styles.secondaryWideButtonText}>Choose from photos</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === 'ocr-processing') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.centeredPage}>
          <ActivityIndicator size="large" />
          <Text style={styles.bootTitle}>Reading receipt on this device</Text>
          <Text style={styles.centeredBody}>
            Recora is running the bundled Latin OCR model locally. No network
            connection or remote OCR service is required.
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
          <Text style={styles.bootTitle}>Text recognition did not finish</Text>
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
              <Text style={styles.primaryButtonText}>Retry offline OCR</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => setScreen('prepared')}
            style={styles.secondaryWideButton}
          >
            <Text style={styles.secondaryWideButtonText}>Return to receipt draft</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (screen === 'ocr-result' && ocrRun) {
    const lineCount = ocrRun.observations.filter(
      (observation) => observation.kind === 'line',
    ).length;

    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.page}>
          <View style={styles.successMark}>
            <Text style={styles.successMarkText}>✓</Text>
          </View>
          <Text style={styles.eyebrow}>OFFLINE OCR COMPLETE</Text>
          <Text style={styles.pageTitle}>Receipt text captured with geometry.</Text>
          <Text style={styles.bodyText}>
            Recora preserved the raw recognized text and {lineCount} spatial text
            {lineCount === 1 ? ' line' : ' lines'} for reconstruction. This OCR
            engine does not expose confidence values, so Recora leaves OCR confidence
            unknown instead of inventing a score.
          </Text>

          <View style={styles.ocrTextCard}>
            <Text style={styles.sectionLabel}>RAW OCR EVIDENCE</Text>
            <Text selectable style={styles.ocrText}>
              {ocrRun.rawText.trim() || 'No text was recognized.'}
            </Text>
          </View>

          {preparedReceiptId ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => openReview(preparedReceiptId)}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Review reconstructed receipt</Text>
            </Pressable>
          ) : null}

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setOcrRun(null);
              setScreen('home');
            }}
            style={styles.secondaryWideButton}
          >
            <Text style={styles.secondaryWideButtonText}>Back to home</Text>
          </Pressable>
        </ScrollView>
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
          <Text style={styles.pageTitle}>Receipt image is ready.</Text>
          <Text style={styles.centeredBody}>
            The prepared image is stored privately on this device and linked to a
            local draft. The bundled Latin OCR model can now read it without an
            internet connection.
          </Text>
          {message ? <InlineError message={message} /> : null}
          {preparedReceiptId ? (
            <>
              <Text style={styles.referenceText}>Draft {preparedReceiptId}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => runOfflineOcr(preparedReceiptId)}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>Recognize text offline</Text>
              </Pressable>
            </>
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
      <ScrollView contentContainerStyle={styles.homePage}>
        <Text style={styles.brand}>RECORA</Text>
        <Text style={styles.heroTitle}>Your receipts, reconstructed locally.</Text>
        <Text style={styles.bodyText}>
          Capture a printed receipt and turn it into a structured purchase record
          without sending the receipt to a cloud service.
        </Text>

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setMessage(null);
            setScreen('capture-guide');
          }}
          style={styles.scanCard}
        >
          <View style={styles.scanIcon}>
            <Text style={styles.scanIconText}>+</Text>
          </View>
          <View style={styles.scanCopy}>
            <Text style={styles.scanTitle}>Scan a receipt</Text>
            <Text style={styles.scanSubtitle}>
              Photograph or import, crop, rotate, and check image quality.
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={openHistory}
          style={styles.historyCard}
        >
          <View style={styles.historyCardIcon}>
            <Text style={styles.historyCardIconText}>≡</Text>
          </View>
          <View style={styles.scanCopy}>
            <Text style={styles.scanTitle}>Purchase history</Text>
            <Text style={styles.scanSubtitle}>
              Search reviewed receipts and items, compare prior prices, and organize
              equivalent products without changing receipt evidence.
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        {pendingReceipts[0] ? (
          <View style={styles.foundationCard}>
            <Text style={styles.sectionLabel}>UNFINISHED RECEIPT</Text>
            <Text style={styles.foundationTitle}>
              {pendingReceipts[0].status === 'review'
                ? 'Continue receipt review'
                : pendingReceipts[0].rawOcrText
                  ? 'Review reconstructed receipt'
                  : 'Continue receipt processing'}
            </Text>
            <Text style={styles.foundationText}>
              Recora kept this draft locally so an interrupted scan or review does
              not become completed purchase history.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => resumeReceipt(pendingReceipts[0]!)}
              style={styles.resumeButton}
            >
              <Text style={styles.resumeButtonText}>Resume receipt</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.foundationCard}>
          <Text style={styles.sectionLabel}>CURRENT BUILD</Text>
          <Text style={styles.foundationTitle}>Local-first foundation active</Text>
          <Text style={styles.foundationText}>
            Receipt images and SQLite records stay in application-private storage.
            Internet access is not required for this capture workflow.
          </Text>
        </View>
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
            <ActivityIndicator />
            <Text style={styles.bootTitle}>Preparing local storage</Text>
            <Text style={styles.centeredBody}>
              Recora is applying its private on-device database schema.
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.errorMark}>!</Text>
            <Text style={styles.bootTitle}>Storage initialization failed</Text>
            <Text style={styles.centeredBody}>
              Recora stopped before creating purchase history. Restart the app and
              inspect the development logs.
            </Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function GuideStep({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: string;
}) {
  return (
    <View style={styles.guideStep}>
      <View style={styles.guideNumber}>
        <Text style={styles.guideNumberText}>{number}</Text>
      </View>
      <View style={styles.guideCopy}>
        <Text style={styles.guideTitle}>{title}</Text>
        <Text style={styles.guideText}>{children}</Text>
      </View>
    </View>
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

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F7F6F2',
  },
  homePage: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 40,
  },
  page: {
    flexGrow: 1,
    padding: 24,
    paddingBottom: 40,
  },
  centeredPage: {
    flex: 1,
    justifyContent: 'center',
    padding: 28,
    alignItems: 'center',
  },
  brand: {
    color: '#2D5145',
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 3,
    marginBottom: 22,
  },
  heroTitle: {
    color: '#1F2321',
    fontSize: 33,
    fontWeight: '800',
    lineHeight: 40,
    maxWidth: 520,
  },
  eyebrow: {
    color: '#3F6B5B',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.8,
    marginTop: 14,
    marginBottom: 8,
  },
  pageTitle: {
    color: '#1F2321',
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 34,
  },
  bodyText: {
    color: '#6F756F',
    fontSize: 15,
    lineHeight: 23,
    marginTop: 12,
  },
  centeredBody: {
    color: '#6F756F',
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
    marginTop: 12,
    maxWidth: 440,
  },
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },
  backButtonText: {
    color: '#3F6B5B',
    fontSize: 15,
    fontWeight: '700',
  },
  scanCard: {
    marginTop: 32,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E1DC',
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  historyCard: {
    marginTop: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E1DC',
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  historyCardIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#F0ECE2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyCardIconText: {
    color: '#6B5B3F',
    fontSize: 26,
    fontWeight: '700',
  },
  scanIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#E6EFEA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanIconText: {
    color: '#2D5145',
    fontSize: 30,
    fontWeight: '400',
    marginTop: -2,
  },
  scanCopy: {
    flex: 1,
  },
  scanTitle: {
    color: '#1F2321',
    fontSize: 17,
    fontWeight: '800',
  },
  scanSubtitle: {
    color: '#6F756F',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
  },
  chevron: {
    color: '#6F756F',
    fontSize: 28,
  },
  foundationCard: {
    marginTop: 18,
    backgroundColor: '#EEF3F0',
    borderRadius: 18,
    padding: 18,
  },
  sectionLabel: {
    color: '#3F6B5B',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  foundationTitle: {
    color: '#1F2321',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 7,
  },
  foundationText: {
    color: '#58605B',
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
    borderRadius: 11,
    backgroundColor: '#3F6B5B',
  },
  resumeButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  guideCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E1DC',
    padding: 18,
    marginTop: 24,
    gap: 18,
  },
  guideStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  guideNumber: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#E6EFEA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideNumberText: {
    color: '#2D5145',
    fontSize: 13,
    fontWeight: '900',
  },
  guideCopy: {
    flex: 1,
  },
  guideTitle: {
    color: '#1F2321',
    fontSize: 15,
    fontWeight: '800',
  },
  guideText: {
    color: '#6F756F',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 2,
  },
  primaryButton: {
    width: '100%',
    minHeight: 54,
    borderRadius: 14,
    backgroundColor: '#3F6B5B',
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
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#BFC5C0',
    backgroundColor: '#FFFFFF',
    marginTop: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryWideButtonText: {
    color: '#2D5145',
    fontSize: 15,
    fontWeight: '800',
  },
  disabledButton: {
    opacity: 0.7,
  },
  errorCard: {
    marginTop: 16,
    borderRadius: 14,
    backgroundColor: '#FBECEC',
    padding: 14,
  },
  errorCardText: {
    color: '#9A3030',
    fontSize: 13,
    lineHeight: 19,
  },
  successMark: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#E6EFEA',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  successMarkText: {
    color: '#2D5145',
    fontSize: 30,
    fontWeight: '900',
  },
  referenceText: {
    color: '#6F756F',
    fontSize: 11,
    marginTop: 16,
  },
  ocrTextCard: {
    marginTop: 22,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E1DC',
    backgroundColor: '#FFFFFF',
  },
  ocrText: {
    color: '#1F2321',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 10,
    fontFamily: 'monospace',
  },
  bootTitle: {
    color: '#1F2321',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 14,
  },
  errorMark: {
    color: '#C94A4A',
    fontSize: 34,
    fontWeight: '900',
  },
});
