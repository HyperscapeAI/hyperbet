import { useCallback, useEffect, useRef, useState } from "react";

/** Default breakpoint (768) matches CSS resize-handle hide rule. */
export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth <= breakpoint;
  });

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= breakpoint);
    window.addEventListener("resize", handler, { passive: true });
    return () => window.removeEventListener("resize", handler);
  }, [breakpoint]);

  return isMobile;
}

/** Draggable panel size (px) persisted to localStorage. Invert startDrag for right-side panels. */
export function useResizePanel(options: {
  initial: number;
  min: number;
  max: number;
  storageKey: string;
}) {
  const { initial, min, max, storageKey } = options;

  const [size, setSize] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const n = parseFloat(stored);
        if (Number.isFinite(n)) return Math.max(min, Math.min(max, n));
      }
    } catch {
      // private-mode or SSR
    }
    return initial;
  });

  const sizeRef = useRef(size);
  sizeRef.current = size;

  const startDrag = useCallback(
    (e: React.MouseEvent, axis: "x" | "y", invert = false) => {
      e.preventDefault();
      const startPos = axis === "x" ? e.clientX : e.clientY;
      const startSize = sizeRef.current;
      const dragCursor = axis === "x" ? "col-resize" : "row-resize";
      const dragShield = document.createElement("div");

      dragShield.style.position = "fixed";
      dragShield.style.inset = "0";
      dragShield.style.zIndex = "2147483647";
      dragShield.style.cursor = dragCursor;
      dragShield.style.background = "transparent";

      document.body.style.cursor = dragCursor;
      document.body.style.userSelect = "none";
      document.body.appendChild(dragShield);

      const onMove = (ev: MouseEvent) => {
        const raw = (axis === "x" ? ev.clientX : ev.clientY) - startPos;
        const delta = invert ? -raw : raw;
        const next = Math.max(min, Math.min(max, startSize + delta));
        setSize(next);
        try {
          localStorage.setItem(storageKey, String(next));
        } catch {
          // ignore write errors
        }
      };

      const onUp = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        dragShield.remove();
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [min, max, storageKey],
  );

  /** Reset to initial size and clear localStorage. */
  const reset = useCallback(() => {
    setSize(initial);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  }, [initial, storageKey]);

  return { size, startDrag, reset };
}
