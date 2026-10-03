import {
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
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
import { removePrivateReceiptImage } from './ReceiptImageStore';
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
import { colors, radii, shadows, spacing, typography } from '../ui/theme';

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
    readableAndComplete: false,
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
      const previousUri = image.uri;
      const rotated = await rotateReceiptImage(image, degrees);
      setImage(rotated);
      setCrop(FULL_IMAGE_CROP);
      setIssues([]);

      if (previousUri !== rotated.uri) {
        removePrivateReceiptImage(previousUri);
      }
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
    let prepared: PreparedReceiptImage | null = null;

    try {
      prepared = await prepareReceiptImage(image, { crop });
      const assessment = assessReceiptImageQuality(prepared, checks);
      setIssues(assessment.issues);

      if (!assessment.canContinue) {
        if (prepared.uri !== image.uri) {
          removePrivateReceiptImage(prepared.uri);
        }
        return;
      }

      await onReady(prepared);

      if (prepared.uri !== image.uri) {
        removePrivateReceiptImage(prepared.uri);
      }
      removePrivateReceiptImage(image.uri);
    } catch (cause) {
      if (prepared && prepared.uri !== image.uri) {
        removePrivateReceiptImage(prepared.uri);
      }
      setError(messageFromError(cause, 'Could not prepare this receipt image.'));
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    removePrivateReceiptImage(image.uri);
    onCancel();
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      bounces={false}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>PREPARE</Text>
          <Text style={styles.title}>Frame the receipt</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel receipt editing"
          onPress={cancel}
          style={styles.linkButton}
          disabled={busy}
        >
          <Text style={styles.linkButtonText}>Cancel</Text>
        </Pressable>
      </View>

      <Text style={styles.instructions}>
        Keep the header, every item, and the final total inside the crop.
      </Text>

      <View style={styles.imageStage} onLayout={handleLayout}>
        <Image
          accessibilityLabel="Receipt image being cropped"
          source={{ uri: image.uri }}
          style={styles.image}
          resizeMode="contain"
        />
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
              onAccessibilityMove={(direction) =>
                setCrop(adjustCropForAccessibility(crop, 'top-left', direction))
              }
            />
            <CropHandle
              x={cropBox.left + cropBox.width}
              y={cropBox.top}
              responder={topRight.panHandlers}
              label="Move top right crop corner"
              onAccessibilityMove={(direction) =>
                setCrop(adjustCropForAccessibility(crop, 'top-right', direction))
              }
            />
            <CropHandle
              x={cropBox.left}
              y={cropBox.top + cropBox.height}
              responder={bottomLeft.panHandlers}
              label="Move bottom left crop corner"
              onAccessibilityMove={(direction) =>
                setCrop(adjustCropForAccessibility(crop, 'bottom-left', direction))
              }
            />
            <CropHandle
              x={cropBox.left + cropBox.width}
              y={cropBox.top + cropBox.height}
              responder={bottomRight.panHandlers}
              label="Move bottom right crop corner"
              onAccessibilityMove={(direction) =>
                setCrop(adjustCropForAccessibility(crop, 'bottom-right', direction))
              }
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
          <View style={styles.toolbarButtonContent}>
            <Ionicons name="arrow-undo-outline" size={17} color={colors.primary} />
            <Text style={styles.secondaryButtonText}>Left</Text>
          </View>
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
          <View style={styles.toolbarButtonContent}>
            <Ionicons name="scan-outline" size={17} color={colors.primary} />
            <Text style={styles.secondaryButtonText}>Reset</Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => rotate(90)}
          style={styles.secondaryButton}
          disabled={busy}
        >
          <View style={styles.toolbarButtonContent}>
            <Ionicons name="arrow-redo-outline" size={17} color={colors.primary} />
            <Text style={styles.secondaryButtonText}>Right</Text>
          </View>
        </Pressable>
      </View>

      <View style={styles.checkCard}>
        <Text style={styles.sectionTitle}>Ready to read?</Text>
        <QualityCheck
          checked={checks.readableAndComplete}
          label="Text is readable and the complete receipt is visible"
          onPress={() =>
            setChecks((current) => ({
              readableAndComplete: !current.readableAndComplete,
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
        accessibilityLabel="Continue with this prepared receipt"
        onPress={prepare}
        style={[styles.primaryButton, busy && styles.disabledButton]}
        disabled={busy}
      >
        {busy ? <ActivityIndicator color="#FFFFFF" /> : null}
        <Text style={styles.primaryButtonText}>
          {busy ? 'Preparing…' : 'Use this receipt'}
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
  onAccessibilityMove,
}: {
  x: number;
  y: number;
  responder: ReturnType<typeof PanResponder.create>['panHandlers'];
  label: string;
  onAccessibilityMove: (
    direction: 'left' | 'right' | 'up' | 'down',
  ) => void;
}) {
  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityHint="Use the available accessibility actions to move this crop corner."
      accessibilityActions={[
        { name: 'move-left', label: 'Move left' },
        { name: 'move-right', label: 'Move right' },
        { name: 'move-up', label: 'Move up' },
        { name: 'move-down', label: 'Move down' },
      ]}
      onAccessibilityAction={(event) => {
        switch (event.nativeEvent.actionName) {
          case 'move-left':
            onAccessibilityMove('left');
            break;
          case 'move-right':
            onAccessibilityMove('right');
            break;
          case 'move-up':
            onAccessibilityMove('up');
            break;
          case 'move-down':
            onAccessibilityMove('down');
            break;
        }
      }}
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

function adjustCropForAccessibility(
  crop: NormalizedCrop,
  corner: CropCorner,
  direction: 'left' | 'right' | 'up' | 'down',
): NormalizedCrop {
  const step = 0.02;
  const deltaX =
    direction === 'left' ? -step : direction === 'right' ? step : 0;
  const deltaY =
    direction === 'up' ? -step : direction === 'down' ? step : 0;

  return adjustCropCorner(crop, corner, deltaX, deltaY);
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
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
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
    color: colors.primaryAlt,
    ...typography.label,
    letterSpacing: 1.3,
    marginBottom: spacing.xs,
  },
  title: {
    color: colors.text,
    ...typography.title,
  },
  instructions: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  linkButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  linkButtonText: {
    color: colors.primary,
    fontWeight: '800',
  },
  imageStage: {
    height: 440,
    overflow: 'hidden',
    backgroundColor: colors.text,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: '#1F2E2C',
    ...shadows.card,
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
    borderColor: colors.accent,
    borderWidth: 4,
  },
  toolbar: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  toolbarButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  checkCard: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  sectionTitle: {
    color: colors.text,
    ...typography.section,
  },
  sectionHint: {
    color: colors.textMuted,
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
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkboxText: {
    color: '#FFFFFF',
    fontWeight: '900',
  },
  checkLabel: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  issueCard: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
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
    color: colors.text,
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
    minHeight: 56,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    marginTop: spacing.lg,
    paddingHorizontal: 18,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
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
