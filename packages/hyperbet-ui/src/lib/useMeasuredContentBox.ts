import { type RefObject, useEffect, useState } from "react";

type ContentBoxSize = {
  width: number;
  height: number;
};

function parseCssPixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function measureContentBox(element: HTMLElement): ContentBoxSize | null {
  const style = window.getComputedStyle(element);
  const horizontalPadding =
    parseCssPixels(style.paddingLeft) + parseCssPixels(style.paddingRight);
  const verticalPadding =
    parseCssPixels(style.paddingTop) + parseCssPixels(style.paddingBottom);
  const width = Math.max(0, element.clientWidth - horizontalPadding);
  const height = Math.max(0, element.clientHeight - verticalPadding);

  if (width <= 0 || height <= 0) {
    return null;
  }

  return { width, height };
}

export function useMeasuredContentBox<T extends HTMLElement>(
  ref: RefObject<T | null>,
  enabled = true,
  settleFrames = 1,
): ContentBoxSize | null {
  const [size, setSize] = useState<ContentBoxSize | null>(null);

  useEffect(() => {
    if (!enabled) {
      setSize(null);
      return;
    }

    const element = ref.current;
    if (!element || typeof window === "undefined") {
      setSize(null);
      return;
    }

    let firstFrame = 0;
    let secondFrame = 0;

    const update = () => {
      setSize((current) => {
        const next = measureContentBox(element);
        if (!current || !next) {
          return next;
        }
        return current.width === next.width && current.height === next.height
          ? current
          : next;
      });
    };

    const scheduleUpdate = () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      firstFrame = window.requestAnimationFrame(() => {
        if (settleFrames > 1) {
          secondFrame = window.requestAnimationFrame(update);
          return;
        }
        update();
      });
    };

    scheduleUpdate();

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(scheduleUpdate)
        : null;
    resizeObserver?.observe(element);

    window.addEventListener("resize", scheduleUpdate);

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [enabled, ref, settleFrames]);

  return size;
}
