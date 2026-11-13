/**
 * Pure device-size rules shared by mobile screens. Font scaling reduces the
 * space effectively available for labels even when the viewport is unchanged.
 */
export function responsiveLayout(
  width: number,
  height: number,
  fontScale = 1,
) {
  const safeWidth = Math.max(240, Number.isFinite(width) ? width : 360);
  const safeHeight = Math.max(320, Number.isFinite(height) ? height : 640);
  const scale = Math.max(1, Number.isFinite(fontScale) ? fontScale : 1);
  const effectiveWidth = safeWidth / scale;
  const compact = effectiveWidth < 390;
  const veryCompact = effectiveWidth < 330;

  return {
    compact,
    veryCompact,
    horizontalPadding: veryCompact ? 12 : compact ? 16 : 24,
    stackActionButtons: effectiveWidth < 345,
    stackSummary: effectiveWidth < 380,
    cropStageHeight: Math.round(Math.max(220, Math.min(440, safeHeight * 0.48))),
    evidenceImageHeight: Math.round(Math.max(180, Math.min(360, safeHeight * 0.4))),
  };
}
