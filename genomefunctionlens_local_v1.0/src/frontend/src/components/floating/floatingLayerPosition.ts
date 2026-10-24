export type FloatingRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

type FloatingSize = { width: number; height: number };

type ViewportSize = { width: number; height: number };

export type FloatingLayerPlacement = {
  side: "top" | "bottom";
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  maxHeight: number;
};

export function placeFloatingLayer(input: {
  anchor: FloatingRect;
  layer: FloatingSize;
  viewport: ViewportSize;
  gap?: number;
  padding?: number;
  matchAnchorWidth?: boolean;
  align?: "start" | "end";
}): FloatingLayerPlacement {
  const gap = Math.max(0, input.gap ?? 4);
  const padding = Math.max(0, input.padding ?? 8);
  const viewportWidth = Math.max(0, input.viewport.width);
  const viewportHeight = Math.max(0, input.viewport.height);
  const maximumWidth = Math.max(0, viewportWidth - padding * 2);
  const anchorWidth = Math.max(0, input.anchor.right - input.anchor.left);
  const width = Math.min(
    maximumWidth,
    Math.max(0, input.matchAnchorWidth ? anchorWidth : input.layer.width),
  );
  const requestedLeft = input.align === "end"
    ? input.anchor.right - width
    : input.anchor.left;
  const left = Math.min(
    Math.max(padding, requestedLeft),
    Math.max(padding, viewportWidth - padding - width),
  );
  const availableBelow = Math.max(0, viewportHeight - padding - input.anchor.bottom - gap);
  const availableAbove = Math.max(0, input.anchor.top - padding - gap);
  const desiredHeight = Math.max(0, input.layer.height);
  const side = availableBelow >= desiredHeight || availableBelow >= availableAbove ? "bottom" : "top";
  const availableHeight = side === "bottom" ? availableBelow : availableAbove;
  const maxHeight = Math.min(desiredHeight, availableHeight);
  const top = side === "bottom"
    ? Math.min(input.anchor.bottom + gap, Math.max(padding, viewportHeight - padding - maxHeight))
    : Math.max(padding, input.anchor.top - gap - maxHeight);

  return {
    side,
    top,
    right: left + width,
    bottom: top + maxHeight,
    left,
    width,
    maxHeight,
  };
}
