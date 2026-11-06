"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter, unstable_rethrow } from "next/navigation";
import { createBugAction, type ActionResult } from "@/app/actions/issues";
import { interpretVisualEvidenceAction } from "@/app/actions/visual-interpretation";
import {
  generateFallbackAnalysis,
  type KeyframeSample,
  type VisualInterpretationDetails,
} from "@/lib/visual-interpretation";
import { AreaCropper } from "@/components/area-cropper";
import { ClaudeWorking } from "@/components/claude-working";

type Mode = "record" | "capture" | "write";
type Step = "choose" | "capture" | "details" | "review";

type MediaState =
  | { type: "video"; blob: Blob; url: string; duration: number }
  | { type: "screenshot"; blob: Blob; url: string; width?: number; height?: number };

type TypeOption = { id: string; name: string };

const FALLBACK_TYPES: TypeOption[] = [
  { id: "", name: "Bug" },
];

const VISUAL_INTERPRETATION_STEPS = [
  "Analyzing visual demonstration…",
  "Examining interactions and screen elements…",
  "Identifying unexpected behavior…",
  "Synthesizing reproduction steps…",
  "Drafting structured issue description…",
];

/**
 * Extracts lightweight keyframes across the recording timeline using an offscreen canvas.
 * Held purely in temporary browser memory.
 */
async function extractVideoKeyframes(blob: Blob, count: number = 3): Promise<KeyframeSample[]> {
  return new Promise((resolve) => {
    try {
      if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) {
        resolve([]);
        return;
      }
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      const url = URL.createObjectURL(blob);
      video.src = url;

      const frames: KeyframeSample[] = [];
      const timer = setTimeout(() => {
        URL.revokeObjectURL(url);
        resolve(frames);
      }, 3000);

      video.onloadedmetadata = () => {
        const duration = Math.max(1, video.duration || 1);
        const samplePoints = [
          { label: "Start of recording", time: Math.min(0.5, duration * 0.1) },
          { label: "Mid-interaction", time: duration * 0.5 },
          { label: "Observed outcome", time: Math.max(0.5, duration * 0.9) },
        ].slice(0, count);

        let currentIndex = 0;

        const captureCurrentPoint = () => {
          if (currentIndex >= samplePoints.length) {
            clearTimeout(timer);
            URL.revokeObjectURL(url);
            resolve(frames);
            return;
          }
          video.currentTime = samplePoints[currentIndex].time;
        };

        video.onseeked = () => {
          try {
            const canvas = document.createElement("canvas");
            const width = Math.min(video.videoWidth || 640, 800);
            const aspect = (video.videoHeight || 480) / (video.videoWidth || 640);
            canvas.width = width;
            canvas.height = Math.round(width * (aspect || 0.75));
            const ctx = canvas.getContext("2d");
            ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
            frames.push({
              label: `${samplePoints[currentIndex].label} (t=${Math.round(samplePoints[currentIndex].time)}s)`,
              dataUrl,
            });
          } catch {
            // ignore frame error
          }
          currentIndex++;
          captureCurrentPoint();
        };

        captureCurrentPoint();
      };

      video.onerror = () => {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        resolve(frames);
      };
    } catch {
      resolve([]);
    }
  });
}

/**
 * Converts a screenshot blob to base64 data URL for in-memory synthesis.
 */
async function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(typeof reader.result === "string" ? reader.result : null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    } catch {
      resolve(null);
    }
  });
}

