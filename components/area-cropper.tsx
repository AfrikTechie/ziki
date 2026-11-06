"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Box = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type Props = {
  imageSrc: string;
  onCropComplete: (croppedBlob: Blob, croppedUrl: string, width?: number, height?: number) => void;
  onUseFull: () => void;
  onRetake: () => void;
  onCancel: () => void;
};

/**
 * Computes exact painted dimensions and letterbox/pillarbox offsets of an image
 * inside its container, ensuring 1:1 coordinate mapping to natural image pixels.
 */
function getImageMetrics(img: HTMLImageElement, container: HTMLElement) {
  const naturalWidth = img.naturalWidth || 800;
  const naturalHeight = img.naturalHeight || 500;

  const imgRect = img.getBoundingClientRect();
  const contRect = container.getBoundingClientRect();

  // If in jsdom or unrendered, fallback gracefully to clientWidth / clientHeight
  const rawBoxWidth = imgRect.width > 0 ? imgRect.width : (img.clientWidth || contRect.width || container.clientWidth || 800);
  const rawBoxHeight = imgRect.height > 0 ? imgRect.height : (img.clientHeight || contRect.height || container.clientHeight || 500);

  const imgAspect = naturalWidth / naturalHeight;
  const boxAspect = rawBoxWidth / rawBoxHeight;

  let paintedWidth = rawBoxWidth;
  let paintedHeight = rawBoxHeight;
  let offsetX = imgRect.width > 0 ? Math.max(0, imgRect.left - contRect.left) : 0;
  let offsetY = imgRect.height > 0 ? Math.max(0, imgRect.top - contRect.top) : 0;

  // Account for letterboxing (horizontal) or pillarboxing (vertical)
  if (Math.abs(imgAspect - boxAspect) > 0.005) {
    if (imgAspect > boxAspect) {
      paintedWidth = rawBoxWidth;
      paintedHeight = rawBoxWidth / imgAspect;
      offsetY += (rawBoxHeight - paintedHeight) / 2;
    } else {
      paintedHeight = rawBoxHeight;
      paintedWidth = rawBoxHeight * imgAspect;
      offsetX += (rawBoxWidth - paintedWidth) / 2;
    }
  }

  const scale = naturalWidth / Math.max(1, paintedWidth);

  return {
    offsetX,
    offsetY,
    renderedWidth: paintedWidth,
    renderedHeight: paintedHeight,
    scale,
    naturalWidth,
    naturalHeight,
  };
}

export type ImageMetrics = ReturnType<typeof getImageMetrics>;

/**
 * In-app area selection and cropping experience for screen captures.
 * Displays the captured frame and provides an interactive drag overlay
 * to select and crop a specific region of the screen.
 */
