"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createBugAction, type ActionResult } from "@/app/actions/issues";
import { AreaCropper } from "@/components/area-cropper";

type Mode = "record" | "capture" | "write";
type Step = "choose" | "capture" | "review";

type MediaState =
  | { type: "video"; blob: Blob; url: string; duration: number }
  | { type: "screenshot"; blob: Blob; url: string; width?: number; height?: number };

type TypeOption = { id: string; name: string };

const FALLBACK_TYPES: TypeOption[] = [
  { id: "", name: "Bug" },
];

export function AddIdeaModal({
  projectId,
  isOpen,
  onClose,
  types = [],
}: {
  projectId?: string;
  isOpen: boolean;
  onClose: () => void;
  types?: TypeOption[];
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

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
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop();
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

  const handleClose = useCallback(() => {
    cleanupMedia();
    setStep("choose");
    setTitle("");
    setDescription("");
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
      setError("Screen recording is not supported in this browser. Please use a modern desktop browser (Chrome, Edge, Firefox, Safari).");
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

      recorder.onstop = () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        const blob = new Blob(chunks, { type: mimeType || "video/webm" });
        const url = URL.createObjectURL(blob);
        setMedia({ type: "video", blob, url, duration: recordSeconds || 1 });
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

      const startTime = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setRecordSeconds(elapsed);
        // Cap recording at 60 seconds for memory and attachment size preservation
        if (elapsed >= 60) {
          if (recorder.state === "recording") {
            recorder.stop();
          }
        }
      }, 1000);
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      if (e.name === "NotAllowedError") {
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

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" },
        audio: false,
      });

      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;

      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => {
          video.play().then(() => resolve()).catch(() => resolve());
        };
      });

      // Small delay to ensure frame is painted
      await new Promise((r) => setTimeout(r, 200));

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1920;
      canvas.height = video.videoHeight || 1080;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(video, 0, 0);

      // Stop all tracks immediately
      stream.getTracks().forEach((track) => track.stop());

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
      if (e.name === "NotAllowedError") {
        setError("Screen capture was cancelled or permission was denied.");
      } else {
        setError(e.message || "Could not capture screen. Try again.");
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
  };

  const handleUseFullScreenshot = () => {
    if (!rawScreenUrl) return;
    fetch(rawScreenUrl)
      .then((res) => res.blob())
      .then((blob) => {
        setMedia({ type: "screenshot", blob, url: rawScreenUrl });
        setIsCropping(false);
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
    captureScreen();
  };

  /* -------------------------------------------------------------
   * Form Submission (Phase 1: Preserves existing Ziki action)
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
        if (result?.error) {
          setError(result.error);
        } else {
          handleClose();
          router.refresh();
        }
      } catch (err: unknown) {
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
      // Auto-trigger recording or prompt
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
        setStep("capture");
      }
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
      onCancel={(e) => {
        e.preventDefault();
        handleClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      className="m-auto w-full max-w-[620px] overflow-hidden rounded-2xl border border-zk-border bg-zk-surface p-0 text-zk-text shadow-2xl backdrop:bg-slate-900/40 backdrop:backdrop-blur-xs"
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

          {/* Stepper when in capture or review */}
          {step !== "choose" && (
            <div className="flex items-center gap-2 text-xs font-semibold">
              <div className="flex items-center gap-1.5">
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                    step === "review"
                      ? "bg-blue-600 text-white"
                      : "bg-blue-600 text-white"
                  }`}
                >
                  {step === "review" ? "✓" : "1"}
                </span>
                <span className={step === "capture" ? "text-blue-600 font-bold" : "text-zk-muted"}>
                  Capture
                </span>
              </div>
              <span className="text-zk-divider">──</span>
              <div className="flex items-center gap-1.5">
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                    step === "review" ? "bg-blue-600 text-white" : "bg-zk-chip text-zk-muted"
                  }`}
                >
                  {step === "review" ? "✓" : "2"}
                </span>
                <span className="text-zk-muted">Details</span>
              </div>
              <span className="text-zk-divider">──</span>
              <div className="flex items-center gap-1.5">
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                    step === "review" ? "bg-blue-600 text-white font-bold" : "bg-zk-chip text-zk-muted"
                  }`}
                >
                  3
                </span>
                <span className={step === "review" ? "text-blue-600 font-bold" : "text-zk-muted"}>
                  Review
                </span>
              </div>
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
          <div className="mt-3 rounded-xl border border-zk-bad-border bg-zk-bad-bg p-3 text-xs text-zk-bad-fg">
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

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {/* Option 1: Record screen */}
              <button
                type="button"
                onClick={() => setMode("record")}
                className={`flex min-h-[160px] cursor-pointer flex-col items-center justify-between rounded-2xl p-4 text-center transition ${
                  mode === "record"
                    ? "border-2 border-blue-600 bg-blue-50/40 shadow-xs"
                    : "border border-zk-border bg-zk-surface hover:border-slate-300 hover:bg-zk-chip/40"
                }`}
              >
                <div className="mt-2 flex h-11 w-11 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
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
                    mode === "record" ? "border-blue-600 bg-blue-600 ring-2 ring-blue-200" : "border-slate-300"
                  }`}
                />
              </button>

              {/* Option 2: Capture area */}
              <button
                type="button"
                onClick={() => setMode("capture")}
                className={`flex min-h-[160px] cursor-pointer flex-col items-center justify-between rounded-2xl p-4 text-center transition ${
                  mode === "capture"
                    ? "border-2 border-blue-600 bg-blue-50/40 shadow-xs"
                    : "border border-zk-border bg-zk-surface hover:border-slate-300 hover:bg-zk-chip/40"
                }`}
              >
                <div className="mt-2 flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
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
                    mode === "capture" ? "border-blue-600 bg-blue-600 ring-2 ring-blue-200" : "border-slate-300"
                  }`}
                />
              </button>

              {/* Option 3: Write description */}
              <button
                type="button"
                onClick={() => setMode("write")}
                className={`flex min-h-[160px] cursor-pointer flex-col items-center justify-between rounded-2xl p-4 text-center transition ${
                  mode === "write"
                    ? "border-2 border-blue-600 bg-blue-50/40 shadow-xs"
                    : "border border-zk-border bg-zk-surface hover:border-slate-300 hover:bg-zk-chip/40"
                }`}
              >
                <div className="mt-2 flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    <path d="m15 5 4 4" />
                  </svg>
                </div>
                <div className="my-2">
                  <p className="text-sm font-bold text-zk-text">Write description</p>
                  <p className="mt-1 text-xs text-zk-muted">Describe it with a few details</p>
                </div>
                <div
                  className={`h-4 w-4 rounded-full border-2 transition ${
                    mode === "write" ? "border-blue-600 bg-blue-600 ring-2 ring-blue-200" : "border-slate-300"
                  }`}
                />
              </button>
            </div>

            <div className="flex justify-end pt-3">
              <button
                type="button"
                onClick={handleContinueFromChoose}
                className="inline-flex min-h-10 items-center justify-center rounded-full bg-blue-600 px-6 text-sm font-bold text-white transition hover:bg-blue-700"
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
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-600">
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
                      className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-full bg-blue-600 px-5 text-xs font-bold text-white transition hover:bg-blue-700"
                    >
                      <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                      Start recording
                    </button>
                  </div>
                )}

                {recordState === "recording" && (
                  <div className="flex flex-col items-center justify-center rounded-2xl border border-red-200 bg-red-50/50 p-10 text-center">
                    <div className="flex items-center gap-2 text-red-600">
                      <span className="h-3 w-3 animate-ping rounded-full bg-red-600" />
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
                    <div className="relative overflow-hidden rounded-2xl border border-zk-border bg-slate-950 shadow-inner">
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
                        onClick={() => setStep("review")}
                        className="inline-flex min-h-10 items-center justify-center rounded-full bg-blue-600 px-6 text-xs font-bold text-white transition hover:bg-blue-700"
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
                    <div className="flex max-h-[340px] items-center justify-center overflow-hidden rounded-2xl border border-zk-border bg-slate-950/60 p-2">
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
                        onClick={() => setStep("review")}
                        className="inline-flex min-h-10 items-center justify-center rounded-full bg-blue-600 px-6 text-xs font-bold text-white transition hover:bg-blue-700"
                      >
                        Continue
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-zk-border p-10 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-700">
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
                      className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-full bg-blue-600 px-5 text-xs font-bold text-white transition hover:bg-blue-700"
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
         * STEP 3: Review Issue Draft (Mockup Panel 4!)
         * ========================================================= */}
        {step === "review" && (
          <form noValidate onSubmit={handleSubmit} className="mt-4 flex flex-col space-y-4">
            <div>
              <h3 className="text-sm font-bold text-zk-text">Review issue draft</h3>
              <p className="mt-0.5 text-xs text-zk-muted">
                {media
                  ? "We've created a draft based on your capture. You can make edits before submitting."
                  : "Fill in the details for your idea before submitting."}
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
                    className="mt-1 block w-full rounded-xl border border-zk-border bg-zk-surface px-3 py-2 text-xs font-medium text-zk-text focus:border-blue-600 focus:outline-hidden"
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
                    placeholder="Short summary of the idea"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="mt-1 block w-full rounded-xl border border-zk-border bg-zk-surface px-3 py-2 text-xs text-zk-text placeholder:text-zk-muted focus:border-blue-600 focus:outline-hidden"
                  />
                  {fieldErrors.title && (
                    <p className="mt-1 text-[11px] font-medium text-red-600">{fieldErrors.title}</p>
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
                    rows={4}
                    placeholder="Describe what happened or what you want changed..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="mt-1 block w-full resize-y rounded-xl border border-zk-border bg-zk-surface p-3 text-xs leading-relaxed text-zk-text placeholder:text-zk-muted focus:border-blue-600 focus:outline-hidden"
                  />
                  {fieldErrors.description && (
                    <p className="mt-1 text-[11px] font-medium text-red-600">{fieldErrors.description}</p>
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
                  <div className="relative flex flex-col overflow-hidden rounded-xl border border-zk-border bg-slate-950 p-1.5 shadow-xs">
                    {media.type === "video" ? (
                      <div className="relative">
                        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                        <video
                          src={media.url}
                          controls
                          className="max-h-[160px] w-full rounded-lg object-contain"
                        />
                        <div className="absolute top-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-mono font-bold text-white">
                          {formatTime(media.duration)}
                        </div>
                      </div>
                    ) : (
                      <div className="flex max-h-[160px] items-center justify-center overflow-hidden rounded-lg">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={media.url}
                          alt="Captured evidence"
                          className="max-h-[160px] w-auto max-w-full object-contain"
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
                className="inline-flex min-h-10 items-center justify-center rounded-full bg-blue-600 px-6 text-xs font-bold text-white transition hover:bg-blue-700 disabled:opacity-50"
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