export function AddIdeaModal({
  projectId,
  isOpen,
  onClose,
  types = [],
  onOpenInlineComposer,
}: {
  projectId?: string;
  isOpen: boolean;
  onClose: () => void;
  types?: TypeOption[];
  onOpenInlineComposer?: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);

  const [step, setStep] = useState<Step>("choose");
  const [mode, setMode] = useState<Mode>("record");

  // Recording states
  const [recordState, setRecordState] = useState<"idle" | "recording" | "recorded">("idle");
  const [recordSeconds, setRecordSeconds] = useState(0);

  // Screenshot / Crop states
  const [rawScreenUrl, setRawScreenUrl] = useState<string | null>(null);
  const [isCropping, setIsCropping] = useState(false);

  // Captured media held purely in browser memory
  const [media, setMedia] = useState<MediaState | null>(null);

  // Clarification & AI interpretation state
  const [clarification, setClarification] = useState("");
  const [understanding, setUnderstanding] = useState<VisualInterpretationDetails | null>(null);
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [showClarifyInput, setShowClarifyInput] = useState(false);

  // Review form state
  const availableTypes = types.length > 0 ? types : FALLBACK_TYPES;
  const defaultTypeId =
    types.find((t) => t.name.toLowerCase() === "bug" || t.name.toLowerCase() === "fix")?.id ??
    types[0]?.id ??
    "";

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedType, setSelectedType] = useState(defaultTypeId);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const titleId = useId();
  const descId = useId();
  const typeId = useId();
  const clarificationId = useId();

  // Helper to cleanup any active stream and blob URLs
  const cleanupMedia = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (recorderRef.current) {
      if (recorderRef.current.state === "recording") {
        recorderRef.current.onstop = null;
        try {
          recorderRef.current.stop();
        } catch {
          // ignore
        }
      }
      recorderRef.current = null;
    }
    if (rawScreenUrl) {
      URL.revokeObjectURL(rawScreenUrl);
      setRawScreenUrl(null);
    }
    if (media) {
      URL.revokeObjectURL(media.url);
      setMedia(null);
    }
    setRecordState("idle");
    setRecordSeconds(0);
    setIsCropping(false);
  }, [media, rawScreenUrl]);

  // Handle open / close dialog lifecycle
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // Clean up media on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const handleClose = useCallback(() => {
    cleanupMedia();
    setStep("choose");
    setTitle("");
    setDescription("");
    setClarification("");
    setUnderstanding(null);
    setIsInterpreting(false);
    setShowClarifyInput(false);
    setError(null);
    setFieldErrors({});
    onClose();
  }, [cleanupMedia, onClose]);

  // Format seconds to mm:ss
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  /* -------------------------------------------------------------
   * Screen Recording Controls
   * ------------------------------------------------------------- */
  const startRecording = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("Screen recording is not supported in this browser. Please use Chrome, Edge, Firefox, or Safari.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" },
        audio: false,
      });
      streamRef.current = stream;

      // Detect supported mimeType
      const mimeType =
        [
          "video/webm;codecs=vp9",
          "video/webm;codecs=vp8",
          "video/webm",
          "video/mp4",
        ].find((type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) || "";

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;

      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      const start = Date.now();
      startTimeRef.current = start;

      recorder.onstop = () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        const elapsed = Math.max(1, Math.floor((Date.now() - start) / 1000));
        const blob = new Blob(chunks, { type: mimeType || "video/webm" });
        const url = URL.createObjectURL(blob);
        setMedia({ type: "video", blob, url, duration: elapsed });
        setRecordState("recorded");
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }
      };

      // Handle user pressing the browser's native "Stop sharing" button
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          if (recorder.state === "recording") {
            recorder.stop();
          }
        };
      }

      recorder.start(500);
      setRecordState("recording");
      setRecordSeconds(0);

      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - start) / 1000);
        setRecordSeconds(elapsed);
        // Cap recording at 60 seconds for memory preservation
        if (elapsed >= 60) {
          if (recorder.state === "recording") {
            recorder.stop();
          }
        }
      }, 1000);
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      if (e.name === "NotAllowedError" || e.name === "AbortError") {
        setError("Screen recording was cancelled or permission was denied.");
      } else {
        setError(e.message || "Could not start screen recording. Please try again.");
      }
      setRecordState("idle");
    }
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop();
    }
  };

  const recordAgain = () => {
    if (media) {
      URL.revokeObjectURL(media.url);
      setMedia(null);
    }
    setRecordState("idle");
    setRecordSeconds(0);
    setUnderstanding(null);
    startRecording();
  };

  /* -------------------------------------------------------------
   * Screenshot / Area Capture Controls
   * ------------------------------------------------------------- */
  const captureScreen = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("Screen capture is not supported in this browser. Please use Chrome, Edge, Firefox, or Safari.");
      return;
    }

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" },
        audio: false,
      });

      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;

      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), 1500);
        video.onloadedmetadata = () => {
          clearTimeout(timer);
          video.play().then(() => resolve()).catch(() => resolve());
        };
      });

      // Small delay to ensure frame is painted
      await new Promise((r) => setTimeout(r, 150));

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1920;
      canvas.height = video.videoHeight || 1080;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(video, 0, 0);

      canvas.toBlob((blob) => {
        if (!blob) {
          setError("Failed to capture image frame.");
          return;
        }
        const url = URL.createObjectURL(blob);
        setRawScreenUrl(url);
        setIsCropping(true);
      }, "image/png");
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      if (e.name === "NotAllowedError" || e.name === "AbortError") {
        setError("Screen capture was cancelled or permission was denied.");
      } else {
        setError(e.message || "Could not capture screen. Try again.");
      }
    } finally {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    }
  };

  const handleCropComplete = (croppedBlob: Blob, croppedUrl: string) => {
    if (rawScreenUrl) {
      URL.revokeObjectURL(rawScreenUrl);
      setRawScreenUrl(null);
    }
    setMedia({ type: "screenshot", blob: croppedBlob, url: croppedUrl });
    setIsCropping(false);
    setUnderstanding(null);
  };

  const handleUseFullScreenshot = () => {
    if (!rawScreenUrl) return;
    fetch(rawScreenUrl)
      .then((res) => res.blob())
      .then((blob) => {
        setMedia({ type: "screenshot", blob, url: rawScreenUrl });
        setIsCropping(false);
        setUnderstanding(null);
      })
      .catch(() => {
        setIsCropping(false);
      });
  };

  const handleRetakeScreenshot = () => {
    if (rawScreenUrl) {
      URL.revokeObjectURL(rawScreenUrl);
      setRawScreenUrl(null);
    }
    if (media) {
      URL.revokeObjectURL(media.url);
      setMedia(null);
    }
    setIsCropping(false);
    setUnderstanding(null);
    captureScreen();
  };

  /* -------------------------------------------------------------
   * AI Interpretation & Understanding Pipeline
   * ------------------------------------------------------------- */
  const handleRunAnalysis = async (explicitClarification?: string) => {
    if (!media) {
      setStep("review");
      return;
    }

    setError(null);
    setIsInterpreting(true);

    try {
      let imageSample: string | undefined = undefined;
      let frames: KeyframeSample[] | undefined = undefined;

      if (media.type === "screenshot") {
        const dataUrl = await blobToDataUrl(media.blob);
        if (dataUrl) imageSample = dataUrl;
      } else if (media.type === "video") {
        const sampledFrames = await extractVideoKeyframes(media.blob, 3);
        if (sampledFrames && sampledFrames.length > 0) {
          frames = sampledFrames;
        }
      }

      const currentTypeName = availableTypes.find((t) => t.id === selectedType)?.name;
      const effectiveClarification =
        typeof explicitClarification === "string" ? explicitClarification.trim() : clarification.trim();

      const result = await interpretVisualEvidenceAction({
        mediaType: media.type,
        durationSeconds: media.type === "video" ? media.duration : undefined,
        clarification: effectiveClarification || undefined,
        imageSample,
        frames,
        suggestedType: currentTypeName,
        previousUnderstanding: understanding?.observedBehavior,
      });

      if (result?.understanding) {
        setUnderstanding(result.understanding);
      }
      if (result?.draft?.title) {
        setTitle(result.draft.title);
      }
      if (result?.draft?.description) {
        setDescription(result.draft.description);
      }
      if (result?.draft?.suggestedType) {
        const match = availableTypes.find(
          (t) => t.name.toLowerCase() === result.draft.suggestedType?.toLowerCase()
        );
        if (match) setSelectedType(match.id);
      }
    } catch {
      // Graceful fallback on network or unexpected error
      const fallback = generateFallbackAnalysis({
        mediaType: media.type,
        durationSeconds: media.type === "video" ? media.duration : undefined,
        clarification: explicitClarification || clarification || undefined,
        previousUnderstanding: understanding?.observedBehavior,
      });
      setUnderstanding(fallback.understanding);
      setTitle(fallback.draft.title);
      setDescription(fallback.draft.description);
    } finally {
      setIsInterpreting(false);
    }
  };

  const handleContinueToDetails = () => {
    setStep("details");
    handleRunAnalysis();
  };

  const handleConfirmUnderstanding = () => {
    setStep("review");
  };

  /* -------------------------------------------------------------
   * Form Submission
   * ------------------------------------------------------------- */
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const errors: Record<string, string> = {};

    if (title.trim().length < 3) {
      errors.title = "Title must be at least 3 characters";
    }

    if (description.trim().length < 10) {
      errors.description = "Description must be at least 10 characters";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});

    const formData = new FormData();
    formData.set("title", title.trim());
    formData.set("description", description.trim());
    if (selectedType) {
      formData.set("typeId", selectedType);
    }
    if (projectId) {
      formData.set("projectId", projectId);
    }
    formData.set("isReport", "true");

    startTransition(async () => {
      try {
        const result: ActionResult = await createBugAction(formData);
        if (result?.fieldErrors) {
          setFieldErrors(result.fieldErrors);
        } else if (result?.field && result?.error) {
          setFieldErrors({ [result.field]: result.error });
        } else if (result?.error) {
          setError(result.error);
        } else {
          handleClose();
          router.refresh();
        }
      } catch (err: unknown) {
        unstable_rethrow(err);
        const message = err instanceof Error ? err.message : "Failed to create idea. Please try again.";
        setError(message);
      }
    });
  };

  /* -------------------------------------------------------------
   * Navigation between steps
   * ------------------------------------------------------------- */
  const handleContinueFromChoose = () => {
    if (mode === "write") {
      setStep("review");
    } else if (mode === "record") {
      setStep("capture");
    } else if (mode === "capture") {
      setStep("capture");
      captureScreen();
    }
  };

  const handleBack = () => {
    if (step === "review") {
      if (mode === "write") {
        setStep("choose");
      } else {
        setStep("details");
      }
    } else if (step === "details") {
      setStep("capture");
    } else if (step === "capture") {
      cleanupMedia();
      setStep("choose");
    }
  };

  return (
    // Esc is handled by onCancel; onClick only catches a click on the
    // backdrop, which has no keyboard equivalent to add.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={dialogRef}
      aria-label="Add idea"
      onCancel={(e) => {
        e.preventDefault();
        handleClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      className="m-auto w-full max-w-[640px] overflow-hidden rounded-2xl border border-zk-border bg-zk-surface p-0 text-zk-text shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-xs"
    >
      <div className="relative flex flex-col p-6">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-zk-divider pb-4">
          <div className="flex items-center gap-2.5">
            {step !== "choose" && (
              <button
                type="button"
                onClick={handleBack}
                aria-label="Back"
                className="rounded-full p-1 text-zk-muted hover:bg-zk-chip hover:text-zk-text"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zk-tint text-zk-accent">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 3v18M3 12h18" />
                </svg>
              </span>
              <h2 className="text-base font-bold text-zk-text">Add idea</h2>
            </div>
          </div>

          {/* Stepper when beyond choose step */}
          {step !== "choose" && (
            <div className="flex items-center gap-2 text-xs font-semibold">
              {mode !== "write" ? (
                <>
                  {/* Step 1: Capture */}
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                        step === "details" || step === "review"
                          ? "border border-zk-accent text-zk-accent"
                          : "bg-zk-accent text-white"
                      }`}
                    >
                      {step === "details" || step === "review" ? "✓" : "1"}
                    </span>
                    <span className={step === "capture" ? "text-zk-accent font-bold" : "text-zk-muted"}>
                      Capture
                    </span>
                  </div>
                  <span className="text-zk-divider">──</span>
                  {/* Step 2: Details */}
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                        step === "review"
                          ? "border border-zk-accent text-zk-accent"
                          : step === "details"
                          ? "bg-zk-accent text-white"
                          : "border border-zk-border bg-zk-chip text-zk-muted"
                      }`}
                    >
                      {step === "review" ? "✓" : "2"}
                    </span>
                    <span className={step === "details" ? "text-zk-accent font-bold" : "text-zk-muted"}>
                      Details
                    </span>
                  </div>
                  <span className="text-zk-divider">──</span>
                  {/* Step 3: Review */}
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                        step === "review" ? "bg-zk-accent text-white" : "border border-zk-border bg-zk-chip text-zk-muted"
                      }`}
                    >
                      3
                    </span>
                    <span className={step === "review" ? "text-zk-accent font-bold" : "text-zk-muted"}>
                      Review
                    </span>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zk-accent text-[11px] font-bold text-white">
                    1
                  </span>
                  <span className="text-zk-accent font-bold">Write description</span>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="rounded-full p-1 text-zk-muted hover:bg-zk-chip hover:text-zk-text"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div role="alert" className="mt-3 rounded-xl border border-zk-bad-bd bg-zk-bad-bg p-3 text-xs text-zk-bad-fg">
            {error}
          </div>
        )}

        {/* =========================================================
         * STEP 1: Choose Option
         * ========================================================= */}
        {step === "choose" && (
          <div className="mt-4 flex flex-col space-y-5">
            <div>
              <p className="text-sm font-bold text-zk-text">How would you like to describe it?</p>
            </div>

            <div role="radiogroup" aria-label="Submission method" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {/* Option 1: Record screen */}
              <button
                type="button"
                role="radio"
                aria-checked={mode === "record"}
                onClick={() => setMode("record")}
                className={`flex min-h-[160px] cursor-pointer flex-col items-center justify-between rounded-2xl p-4 text-center transition ${
                  mode === "record"
                    ? "border-2 border-zk-accent bg-zk-tint/40 shadow-xs"
                    : "border border-zk-border bg-zk-surface hover:border-zk-muted/30 hover:bg-zk-chip/40"
                }`}
              >
                <div className="mt-2 flex h-11 w-11 items-center justify-center rounded-xl bg-zk-tint text-zk-accent">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m22 8-6 4 6 4V8Z" />
                    <rect width="14" height="12" x="2" y="6" rx="2" ry="2" />
                  </svg>
                </div>
                <div className="my-2">
                  <p className="text-sm font-bold text-zk-text">Record screen</p>
                  <p className="mt-1 text-xs text-zk-muted">Show the issue in a short video</p>
                </div>
                <div
                  className={`h-4 w-4 rounded-full border-2 transition ${
                    mode === "record" ? "border-zk-accent bg-zk-accent ring-2 ring-zk-tint" : "border-zk-border"
                  }`}
                />
              </button>

              {/* Option 2: Capture area */}
              <button
                type="button"
                role="radio"
                aria-checked={mode === "capture"}
                onClick={() => setMode("capture")}
                className={`flex min-h-[160px] cursor-pointer flex-col items-center justify-between rounded-2xl p-4 text-center transition ${
                  mode === "capture"
                    ? "border-2 border-zk-accent bg-zk-tint/40 shadow-xs"
                    : "border border-zk-border bg-zk-surface hover:border-zk-muted/30 hover:bg-zk-chip/40"
                }`}
              >
                <div className="mt-2 flex h-11 w-11 items-center justify-center rounded-xl bg-zk-chip text-zk-text2">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M6 3v3H3" />
                    <path d="M18 3v3h3" />
                    <path d="M6 21v-3H3" />
                    <path d="M18 21v-3h3" />
                    <rect x="7" y="7" width="10" height="10" rx="1" strokeDasharray="2 2" />
                  </svg>
                </div>
                <div className="my-2">
                  <p className="text-sm font-bold text-zk-text">Capture area</p>
                  <p className="mt-1 text-xs text-zk-muted">Take a screenshot of the problem</p>
                </div>
                <div
                  className={`h-4 w-4 rounded-full border-2 transition ${
                    mode === "capture" ? "border-zk-accent bg-zk-accent ring-2 ring-zk-tint" : "border-zk-border"
                  }`}
                />
              </button>

              {/* Option 3: Write description */}
              <button
                type="button"
                role="radio"
                aria-checked={mode === "write"}
                onClick={() => setMode("write")}
                className={`flex min-h-[160px] cursor-pointer flex-col items-center justify-between rounded-2xl p-4 text-center transition ${
                  mode === "write"
                    ? "border-2 border-zk-accent bg-zk-tint/40 shadow-xs"
                    : "border border-zk-border bg-zk-surface hover:border-zk-muted/30 hover:bg-zk-chip/40"
                }`}
              >
                <div className="mt-2 flex h-11 w-11 items-center justify-center rounded-xl bg-zk-chip text-zk-text2">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    <path d="m15 5 4 4" />
                  </svg>
                </div>
                <div className="my-2">
                  <p className="text-sm font-bold text-zk-text">Write description</p>
                  <p className="mt-1 text-xs text-zk-muted">Describe it using the issue template</p>
                </div>
                <div
                  className={`h-4 w-4 rounded-full border-2 transition ${
                    mode === "write" ? "border-zk-accent bg-zk-accent ring-2 ring-zk-tint" : "border-zk-border"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between pt-3">
              {onOpenInlineComposer ? (
                <button
                  type="button"
                  onClick={onOpenInlineComposer}
                  className="text-xs font-semibold text-zk-muted hover:text-zk-accent"
                >
                  Prefer inline composer? Open chat box
                </button>
              ) : (
                <div />
              )}
              <button
                type="button"
                onClick={handleContinueFromChoose}
                className="inline-flex min-h-10 items-center justify-center rounded-full bg-zk-accent px-6 text-sm font-bold text-white transition hover:opacity-95"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* =========================================================
         * STEP 2: Capture / Recording
         * ========================================================= */}
        {step === "capture" && (
          <div className="mt-4 flex flex-col space-y-4">
            {/* Screen Recording View */}
            {mode === "record" && (
              <div className="flex flex-col space-y-4">
                {recordState === "idle" && (
                  <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-zk-border p-10 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zk-tint text-zk-accent">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="m22 8-6 4 6 4V8Z" />
                        <rect width="14" height="12" x="2" y="6" rx="2" ry="2" />
                      </svg>
                    </div>
                    <h3 className="mt-3 text-sm font-bold text-zk-text">Ready to record</h3>
                    <p className="mt-1 max-w-sm text-xs text-zk-muted">
                      Select your screen, application window, or tab. Recording will capture what you show.
                    </p>
                    <button
                      type="button"
                      onClick={startRecording}
                      className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-full bg-zk-accent px-5 text-xs font-bold text-white transition hover:opacity-95"
                    >
                      <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                      Start recording
                    </button>
                  </div>
                )}

                {recordState === "recording" && (
                  <div className="flex flex-col items-center justify-center rounded-2xl border border-red-300 bg-red-50/50 p-10 text-center dark:bg-red-950/20">
                    <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                      <span className="h-3 w-3 animate-ping rounded-full bg-red-600 dark:bg-red-400" />
                      <span className="font-bold">Recording in progress</span>
                    </div>
                    <p className="mt-3 font-mono text-2xl font-extrabold text-zk-text">
                      {formatTime(recordSeconds)} <span className="text-sm font-normal text-zk-muted">/ 1:00</span>
                    </p>
                    <p className="mt-1 text-xs text-zk-muted">
                      Demonstrate the issue on your screen. You can stop anytime.
                    </p>
                    <button
                      type="button"
                      onClick={stopRecording}
                      className="mt-6 inline-flex min-h-10 items-center gap-2 rounded-full bg-red-600 px-6 text-xs font-bold text-white transition hover:bg-red-700"
                    >
                      <span className="h-2.5 w-2.5 rounded-xs bg-white" />
                      Stop recording
                    </button>
                  </div>
                )}

                {recordState === "recorded" && media?.type === "video" && (
                  <div className="flex flex-col space-y-4">
                    <div className="relative overflow-hidden rounded-2xl border border-zk-border bg-black/90 shadow-inner">
                      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                      <video
                        src={media.url}
                        controls
                        playsInline
                        className="max-h-[340px] w-full object-contain"
                      />
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        onClick={recordAgain}
                        className="inline-flex min-h-10 items-center gap-2 rounded-full border border-zk-border bg-zk-surface px-4 text-xs font-semibold text-zk-text hover:bg-zk-chip"
                      >
                        <span className="h-2 w-2 rounded-full bg-red-500" />
                        Record again
                      </button>
                      <button
                        type="button"
                        onClick={handleContinueToDetails}
                        className="inline-flex min-h-10 items-center justify-center rounded-full bg-zk-accent px-6 text-xs font-bold text-white transition hover:opacity-95"
                      >
                        Continue
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Area Cropper / Screenshot View */}
            {mode === "capture" && (
              <div className="flex flex-col space-y-3">
                {isCropping && rawScreenUrl ? (
                  <AreaCropper
                    imageSrc={rawScreenUrl}
                    onCropComplete={handleCropComplete}
                    onUseFull={handleUseFullScreenshot}
                    onRetake={handleRetakeScreenshot}
                    onCancel={() => {
                      cleanupMedia();
                      setStep("choose");
                    }}
                  />
                ) : media?.type === "screenshot" ? (
                  <div className="flex flex-col space-y-4">
                    <div className="flex max-h-[340px] items-center justify-center overflow-hidden rounded-2xl border border-zk-border bg-black/80 p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={media.url}
                        alt="Captured screenshot"
                        className="max-h-[320px] w-auto max-w-full rounded-lg object-contain"
                      />
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        onClick={handleRetakeScreenshot}
                        className="inline-flex min-h-10 items-center gap-2 rounded-full border border-zk-border bg-zk-surface px-4 text-xs font-semibold text-zk-text hover:bg-zk-chip"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                          <path d="M3 3v5h5" />
                          <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                          <path d="M16 21h5v-5" />
                        </svg>
                        Retake
                      </button>
                      <button
                        type="button"
                        onClick={handleContinueToDetails}
                        className="inline-flex min-h-10 items-center justify-center rounded-full bg-zk-accent px-6 text-xs font-bold text-white transition hover:opacity-95"
                      >
                        Continue
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-zk-border p-10 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zk-chip text-zk-text2">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="9" cy="9" r="2" />
                        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                      </svg>
                    </div>
                    <h3 className="mt-3 text-sm font-bold text-zk-text">Ready to capture area</h3>
                    <p className="mt-1 max-w-sm text-xs text-zk-muted">
                      Select your screen or window to capture. You can then crop to the problem area.
                    </p>
                    <button
                      type="button"
                      onClick={captureScreen}
                      className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-full bg-zk-accent px-5 text-xs font-bold text-white transition hover:opacity-95"
                    >
                      Capture screen
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* =========================================================
         * STEP 2.5: Review Evidence & AI Understanding (Details)
         * ========================================================= */}
        {step === "details" && (
          <div className="mt-4 flex flex-col space-y-4">
            <div>
              <h3 className="text-sm font-bold text-zk-text">Review evidence & AI interpretation</h3>
              <p className="mt-0.5 text-xs text-zk-muted">
                Review what Ziki understood from your demonstration. You can confirm or clarify before drafting.
              </p>
            </div>

            {/* Media Evidence Card */}
            {media && (
              <div className="flex items-center gap-3 rounded-xl border border-zk-border bg-zk-chip/30 p-2.5">
                <div className="relative flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black/80">
                  {media.type === "video" ? (
                    <>
                      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                      <video
                        src={media.url}
                        className="h-full w-full object-cover opacity-80"
                      />
                      <span className="absolute inset-0 flex items-center justify-center text-white">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </span>
                      <span className="absolute bottom-1 right-1 rounded-sm bg-black/80 px-1 py-0.2 text-[9px] font-mono font-bold text-white">
                        {formatTime(media.duration)}
                      </span>
                    </>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={media.url}
                      alt="Evidence thumbnail"
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-zk-text">
                    {media.type === "video" ? "Screen recording captured" : "Targeted screenshot captured"}
                  </p>
                  <p className="text-[11px] text-zk-muted">
                    {media.type === "video"
                      ? `${formatTime(media.duration)} demonstration stored locally in browser memory`
                      : "Cropped visual region stored locally in browser memory"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setStep("capture")}
                  className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold text-zk-muted hover:bg-zk-chip hover:text-zk-text"
                >
                  Change
                </button>
              </div>
            )}

            {/* AI Progress Indicator when interpreting */}
            {isInterpreting && (
              <div className="pt-1">
                <ClaudeWorking
                  statusText="Analyzing visual demonstration and drafting issue..."
                  steps={VISUAL_INTERPRETATION_STEPS}
                />
              </div>
            )}

            {/* AI Understanding Card (once interpreted) */}
            {!isInterpreting && understanding && (
              <div className="flex flex-col space-y-3 rounded-2xl border border-zk-border bg-zk-tint/20 p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-md bg-zk-accent text-white">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <path d="m12 2 1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2Z" />
                    </svg>
                  </span>
                  <span className="text-xs font-bold text-zk-text">Ziki&apos;s understanding</span>
                </div>

                <div className="space-y-1.5 text-xs">
                  <p className="font-semibold text-zk-text">
                    {understanding.observedBehavior}
                  </p>
                  <p className="text-[11px] text-zk-muted">
                    <span className="font-medium text-zk-text2">Detected Context:</span> {understanding.context}
                  </p>
                  <p className="text-[11px] text-zk-muted">
                    <span className="font-medium text-zk-text2">Inferred Intent:</span> {understanding.intent}
                  </p>
                </div>

                {/* Ambiguity notice if demonstration had ambiguous outcomes */}
                {understanding.isAmbiguous && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-200">
                    <div className="flex items-center gap-1.5 font-bold">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      Ambiguous Intent Detected
                    </div>
                    <p className="mt-1 text-[11px]">
                      The demonstration shows multiple interactions. Please confirm if this matches what you want to report, or clarify below.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Clarification / Correction Accordion or Form */}
            {!isInterpreting && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor={clarificationId} className="block text-xs font-semibold text-zk-text2">
                    {understanding ? "Need to correct or clarify anything?" : "What happened or what should change? (optional)"}
                  </label>
                  {understanding && !showClarifyInput && (
                    <button
                      type="button"
                      onClick={() => setShowClarifyInput(true)}
                      className="text-xs font-semibold text-zk-accent hover:underline"
                    >
                      + Clarify or correct
                    </button>
                  )}
                </div>

                {(showClarifyInput || !understanding) && (
                  <div className="space-y-2">
                    <textarea
                      id={clarificationId}
                      rows={3}
                      placeholder="e.g. Actually, the bug only happens when Dark mode is enabled, not Light mode..."
                      value={clarification}
                      onChange={(e) => setClarification(e.target.value)}
                      disabled={isInterpreting}
                      className="block w-full resize-none rounded-xl border border-zk-border bg-zk-surface p-3 text-xs text-zk-text placeholder:text-zk-muted focus:border-zk-accent focus:outline-hidden disabled:opacity-50"
                    />

                    {understanding && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleRunAnalysis(clarification)}
                          disabled={!clarification.trim() || isInterpreting}
                          className="inline-flex min-h-8 items-center rounded-lg border border-zk-border bg-zk-surface px-3 text-xs font-semibold text-zk-text hover:bg-zk-chip disabled:opacity-50"
                        >
                          Update with correction
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Details step footer actions */}
            <div className="flex items-center justify-between border-t border-zk-divider pt-4">
              <button
                type="button"
                onClick={() => setStep("capture")}
                disabled={isInterpreting}
                className="inline-flex min-h-10 items-center rounded-full border border-zk-border bg-zk-surface px-4 text-xs font-semibold text-zk-text hover:bg-zk-chip disabled:opacity-50"
              >
                Back to capture
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep("review")}
                  disabled={isInterpreting}
                  className="inline-flex min-h-10 items-center rounded-full px-3 text-xs font-semibold text-zk-muted hover:text-zk-text disabled:opacity-50"
                >
                  Skip to manual review
                </button>

                {understanding ? (
                  <button
                    type="button"
                    onClick={handleConfirmUnderstanding}
                    disabled={isInterpreting}
                    className="inline-flex min-h-10 items-center gap-2 rounded-full bg-zk-accent px-5 text-xs font-bold text-white transition hover:opacity-95 disabled:opacity-50"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Confirm &amp; continue to draft
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleRunAnalysis()}
                    disabled={isInterpreting}
                    className="inline-flex min-h-10 items-center gap-2 rounded-full bg-zk-accent px-5 text-xs font-bold text-white transition hover:opacity-95 disabled:opacity-50"
                  >
                    {isInterpreting ? (
                      <>
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <path d="m12 2 1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2Z" />
                        </svg>
                        Analyze demonstration
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* =========================================================
         * STEP 3: Review Issue Draft
         * ========================================================= */}
        {step === "review" && (
          <form noValidate onSubmit={handleSubmit} className="mt-4 flex flex-col space-y-4">
            <div>
              <h3 className="text-sm font-bold text-zk-text">Review issue draft</h3>
              <p className="mt-0.5 text-xs text-zk-muted">
                {media
                  ? `We've created a draft based on your ${media.type === "video" ? "recording" : "screenshot"}. You can make edits before submitting.`
                  : "Fill in the template details for your idea before submitting."}
              </p>
            </div>

            <div className={`grid gap-4 ${media ? "grid-cols-1 md:grid-cols-5" : "grid-cols-1"}`}>
              {/* Left Column: Form Fields */}
              <div className={`space-y-3 ${media ? "md:col-span-3" : ""}`}>
                {/* Type Selection */}
                <div>
                  <label htmlFor={typeId} className="block text-xs font-semibold text-zk-text2">
                    Type
                  </label>
                  <select
                    id={typeId}
                    value={selectedType}
                    onChange={(e) => setSelectedType(e.target.value)}
                    className="mt-1 block w-full rounded-xl border border-zk-border bg-zk-surface px-3 py-2 text-xs font-medium text-zk-text focus:border-zk-accent focus:outline-hidden"
                  >
                    {availableTypes.map((t) => (
                      <option key={t.id || "default"} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Title */}
                <div>
                  <label htmlFor={titleId} className="block text-xs font-semibold text-zk-text2">
                    Title
                  </label>
                  <input
                    id={titleId}
                    type="text"
                    required
                    placeholder="Short summary of the issue"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="mt-1 block w-full rounded-xl border border-zk-border bg-zk-surface px-3 py-2 text-xs text-zk-text placeholder:text-zk-muted focus:border-zk-accent focus:outline-hidden"
                  />
                  {fieldErrors.title && (
                    <p className="mt-1 text-[11px] font-medium text-zk-bad-fg">{fieldErrors.title}</p>
                  )}
                </div>

                {/* Description */}
                <div>
                  <label htmlFor={descId} className="block text-xs font-semibold text-zk-text2">
                    Description
                  </label>
                  <textarea
                    id={descId}
                    required
                    rows={7}
                    placeholder="Describe what happened or what you want changed..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="mt-1 block w-full resize-y font-mono text-xs leading-relaxed rounded-xl border border-zk-border bg-zk-surface p-3 text-zk-text placeholder:text-zk-muted focus:border-zk-accent focus:outline-hidden"
                  />
                  {fieldErrors.description && (
                    <p className="mt-1 text-[11px] font-medium text-zk-bad-fg">{fieldErrors.description}</p>
                  )}
                </div>
              </div>

              {/* Right Column: Media Preview Card */}
              {media && (
                <div className="flex flex-col space-y-2 md:col-span-2">
                  <div className="flex items-center justify-between">
                    <span className="block text-xs font-semibold text-zk-text2">Visual evidence</span>
                    <span className="rounded-full bg-zk-chip px-2 py-0.5 text-[10px] font-medium text-zk-muted">
                      Local preview (not attached)
                    </span>
                  </div>
                  <div className="relative flex flex-col overflow-hidden rounded-xl border border-zk-border bg-black/90 p-1.5 shadow-xs">
                    {media.type === "video" ? (
                      <div className="relative">
                        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                        <video
                          src={media.url}
                          controls
                          className="max-h-[180px] w-full rounded-lg object-contain"
                        />
                        <div className="absolute top-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-mono font-bold text-white">
                          {formatTime(media.duration)}
                        </div>
                      </div>
                    ) : (
                      <div className="flex max-h-[180px] items-center justify-center overflow-hidden rounded-lg">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={media.url}
                          alt="Captured evidence"
                          className="max-h-[180px] w-auto max-w-full object-contain"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between border-t border-zk-divider pt-4">
              <button
                type="button"
                onClick={handleBack}
                disabled={pending}
                className="inline-flex min-h-10 items-center rounded-full border border-zk-border bg-zk-surface px-4 text-xs font-semibold text-zk-text hover:bg-zk-chip disabled:opacity-50"
              >
                Edit details
              </button>

              <button
                type="submit"
                disabled={pending}
                className="inline-flex min-h-10 items-center justify-center rounded-full bg-zk-accent px-6 text-xs font-bold text-white transition hover:opacity-95 disabled:opacity-50"
              >
                {pending ? "Submitting..." : "Submit idea"}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