export function AreaCropper({
  imageSrc,
  onCropComplete,
  onUseFull,
  onRetake,
  onCancel,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ isDragging: boolean; startX: number; startY: number }>({
    isDragging: false,
    startX: 0,
    startY: 0,
  });
  const [box, setBox] = useState<Box | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [metrics, setMetrics] = useState<ImageMetrics | null>(null);

  // Normalize selection box to { x, y, width, height }
  const getNormalizedBox = useCallback(() => {
    if (!box) return null;
    const x = Math.min(box.startX, box.currentX);
    const y = Math.min(box.startY, box.currentY);
    const width = Math.abs(box.currentX - box.startX);
    const height = Math.abs(box.currentY - box.startY);
    return { x, y, width, height };
  }, [box]);

  const norm = getNormalizedBox();

  const updateMetrics = useCallback(() => {
    const img = imageRef.current;
    const container = containerRef.current;
    if (!img || !container) return null;
    const m = getImageMetrics(img, container);
    setMetrics(m);
    return m;
  }, []);

  const handleImageLoad = () => {
    setImageLoaded(true);
    updateMetrics();
  };

  useEffect(() => {
    updateMetrics();
    window.addEventListener("resize", updateMetrics);
    return () => window.removeEventListener("resize", updateMetrics);
  }, [updateMetrics, imageLoaded]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current || !imageRef.current) return;
    const currentMetrics = updateMetrics() || metrics;
    if (!currentMetrics) return;

    const contRect = containerRef.current.getBoundingClientRect();
    const clientX = typeof e.clientX === "number" ? e.clientX : 0;
    const clientY = typeof e.clientY === "number" ? e.clientY : 0;

    // Coordinate relative to the painted image bounds (excluding letterbox/pillarbox)
    const x = Math.max(0, Math.min(currentMetrics.renderedWidth, clientX - (contRect.left || 0) - currentMetrics.offsetX));
    const y = Math.max(0, Math.min(currentMetrics.renderedHeight, clientY - (contRect.top || 0) - currentMetrics.offsetY));

    dragRef.current = { isDragging: true, startX: x, startY: y };
    setBox({ startX: x, startY: y, currentX: x, currentY: y });
    if (typeof e.currentTarget.setPointerCapture === "function") {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture fallback
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.isDragging || !containerRef.current || !imageRef.current) return;
    const currentMetrics = metrics || updateMetrics();
    if (!currentMetrics) return;

    const contRect = containerRef.current.getBoundingClientRect();
    const clientX = typeof e.clientX === "number" ? e.clientX : 0;
    const clientY = typeof e.clientY === "number" ? e.clientY : 0;

    const x = Math.max(0, Math.min(currentMetrics.renderedWidth, clientX - (contRect.left || 0) - currentMetrics.offsetX));
    const y = Math.max(0, Math.min(currentMetrics.renderedHeight, clientY - (contRect.top || 0) - currentMetrics.offsetY));

    setBox({
      startX: dragRef.current.startX,
      startY: dragRef.current.startY,
      currentX: x,
      currentY: y,
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.isDragging) {
      dragRef.current.isDragging = false;
      if (typeof e.currentTarget.releasePointerCapture === "function") {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          // Pointer capture release safeguard
        }
      }
    }
  };

  // Ensure pointer up outside window stops dragging
  useEffect(() => {
    const handleGlobalPointerUp = () => {
      dragRef.current.isDragging = false;
    };
    window.addEventListener("pointerup", handleGlobalPointerUp);
    return () => window.removeEventListener("pointerup", handleGlobalPointerUp);
  }, []);

  const handleCrop = useCallback(() => {
    const img = imageRef.current;
    const currentMetrics = updateMetrics() || metrics;
    if (!img || !currentMetrics || !norm || norm.width < 5 || norm.height < 5) {
      onUseFull();
      return;
    }

    const { scale, naturalWidth, naturalHeight } = currentMetrics;

    const rawSourceX = norm.x * scale;
    const rawSourceY = norm.y * scale;
    const rawSourceW = norm.width * scale;
    const rawSourceH = norm.height * scale;

    // Clamp coordinates within natural image dimensions so edges are never cut off
    const sourceX = Math.max(0, Math.min(naturalWidth - 1, Math.round(rawSourceX)));
    const sourceY = Math.max(0, Math.min(naturalHeight - 1, Math.round(rawSourceY)));
    const sourceWidth = Math.max(1, Math.min(naturalWidth - sourceX, Math.round(rawSourceW)));
    const sourceHeight = Math.max(1, Math.min(naturalHeight - sourceY, Math.round(rawSourceH)));

    const canvas = document.createElement("canvas");
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      onUseFull();
      return;
    }

    ctx.drawImage(
      img,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      sourceWidth,
      sourceHeight,
    );

    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        onCropComplete(blob, url, sourceWidth, sourceHeight);
      } else {
        onUseFull();
      }
    }, "image/png");
  }, [metrics, norm, onCropComplete, onUseFull, updateMetrics]);

  // Keyboard shortcut: Escape cancels, Enter crops
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && norm && norm.width >= 10 && norm.height >= 10) {
        handleCrop();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCrop, norm, onCancel]);

  return (
    <div className="flex flex-col space-y-3">
      <div className="flex items-center justify-between text-xs text-zk-muted">
        <span>Click and drag over the image to crop the problem area</span>
        {norm && norm.width > 10 && (() => {
          const naturalW = metrics ? Math.round(norm.width * metrics.scale) : Math.round(norm.width);
          const naturalH = metrics ? Math.round(norm.height * metrics.scale) : Math.round(norm.height);
          return (
            <span className="font-mono text-[11px] font-semibold text-zk-accent">
              {naturalW} × {naturalH} px
            </span>
          );
        })()}
      </div>

      <div className="flex items-center justify-center overflow-hidden rounded-xl border border-zk-border bg-black/95 p-1">
        <div
          ref={containerRef}
          role="region"
          aria-label="Image area selection"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="relative inline-block max-h-[380px] max-w-full select-none overflow-hidden touch-none cursor-crosshair"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imageRef}
            src={imageSrc}
            alt="Screenshot to crop"
            onLoad={handleImageLoad}
            className="pointer-events-none block max-h-[380px] max-w-full w-auto h-auto object-contain"
          />

          {/* Selection overlay */}
          {imageLoaded && norm && norm.width > 2 && norm.height > 2 && (() => {
            const ox = metrics?.offsetX || 0;
            const oy = metrics?.offsetY || 0;
            return (
              <div
                className="pointer-events-none absolute border-2 border-dashed border-zk-accent bg-zk-accent/20 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
                style={{
                  left: `${norm.x + ox}px`,
                  top: `${norm.y + oy}px`,
                  width: `${norm.width}px`,
                  height: `${norm.height}px`,
                }}
              >
                <div className="absolute -top-6 left-0 rounded bg-zk-accent px-1.5 py-0.5 text-[10px] font-bold text-white shadow">
                  Selection
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRetake}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-zk-border bg-zk-surface px-3 text-xs font-semibold text-zk-text hover:bg-zk-chip"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
            Retake
          </button>
          <button
            type="button"
            onClick={onUseFull}
            className="inline-flex min-h-9 items-center rounded-full border border-zk-border bg-zk-surface px-3 text-xs font-semibold text-zk-text2 hover:bg-zk-chip"
          >
            Use full screenshot
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-9 items-center rounded-full px-3 text-xs font-medium text-zk-muted hover:text-zk-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCrop}
            disabled={!norm || norm.width < 5 || norm.height < 5}
            className="inline-flex min-h-9 items-center rounded-full bg-zk-accent px-4 text-xs font-bold text-white hover:opacity-95 disabled:pointer-events-none disabled:opacity-40"
          >
            Crop area
          </button>
        </div>
      </div>
    </div>
  );
}
