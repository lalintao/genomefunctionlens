import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { placeFloatingLayer, type FloatingRect } from "./floatingLayerPosition";

type ViewportFloatingLayerProps = Omit<HTMLAttributes<HTMLDivElement>, "style"> & {
  anchorRect?: FloatingRect | null;
  anchorRef?: { current: Element | null };
  getAnchorRect?: () => FloatingRect | null;
  align?: "start" | "end";
  children: ReactNode;
  gap?: number;
  matchAnchorWidth?: boolean;
  maxHeight?: number;
  padding?: number;
  style?: CSSProperties;
};

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

export const ViewportFloatingLayer = forwardRef<HTMLDivElement, ViewportFloatingLayerProps>(function ViewportFloatingLayer(
  {
    anchorRect,
    anchorRef,
    getAnchorRect,
    align = "start",
    children,
    gap = 4,
    matchAnchorWidth = false,
    maxHeight,
    padding = 8,
    style,
    ...htmlProps
  },
  forwardedRef,
) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<CSSProperties>({
    top: padding,
    left: padding,
    visibility: "hidden",
  });
  const setLayerRef = useCallback((element: HTMLDivElement | null) => {
    layerRef.current = element;
    assignRef(forwardedRef, element);
  }, [forwardedRef]);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer || typeof window === "undefined") return undefined;

    const resolveAnchor = () => getAnchorRect?.()
      ?? anchorRef?.current?.getBoundingClientRect()
      ?? anchorRect
      ?? null;
    const updatePosition = () => {
      const anchor = resolveAnchor();
      if (!anchor) return;
      const layerRect = layer.getBoundingClientRect();
      const desiredHeight = Math.min(layer.scrollHeight, maxHeight ?? Number.POSITIVE_INFINITY);
      const placement = placeFloatingLayer({
        anchor,
        layer: { width: layerRect.width, height: desiredHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        gap,
        padding,
        matchAnchorWidth,
        align,
      });
      setPosition({
        top: placement.top,
        left: placement.left,
        width: placement.width,
        maxWidth: Math.max(0, window.innerWidth - padding * 2),
        maxHeight: placement.maxHeight,
        visibility: "visible",
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    document.addEventListener("scroll", updatePosition, true);
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePosition);
    resizeObserver?.observe(layer);
    if (anchorRef?.current) resizeObserver?.observe(anchorRef.current);
    return () => {
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", updatePosition, true);
      resizeObserver?.disconnect();
    };
  }, [
    align,
    anchorRect?.bottom,
    anchorRect?.left,
    anchorRect?.right,
    anchorRect?.top,
    anchorRef,
    gap,
    getAnchorRect,
    matchAnchorWidth,
    maxHeight,
    padding,
  ]);

  const layer = (
    <div
      {...htmlProps}
      ref={setLayerRef}
      style={{ ...style, ...position, position: "fixed", right: "auto", bottom: "auto" }}
    >
      {children}
    </div>
  );
  return typeof document === "undefined" ? layer : createPortal(layer, document.body);
});

export function ParentAnchoredFloatingLayer(props: Omit<ViewportFloatingLayerProps, "anchorRef" | "anchorRect" | "getAnchorRect">) {
  const markerRef = useRef<HTMLSpanElement | null>(null);
  const getAnchorRect = useCallback(
    () => markerRef.current?.parentElement?.getBoundingClientRect() ?? null,
    [],
  );
  return (
    <>
      <span ref={markerRef} hidden aria-hidden="true" />
      <ViewportFloatingLayer {...props} getAnchorRect={getAnchorRect} />
    </>
  );
}
