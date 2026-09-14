"use client";

import { useEffect, useRef, useState } from "react";

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * DOM要素の実サイズを ResizeObserver で追跡するフック。
 * ゲームのステージ用 div に ref を渡し、Pixi/Three のレンダラーサイズを
 * この値に追従させることで PC のウィンドウリサイズと SP の回転の両方に対応する。
 */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const updateFromRect = (width: number, height: number) => {
      setSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    };

    const rect = el.getBoundingClientRect();
    updateFromRect(rect.width, rect.height);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const box = entry.contentBoxSize?.[0];
      if (box) {
        updateFromRect(box.inlineSize, box.blockSize);
      } else {
        updateFromRect(entry.contentRect.width, entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}
