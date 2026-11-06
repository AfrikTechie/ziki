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
  onCropComplete: (croppedBlob: Blob, croppedUrl: string) => void;
  onUseFull: () => void;
  onRetake: () => void;
  onCancel: () => void;
};

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

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const boundWidth = rect.width || containerRef.current.clientWidth || 800;
    const boundHeight = rect.height || containerRef.current.clientHeight || 500;
    const clientX = typeof e.clientX === "number" ? e.clientX : 0;
    const clientY = typeof e.clientY === "number" ? e.clientY : 0;
    const x = Math.max(0, Math.min(boundWidth, clientX - (rect.left || 0)));
    const y = Math.max(0, Math.min(boundHeight, clientY - (rect.top || 0)));

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
    if (!dragRef.current.isDragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const boundWidth = rect.width || containerRef.current.clientWidth || 800;
    const boundHeight = rect.height || containerRef.current.clientHeight || 500;
    const clientX = typeof e.clientX === "number" ? e.clientX : 0;
    const clientY = typeof e.clientY === "number" ? e.clientY : 0;
    const x = Math.max(0, Math.min(boundWidth, clientX - (rect.left || 0)));
    const y = Math.max(0, Math.min(boundHeight, clientY - (rect.top || 0)));

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
    const container = containerRef.current;
    if (!img || !container || !norm || norm.width < 5 || norm.height < 5) {
      onUseFull();
      return;
    }

    const cWidth = container.clientWidth || 800;
    const cHeight = container.clientHeight || 500;
    const naturalWidth = img.naturalWidth || cWidth;
    const naturalHeight = img.naturalHeight || cHeight;

    const scaleX = naturalWidth / cWidth;
    const scaleY = naturalHeight / cHeight;

    const sourceX = Math.round(norm.x * scaleX);
    const sourceY = Math.round(norm.y * scaleY);
    const sourceWidth = Math.round(norm.width * scaleX);
    const sourceHeight = Math.round(norm.height * scaleY);

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, sourceWidth);
    canvas.height = Math.max(1, sourceHeight);
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
      canvas.width,
      canvas.height,
    );

    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        onCropComplete(blob, url);
      } else {
        onUseFull();
      }
    }, "image/png");
  }, [norm, onCropComplete, onUseFull]);

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
        {norm && norm.width > 10 && (
          <span className="font-mono text-[11px] font-semibold text-zk-accent">
            {Math.round(norm.width)} × {Math.round(norm.height)} px
          </span>
        )}
      </div>

      <div
        ref={containerRef}
        role="region"
        aria-label="Image area selection"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="relative max-h-[380px] w-full select-none overflow-hidden rounded-xl border border-zk-border bg-black/90 touch-none cursor-crosshair"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          src={imageSrc}
          alt="Screenshot to crop"
          onLoad={() => setImageLoaded(true)}
          className="pointer-events-none block max-h-[380px] w-full object-contain"
        />

        {/* Selection overlay */}
        {imageLoaded && norm && norm.width > 2 && norm.height > 2 && (
          <div
            className="pointer-events-none absolute border-2 border-dashed border-zk-accent bg-zk-accent/20 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
            style={{
              left: `${norm.x}px`,
              top: `${norm.y}px`,
              width: `${norm.width}px`,
              height: `${norm.height}px`,
            }}
          >
            <div className="absolute -top-6 left-0 rounded bg-zk-accent px-1.5 py-0.5 text-[10px] font-bold text-white shadow">
              Selection
            </div>
          </div>
        )}
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
