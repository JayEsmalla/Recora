import {
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  ActivityIndicator,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { assessReceiptImageQuality } from './ImageQualityGate';
import {
  adjustCropCorner,
  FULL_IMAGE_CROP,
  type CropCorner,
} from './imageGeometry';
import {
  prepareReceiptImage,
  rotateReceiptImage,
} from './ImagePreprocessor';
import type {
  ManualQualityChecks,
  NormalizedCrop,
  PreparedReceiptImage,
  QualityIssue,
  ReceiptImageSource,
} from './types';

interface ReceiptImageEditorProps {
  source: ReceiptImageSource;
  onCancel: () => void;
  onReady: (image: PreparedReceiptImage) => Promise<void> | void;
}

interface DisplayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const HANDLE_SIZE = 30;

export function ReceiptImageEditor({
  source,
  onCancel,
  onReady,
}: ReceiptImageEditorProps) {
  const [image, setImage] = useState(source);
  const [crop, setCrop] = useState<NormalizedCrop>(FULL_IMAGE_CROP);
  const [container, setContainer] = useState({ width: 0, height: 0 });
  const [checks, setChecks] = useState<ManualQualityChecks>({
    sharpText: false,
    evenLighting: false,
    fullyVisible: false,
  });
  const [issues, setIssues] = useState<QualityIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const display = useMemo(
    () => containRect(container.width, container.height, image.width, image.height),
    [container.height, container.width, image.height, image.width],
  );

  const topLeft = useCropPanResponder('top-left', crop, display, setCrop);
  const topRight = useCropPanResponder('top-right', crop, display, setCrop);
  const bottomLeft = useCropPanResponder('bottom-left', crop, display, setCrop);
  const bottomRight = useCropPanResponder('bottom-right', crop, display, setCrop);

  const cropBox = display
    ? {
        left: display.x + crop.left * display.width,
        top: display.y + crop.top * display.height,
        width: (crop.right - crop.left) * display.width,
        height: (crop.bottom - crop.top) * display.height,
      }
    : null;

  function handleLayout(event: LayoutChangeEvent) {
    setContainer({
      width: event.nativeEvent.layout.width,
      height: event.nativeEvent.layout.height,
    });
  }

  async function rotate(degrees: 90 | -90) {
    if (busy) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const rotated = await rotateReceiptImage(image, degrees);
      setImage(rotated);
      setCrop(FULL_IMAGE_CROP);
      setIssues([]);
    } catch (cause) {
      setError(messageFromError(cause, 'Could not rotate this receipt image.'));
    } finally {
      setBusy(false);
    }
  }

  async function prepare() {
    if (busy) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const prepared = await prepareReceiptImage(image, { crop });
      const assessment = assessReceiptImageQuality(prepared, checks);
      setIssues(assessment.issues);

      if (!assessment.canContinue) {
        return;
      }

      await onReady(prepared);
    } catch (cause) {
      setError(messageFromError(cause, 'Could not prepare this receipt image.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      bounces={false}
    >
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>PREPARE RECEIPT</Text>
          <Text style={styles.title}>Keep only the readable receipt.</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel receipt editing"
          onPress={onCancel}
          style={styles.linkButton}
          disabled={busy}
        >
          <Text style={styles.linkButtonText}>Cancel</Text>
        </Pressable>
      </View>

      <Text style={styles.instructions}>
        Drag the four corners around the full receipt. Keep the store name, every item,
        and the final total inside the frame.
      </Text>

      <View style={styles.imageStage} onLayout={handleLayout}>
        <Image source={{ uri: image.uri }} style={styles.image} resizeMode="contain" />
        {cropBox ? (
          <>
            <View
              pointerEvents="none"
              style={[
                styles.cropBox,
                {
                  left: cropBox.left,
                  top: cropBox.top,
                  width: cropBox.width,
                  height: cropBox.height,
                },
              ]}
            />
            <CropHandle
              x={cropBox.left}
              y={cropBox.top}
              responder={topLeft.panHandlers}
              label="Move top left crop corner"
            />
            <CropHandle
              x={cropBox.left + cropBox.width}
              y={cropBox.top}
              responder={topRight.panHandlers}
              label="Move top right crop corner"
            />
            <CropHandle
              x={cropBox.left}
              y={cropBox.top + cropBox.height}
              responder={bottomLeft.panHandlers}
              label="Move bottom left crop corner"
            />
            <CropHandle
              x={cropBox.left + cropBox.width}
              y={cropBox.top + cropBox.height}
              responder={bottomRight.panHandlers}
              label="Move bottom right crop corner"
            />
          </>
        ) : null}
      </View>

      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          onPress={() => rotate(-90)}
          style={styles.secondaryButton}
          disabled={busy}
        >
          <Text style={styles.secondaryButtonText}>Rotate left</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setCrop(FULL_IMAGE_CROP);
            setIssues([]);
          }}
          style={styles.secondaryButton}
          disabled={busy}
        >
          <Text style={styles.secondaryButtonText}>Reset crop</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => rotate(90)}
          style={styles.secondaryButton}
          disabled={busy}
        >
          <Text style={styles.secondaryButtonText}>Rotate right</Text>
        </Pressable>
      </View>

      <View style={styles.checkCard}>
        <Text style={styles.sectionTitle}>Photo check</Text>
        <Text style={styles.sectionHint}>
          Confirm what the app cannot safely infer from pixels alone. These checks
          keep visibly unreadable images from being treated as reliable input.
        </Text>
        <QualityCheck
          checked={checks.sharpText}
          label="Item names and prices look sharp"
          onPress={() =>
            setChecks((current) => ({ ...current, sharpText: !current.sharpText }))
          }
        />
        <QualityCheck
          checked={checks.evenLighting}
          label="Printed text is not hidden by glare or dark shadow"
          onPress={() =>
            setChecks((current) => ({
              ...current,
              evenLighting: !current.evenLighting,
            }))
          }
        />
        <QualityCheck
          checked={checks.fullyVisible}
          label="Store header, item rows, and final total are all visible"
          onPress={() =>
            setChecks((current) => ({
              ...current,
              fullyVisible: !current.fullyVisible,
            }))
          }
        />
      </View>

      {issues.length > 0 ? (
        <View style={styles.issueCard}>
          <Text style={styles.sectionTitle}>Image review</Text>
          {issues.map((issue) => (
            <View key={issue.code} style={styles.issueRow}>
              <Text
                style={
                  issue.severity === 'blocker' ? styles.blockerMark : styles.warningMark
                }
              >
                {issue.severity === 'blocker' ? '!' : 'i'}
              </Text>
              <Text style={styles.issueText}>{issue.message}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Prepare receipt for offline text recognition"
        onPress={prepare}
        style={[styles.primaryButton, busy && styles.disabledButton]}
        disabled={busy}
      >
        {busy ? <ActivityIndicator color="#FFFFFF" /> : null}
        <Text style={styles.primaryButtonText}>
          {busy ? 'Preparing receipt…' : 'Prepare for text recognition'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function QualityCheck({
  checked,
  label,
  onPress,
}: {
  checked: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onPress}
      style={styles.checkRow}
    >
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        <Text style={styles.checkboxText}>{checked ? '✓' : ''}</Text>
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

function CropHandle({
  x,
  y,
  responder,
  label,
}: {
  x: number;
  y: number;
  responder: ReturnType<typeof PanResponder.create>['panHandlers'];
  label: string;
}) {
  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      {...responder}
      style={[
        styles.cropHandle,
        {
          left: x - HANDLE_SIZE / 2,
          top: y - HANDLE_SIZE / 2,
        },
      ]}
    />
  );
}

function useCropPanResponder(
  corner: CropCorner,
  crop: NormalizedCrop,
  display: DisplayRect | null,
  setCrop: Dispatch<SetStateAction<NormalizedCrop>>,
) {
  return useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderMove: (_event, gesture) => {
          if (!display || display.width <= 0 || display.height <= 0) {
            return;
          }

          setCrop(
            adjustCropCorner(
              crop,
              corner,
              gesture.dx / display.width,
              gesture.dy / display.height,
            ),
          );
        },
      }),
    [corner, crop, display, setCrop],
  );
}

function containRect(
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number,
): DisplayRect | null {
  if (
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    return null;
  }

  const imageAspect = imageWidth / imageHeight;
  const containerAspect = containerWidth / containerHeight;

  if (imageAspect > containerAspect) {
    const width = containerWidth;
    const height = width / imageAspect;
    return {
      x: 0,
      y: (containerHeight - height) / 2,
      width,
      height,
    };
  }

  const height = containerHeight;
  const width = height * imageAspect;
  return {
    x: (containerWidth - width) / 2,
    y: 0,
    width,
    height,
  };
}

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F7F6F2',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  headerText: {
    flex: 1,
  },
  eyebrow: {
    color: '#3F6B5B',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.8,
    marginBottom: 8,
  },
  title: {
    color: '#1F2321',
    fontSize: 25,
    fontWeight: '800',
    lineHeight: 31,
  },
  instructions: {
    color: '#6F756F',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
    marginBottom: 16,
  },
  linkButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  linkButtonText: {
    color: '#3F6B5B',
    fontWeight: '700',
  },
  imageStage: {
    height: 430,
    overflow: 'hidden',
    backgroundColor: '#1F2321',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E1DC',
  },
  image: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  cropBox: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: 'transparent',
  },
  cropHandle: {
    position: 'absolute',
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    backgroundColor: '#FFFFFF',
    borderColor: '#3F6B5B',
    borderWidth: 4,
  },
  toolbar: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#C9CBC7',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  secondaryButtonText: {
    color: '#2D5145',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  checkCard: {
    marginTop: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E1DC',
    padding: 16,
  },
  sectionTitle: {
    color: '#1F2321',
    fontSize: 16,
    fontWeight: '800',
  },
  sectionHint: {
    color: '#6F756F',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
    marginBottom: 8,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    gap: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: '#A9AEA9',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#3F6B5B',
    borderColor: '#3F6B5B',
  },
  checkboxText: {
    color: '#FFFFFF',
    fontWeight: '900',
  },
  checkLabel: {
    flex: 1,
    color: '#1F2321',
    fontSize: 14,
    lineHeight: 20,
  },
  issueCard: {
    marginTop: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E1DC',
    padding: 16,
    gap: 10,
  },
  issueRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  blockerMark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    textAlign: 'center',
    color: '#FFFFFF',
    backgroundColor: '#C94A4A',
    fontWeight: '900',
    lineHeight: 22,
  },
  warningMark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    textAlign: 'center',
    color: '#1F2321',
    backgroundColor: '#EFCB8C',
    fontWeight: '900',
    lineHeight: 22,
  },
  issueText: {
    flex: 1,
    color: '#4B504C',
    fontSize: 13,
    lineHeight: 19,
  },
  errorCard: {
    marginTop: 14,
    borderRadius: 14,
    backgroundColor: '#FBECEC',
    padding: 14,
  },
  errorText: {
    color: '#9A3030',
    fontSize: 13,
    lineHeight: 19,
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: 14,
    backgroundColor: '#3F6B5B',
    marginTop: 18,
    paddingHorizontal: 18,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledButton: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
});
