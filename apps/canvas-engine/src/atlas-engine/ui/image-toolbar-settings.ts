export type PreviewScrollMetrics = {
  left: number;
  max: number;
  viewport: number;
  content: number;
};

export function measurePreviewScroll(
  left: number,
  contentWidth: number,
  viewportWidth: number,
): PreviewScrollMetrics {
  const content = finiteNonNegative(contentWidth);
  const viewport = Math.max(1, finiteNonNegative(viewportWidth));
  const max = Math.max(0, content - viewport);
  return {
    left: Math.min(max, finiteNonNegative(left)),
    max,
    viewport,
    content: Math.max(1, content),
  };
}

export function previewScrollbarThumbWidth(
  trackWidth: number,
  viewport: number,
  content: number,
  hasOverflow: boolean,
): number {
  const track = Math.max(1, finiteNonNegative(trackWidth));
  if (!hasOverflow) return track;
  const ratio =
    Math.max(0, finiteNonNegative(viewport)) /
    Math.max(1, finiteNonNegative(content));
  return Math.min(track, Math.max(64, ratio * track));
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
