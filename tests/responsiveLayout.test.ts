import { describe, expect, it } from 'vitest';
import { responsiveLayout } from '../src/ui/responsiveLayout';

describe('adaptive mobile layout', () => {
  it('stacks narrow screen actions and keeps positive usable spacing', () => {
    const layout = responsiveLayout(320, 568);
    expect(layout.compact).toBe(true);
    expect(layout.veryCompact).toBe(true);
    expect(layout.stackActionButtons).toBe(true);
    expect(layout.horizontalPadding).toBe(12);
    expect(layout.cropStageHeight).toBeGreaterThanOrEqual(220);
  });

  it('retains wide layouts on ordinary phones and tablets', () => {
    expect(responsiveLayout(430, 932).compact).toBe(false);
    expect(responsiveLayout(800, 1200).stackSummary).toBe(false);
    expect(responsiveLayout(800, 1200).cropStageHeight).toBe(440);
  });

  it('reflows content for large font settings even at unchanged device width', () => {
    const defaultLayout = responsiveLayout(430, 932, 1);
    const largeText = responsiveLayout(430, 932, 1.6);
    expect(defaultLayout.compact).toBe(false);
    expect(largeText.compact).toBe(true);
    expect(largeText.stackActionButtons).toBe(true);
    expect(largeText.horizontalPadding).toBeLessThan(defaultLayout.horizontalPadding);
  });

  it('bounds image previews for very tall and short devices', () => {
    expect(responsiveLayout(360, 500).cropStageHeight).toBe(240);
    expect(responsiveLayout(400, 1400).cropStageHeight).toBe(440);
    expect(responsiveLayout(400, 1400).evidenceImageHeight).toBe(360);
  });
});
