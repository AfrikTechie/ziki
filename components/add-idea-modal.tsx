"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter, unstable_rethrow } from "next/navigation";
import { createBugAction, type ActionResult } from "@/app/actions/issues";
import { interpretVisualEvidenceAction } from "@/app/actions/visual-interpretation";
import {
  type InterpretationTimings,
  type KeyframeSample,
  type VisualInterpretationDetails,
} from "@/lib/visual-interpretation";
import { AreaCropper } from "@/components/area-cropper";

type Mode = "record" | "capture" | "write";
type Step = "choose" | "capture" | "details" | "review";

type MediaState =
  | { type: "video"; blob: Blob; url: string; duration: number }
  | { type: "screenshot"; blob: Blob; url: string; width?: number; height?: number };

type TypeOption = { id: string; name: string };

const FALLBACK_TYPES: TypeOption[] = [
  { id: "", name: "Bug" },
];

/**
 * Helper to snapshot a clean frame from an HTMLVideoElement onto an offscreen canvas.
 */
function captureVideoElementFrame(video: HTMLVideoElement, label: string): KeyframeSample | null {
  try {
    if (!video.videoWidth || !video.videoHeight) return null;
    const canvas = document.createElement("canvas");
    const width = Math.min(video.videoWidth || 1024, 1024);
    const aspect = (video.videoHeight || 576) / (video.videoWidth || 1024);
    canvas.width = width;
    canvas.height = Math.round(width * (aspect || 0.5625));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
    return { label, dataUrl };
  } catch {
    return null;
  }
}

/**
 * Extracts lightweight keyframes across the recording timeline using an offscreen canvas.
 * Held purely in temporary browser memory.
 */
async function extractVideoKeyframes(
  blob: Blob,
  hasNarration: boolean = false,
  explicitCount?: number,
  knownDuration?: number
): Promise<KeyframeSample[]> {
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
      }, 5000);

      video.onloadedmetadata = () => {
        // Chromium MediaRecorder WebM blobs report video.duration as Infinity.
        // Use knownDuration from recorder timer when available and finite.
        const effectiveDuration =
          knownDuration && isFinite(knownDuration) && knownDuration > 0
            ? knownDuration
            : isFinite(video.duration) && video.duration > 0
              ? video.duration
              : 1;
        const duration = Math.max(1, effectiveDuration);
        let samplePoints: Array<{ label: string; time: number }> = [];

        if (hasNarration) {
          // When voice narration is present, user explanation provides the narrative.
          // 2 or 3 targeted keyframes verify the initial UI state and the defect outcome.
          samplePoints = [
            { label: "Initial state / Context", time: Math.min(0.5, duration * 0.1) },
            ...(duration > 10 ? [{ label: "Demonstrated action", time: duration * 0.5 }] : []),
            {
              label: "Observed outcome / Defect",
              time: Math.max(0.5, Math.min(duration - 0.2, duration * 0.95)),
            },
          ];
        } else {
          // Without voice narration, sample 4 keyframes to visually reconstruct the action sequence.
          samplePoints = [
            { label: "Start of recording", time: Math.min(0.5, duration * 0.1) },
            { label: "Early action", time: duration * 0.35 },
            { label: "Mid-interaction", time: duration * 0.65 },
            {
              label: "Observed outcome",
              time: Math.max(0.5, Math.min(duration - 0.2, duration * 0.95)),
            },
          ];
        }

        if (typeof explicitCount === "number" && explicitCount > 0) {
          samplePoints = samplePoints.slice(0, explicitCount);
        }

        let currentIndex = 0;
        let perFrameTimer: NodeJS.Timeout | null = null;

        const captureFrameFromCanvas = () => {
          try {
            const canvas = document.createElement("canvas");
            const width = Math.min(video.videoWidth || 1024, 1024);
            const aspect = (video.videoHeight || 576) / (video.videoWidth || 1024);
            canvas.width = width;
            canvas.height = Math.round(width * (aspect || 0.5625));
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
        };

        const captureCurrentPoint = () => {
          if (currentIndex >= samplePoints.length) {
            if (perFrameTimer) clearTimeout(perFrameTimer);
            clearTimeout(timer);
            URL.revokeObjectURL(url);
            resolve(frames);
            return;
          }

          const targetTime = Math.max(0, Math.min(duration - 0.1, samplePoints[currentIndex].time));

          if (perFrameTimer) clearTimeout(perFrameTimer);
          perFrameTimer = setTimeout(() => {
            captureFrameFromCanvas();
            currentIndex++;
            captureCurrentPoint();
          }, 800);

          try {
            video.currentTime = targetTime;
          } catch {
            captureFrameFromCanvas();
            currentIndex++;
            captureCurrentPoint();
          }
        };

        video.onseeked = () => {
          if (perFrameTimer) {
            clearTimeout(perFrameTimer);
            perFrameTimer = null;
          }
          captureFrameFromCanvas();
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

/**
 * Formats AI errors into transparent, user-friendly messages rather than raw JSON or provider stack traces.
 */
function formatUserFriendlyAiError(rawError?: string): string {
  if (!rawError) {
    return "AI interpretation could not be completed. Your recorded demonstration is preserved, and you can retry or edit your draft directly.";
  }
  const lower = rawError.toLowerCase();
  if (
    lower.includes("zoderror") ||
    lower.includes('"expected"') ||
    lower.includes("invalid_type") ||
    lower.includes("incomplete or missing") ||
    lower.includes("empty response") ||
    lower.includes("invalid message structure") ||
    lower.includes("ai provider returned an empty response")
  ) {
    return "The AI analysis response was incomplete or formatted unexpectedly. Your demonstration has been preserved. You can retry the analysis or continue to edit the draft manually.";
  }
  if (
    lower.includes("rate limit") ||
    lower.includes("429") ||
    lower.includes("quota") ||
    lower.includes("credits") ||
    lower.includes("busy") ||
    lower.includes("overloaded")
  ) {
    return "The AI interpretation service is currently busy or rate-limited. Your demonstration is preserved. Please try again in a moment or continue to draft manually.";
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "Analysis took longer than expected (timed out after 25s). Your previous interpretation has been preserved. You can retry or proceed to the review step.";
  }
  if (
    lower.includes("fetch failed") ||
    lower.includes("enotfound") ||
    lower.includes("econnrefused") ||
    lower.includes("network error")
  ) {
    return "Could not connect to the AI provider service. Please check your network connection and configuration.";
  }
  if (lower.includes("openrouter api returned http") || lower.includes("openrouter error")) {
    return "The AI provider returned an error while processing your demonstration. Your recording is preserved. Please retry or continue to edit manually.";
  }
  return rawError.length > 250 ? `${rawError.slice(0, 247)}...` : rawError;
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
  const micStreamRef = useRef<MediaStream | null>(null);
  const liveFramesRef = useRef<KeyframeSample[]>([]);
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const speechRecRef = useRef<any>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);

  const [step, setStep] = useState<Step>("choose");
  const [mode, setMode] = useState<Mode>("record");

  // Recording states
  const [recordState, setRecordState] = useState<"idle" | "recording" | "recorded">("idle");
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [withAudio, setWithAudio] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [narration, setNarration] = useState("");
  const [isEditingNarration, setIsEditingNarration] = useState(false);
  const [editedNarration, setEditedNarration] = useState("");
  const [timings, setTimings] = useState<InterpretationTimings | null>(null);

  // Screenshot / Crop states
  const rawScreenBlobRef = useRef<Blob | null>(null);
  const [rawScreenUrl, setRawScreenUrl] = useState<string | null>(null);
  const [isCropping, setIsCropping] = useState(false);

  // Captured media held purely in browser memory
  const [media, setMedia] = useState<MediaState | null>(null);

  // Clarification & AI interpretation state
  const [clarification, setClarification] = useState("");
  const [understanding, setUnderstanding] = useState<VisualInterpretationDetails | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [showClarifyInput, setShowClarifyInput] = useState(false);
  const lastAnalyzedClarificationRef = useRef<string>("");

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
    if (speechRecRef.current) {
      try {
        speechRecRef.current.stop();
      } catch {
        // ignore
      }
      speechRecRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (liveVideoRef.current) {
      liveVideoRef.current.pause();
      liveVideoRef.current.srcObject = null;
      liveVideoRef.current = null;
    }
    liveFramesRef.current = [];
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
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
    rawScreenBlobRef.current = null;
    if (media) {
      URL.revokeObjectURL(media.url);
      setMedia(null);
    }
    setRecordState("idle");
    setRecordSeconds(0);
    setMicActive(false);
    setMicDenied(false);
    setIsCropping(false);
    setAiError(null);
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
      if (speechRecRef.current) {
        try {
          speechRecRef.current.stop();
        } catch {
          // ignore
        }
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
      if (liveVideoRef.current) {
        liveVideoRef.current.pause();
        liveVideoRef.current.srcObject = null;
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
      }
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
    lastAnalyzedClarificationRef.current = "";
    setNarration("");
    setIsEditingNarration(false);
    setEditedNarration("");
    setTimings(null);
    setWithAudio(false);
    setUnderstanding(null);
    setAiError(null);
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
    setMicDenied(false);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("Screen recording is not supported in this browser. Please use Chrome, Edge, Firefox, or Safari.");
      return;
    }

    try {
      // Clear previous frames and resources
      liveFramesRef.current = [];
      if (liveVideoRef.current) {
        liveVideoRef.current.pause();
        liveVideoRef.current.srcObject = null;
        liveVideoRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }

      // If voice narration is enabled, request microphone permission with enhancement constraints
      let micStream: MediaStream | null = null;
      if (withAudio && navigator.mediaDevices?.getUserMedia) {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          });
          micStreamRef.current = micStream;
          micStream.getAudioTracks().forEach((track) => {
            track.enabled = true;
          });
          setMicActive(true);
        } catch {
          // Microphone was denied or unavailable - notify user and proceed with video recording
          setMicDenied(true);
          setMicActive(false);
        }
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" },
        audio: true,
      });
      streamRef.current = stream;

      // Prioritize microphone audio track for direct, uncompressed voice narration recording
      const micAudioTracks =
        micStream && typeof micStream.getAudioTracks === "function" ? micStream.getAudioTracks() : [];
      const sysAudioTracks =
        typeof stream.getAudioTracks === "function" ? stream.getAudioTracks() : [];

      const micTrack = micAudioTracks[0];
      if (micTrack) {
        micTrack.enabled = true;
      }
      const audioTracks: MediaStreamTrack[] = micTrack ? [micTrack] : sysAudioTracks;

      const hasAudio = audioTracks.length > 0;
      let recordingStream = stream;
      if (hasAudio && typeof MediaStream !== "undefined") {
        try {
          const videoTracks = typeof stream.getVideoTracks === "function" ? stream.getVideoTracks() : [];
          recordingStream = new MediaStream([...videoTracks, ...audioTracks]);
        } catch {
          recordingStream = stream;
        }
      }

      // Start live speech recognition for live narration transcription if available
      let speechActive = false;
      if (micStream && typeof window !== "undefined") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRec) {
          speechActive = true;
          let accumulatedFinals = "";
          let lastSessionFinal = "";

          const initSpeechRec = () => {
            if (!speechActive) return;
            try {
              const rec = new SpeechRec();
              rec.continuous = true;
              rec.interimResults = true;
              rec.lang = typeof navigator !== "undefined" ? navigator.language : "en-US";

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              rec.onresult = (e: any) => {
                let sessionFinal = "";
                let sessionInterim = "";
                for (let i = 0; i < e.results.length; i++) {
                  const transcript = e.results[i][0]?.transcript || "";
                  if (e.results[i].isFinal) {
                    sessionFinal += transcript + " ";
                  } else {
                    sessionInterim += transcript + " ";
                  }
                }
                lastSessionFinal = sessionFinal;
                const combined = [accumulatedFinals, sessionFinal, sessionInterim]
                  .filter(Boolean)
                  .join(" ")
                  .replace(/\s+/g, " ")
                  .trim();
                if (combined) {
                  setNarration(combined);
                }
              };

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              rec.onerror = () => {
                // Non-fatal (e.g. no-speech when silent). Let onend restart if still active.
              };

              rec.onend = () => {
                if (speechActive && recorderRef.current && recorderRef.current.state === "recording") {
                  if (lastSessionFinal) {
                    accumulatedFinals = [accumulatedFinals, lastSessionFinal].filter(Boolean).join(" ").trim();
                    lastSessionFinal = "";
                  }
                  try {
                    rec.start();
                  } catch {
                    setTimeout(() => {
                      if (speechActive && recorderRef.current && recorderRef.current.state === "recording") {
                        initSpeechRec();
                      }
                    }, 200);
                  }
                }
              };

              rec.start();
              speechRecRef.current = rec;
            } catch {
              // Speech recognition fallback
            }
          };

          initSpeechRec();
        }
      }

      // Prioritize video+audio MIME types when audio tracks exist so Opus audio track is preserved
      const preferredMimeTypes = hasAudio
        ? [
            "video/webm;codecs=vp9,opus",
            "video/webm;codecs=vp8,opus",
            "video/webm;codecs=h264,opus",
            "video/webm",
            "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
            "video/mp4",
          ]
        : [
            "video/webm;codecs=vp9",
            "video/webm;codecs=vp8",
            "video/webm",
            "video/mp4",
          ];

      const mimeType =
        preferredMimeTypes.find(
          (type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)
        ) || "";

      const recorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;

      // Setup offscreen video element for real-time keyframe capture (browser environments only)
      if (
        typeof document !== "undefined" &&
        typeof navigator !== "undefined" &&
        !/jsdom/i.test(navigator.userAgent)
      ) {
        try {
          const liveVideo = document.createElement("video");
          liveVideo.muted = true;
          liveVideo.playsInline = true;
          liveVideo.srcObject = stream;
          liveVideoRef.current = liveVideo;
          liveVideo.play().catch(() => {});

          // Sample initial context keyframe at 400ms
          setTimeout(() => {
            if (liveVideoRef.current && recorderRef.current?.state === "recording") {
              const frame = captureVideoElementFrame(liveVideoRef.current, "Start of recording (t=0s)");
              if (frame) liveFramesRef.current.push(frame);
            }
          }, 400);
        } catch {
          // Offscreen preview optional in headless/test environments
        }
      }

      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      const start = Date.now();
      startTimeRef.current = start;

      recorder.onstop = () => {
        speechActive = false;
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        if (speechRecRef.current) {
          try {
            speechRecRef.current.stop();
          } catch {
            // ignore
          }
          speechRecRef.current = null;
        }
        if (audioContextRef.current) {
          audioContextRef.current.close().catch(() => {});
          audioContextRef.current = null;
        }
        if (liveVideoRef.current) {
          liveVideoRef.current.pause();
          liveVideoRef.current.srcObject = null;
          liveVideoRef.current = null;
        }
        if (micStreamRef.current) {
          micStreamRef.current.getTracks().forEach((track) => track.stop());
          micStreamRef.current = null;
        }
        setMicActive(false);

        const elapsed = Math.max(1, Math.floor((Date.now() - start) / 1000));
        const outputMimeType = recorder.mimeType || (hasAudio ? "video/webm" : mimeType || "video/webm");
        const blob = new Blob(chunks, { type: outputMimeType });
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
          if (liveVideoRef.current && recorder.state === "recording") {
            const elapsed = Math.max(1, Math.floor((Date.now() - start) / 1000));
            const frame = captureVideoElementFrame(
              liveVideoRef.current,
              `Observed outcome / Defect (t=${elapsed}s)`
            );
            if (frame) liveFramesRef.current.push(frame);
          }
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

        // Sample intermediate interaction keyframe every 5 seconds
        if (elapsed > 0 && elapsed % 5 === 0 && liveVideoRef.current) {
          const frame = captureVideoElementFrame(
            liveVideoRef.current,
            `Demonstrated interaction (t=${elapsed}s)`
          );
          if (frame) {
            if (liveFramesRef.current.length >= 3) {
              liveFramesRef.current.splice(1, 1, frame);
            } else {
              liveFramesRef.current.push(frame);
            }
          }
        }

        // Cap recording at 60 seconds for memory preservation
        if (elapsed >= 60) {
          if (recorder.state === "recording") {
            recorder.stop();
          }
        }
      }, 1000);
    } catch (err: unknown) {
      if (speechRecRef.current) {
        try {
          speechRecRef.current.stop();
        } catch {
          // ignore
        }
        speechRecRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      if (liveVideoRef.current) {
        liveVideoRef.current.pause();
        liveVideoRef.current.srcObject = null;
        liveVideoRef.current = null;
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((track) => track.stop());
        micStreamRef.current = null;
      }
      setMicActive(false);

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
    if (liveVideoRef.current && recorderRef.current && recorderRef.current.state === "recording") {
      const elapsed = Math.max(1, Math.floor((Date.now() - startTimeRef.current) / 1000));
      const frame = captureVideoElementFrame(
        liveVideoRef.current,
        `Observed outcome / Defect (t=${elapsed}s)`
      );
      if (frame) liveFramesRef.current.push(frame);
    }
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop();
    }
  };

  const recordAgain = () => {
    if (speechRecRef.current) {
      try {
        speechRecRef.current.stop();
      } catch {
        // ignore
      }
      speechRecRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (liveVideoRef.current) {
      liveVideoRef.current.pause();
      liveVideoRef.current.srcObject = null;
      liveVideoRef.current = null;
    }
    liveFramesRef.current = [];
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    setMicActive(false);
    if (media) {
      URL.revokeObjectURL(media.url);
      setMedia(null);
    }
    setRecordState("idle");
    setRecordSeconds(0);
    setNarration("");
    setIsEditingNarration(false);
    setEditedNarration("");
    setTimings(null);
    setUnderstanding(null);
    setAiError(null);
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
        rawScreenBlobRef.current = blob;
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

  const handleCropComplete = (croppedBlob: Blob, croppedUrl: string, width?: number, height?: number) => {
    if (rawScreenUrl) {
      URL.revokeObjectURL(rawScreenUrl);
      setRawScreenUrl(null);
    }
    rawScreenBlobRef.current = null;
    setMedia({ type: "screenshot", blob: croppedBlob, url: croppedUrl, width, height });
    setIsCropping(false);
    setUnderstanding(null);
  };

  const handleUseFullScreenshot = () => {
    if (!rawScreenUrl || !rawScreenBlobRef.current) return;
    const img = new Image();
    img.src = rawScreenUrl;
    setMedia({
      type: "screenshot",
      blob: rawScreenBlobRef.current,
      url: rawScreenUrl,
      width: img.naturalWidth || undefined,
      height: img.naturalHeight || undefined,
    });
    setIsCropping(false);
    setUnderstanding(null);
  };

  const handleRetakeScreenshot = () => {
    if (rawScreenUrl) {
      URL.revokeObjectURL(rawScreenUrl);
      setRawScreenUrl(null);
    }
    rawScreenBlobRef.current = null;
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
  const handleRunAnalysis = async (
    explicitClarification?: string,
    explicitNarration?: string
  ) => {
    if (!media) {
      setStep("review");
      return;
    }

    setError(null);
    setIsInterpreting(true);
    const clientStartTime = performance.now();

    try {
      const effectiveNarration =
        typeof explicitNarration === "string"
          ? explicitNarration.trim()
          : (isEditingNarration ? editedNarration : narration).trim();

      let imageSample: string | undefined = undefined;
      let frames: KeyframeSample[] | undefined = undefined;
      let frameExtractionMs: number | undefined = undefined;

      const frameStartTime = performance.now();
      if (media.type === "screenshot") {
        const dataUrl = await blobToDataUrl(media.blob);
        if (dataUrl) imageSample = dataUrl;
        frameExtractionMs = Math.round(performance.now() - frameStartTime);
      } else if (media.type === "video") {
        const hasNarration = Boolean(effectiveNarration);
        const targetFrames = hasNarration ? 2 : 4;
        let sampledFrames: KeyframeSample[] = [];

        // Use real-time frames captured directly from active recording stream if available
        if (liveFramesRef.current && liveFramesRef.current.length > 0) {
          sampledFrames = liveFramesRef.current.slice(0, targetFrames);
        }

        // Fallback to offscreen extraction using known recording duration
        if (sampledFrames.length === 0) {
          sampledFrames = await extractVideoKeyframes(
            media.blob,
            hasNarration,
            targetFrames,
            media.duration
          );
        }

        if (sampledFrames && sampledFrames.length > 0) {
          frames = sampledFrames;
        }
        frameExtractionMs = Math.round(performance.now() - frameStartTime);
      }

      const currentTypeName = availableTypes.find((t) => t.id === selectedType)?.name;
      const effectiveClarification =
        typeof explicitClarification === "string" ? explicitClarification.trim() : clarification.trim();
      lastAnalyzedClarificationRef.current = effectiveClarification;

      const actionStartTime = performance.now();

      // 45-second timeout safeguard to allow full multimodal model inference
      let timeoutId: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error("Analysis took longer than expected (timed out after 45s). You can retry or draft manually."));
        }, 45000);
      });

      const analysisPromise = interpretVisualEvidenceAction({
        mediaType: media.type,
        durationSeconds: media.type === "video" ? media.duration : undefined,
        clarification: effectiveClarification || undefined,
        narration: effectiveNarration || undefined,
        imageSample,
        frames,
        suggestedType: currentTypeName,
        previousUnderstanding: understanding
          ? `Observed behavior: ${understanding.observedBehavior}. Context: ${understanding.context}. Intent: ${understanding.intent}.`
          : undefined,
      });

      const result = await Promise.race([analysisPromise, timeoutPromise]);
      if (timeoutId) clearTimeout(timeoutId);

      const serverActionMs = Math.round(performance.now() - actionStartTime);
      const totalClientMs = Math.round(performance.now() - clientStartTime);

      const combinedTimings: InterpretationTimings = {
        frameExtractionMs,
        serverActionMs,
        claudeApiMs: result.timings?.claudeApiMs,
        providerApiMs: result.timings?.providerApiMs,
        provider: result.timings?.provider || result.provider,
        validationMs: result.timings?.validationMs,
        totalServerMs: result.timings?.totalServerMs,
        totalClientMs,
      };
      setTimings(combinedTimings);

      if (result.success) {
        setUnderstanding(result.understanding);
        setAiError(null);
        if (result.draft.title) {
          setTitle(result.draft.title);
        }
        if (result.draft.description) {
          setDescription(result.draft.description);
        }
        if (result.draft.suggestedType) {
          const match = availableTypes.find(
            (t) => t.name.toLowerCase() === result.draft.suggestedType.toLowerCase()
          );
          if (match) setSelectedType(match.id);
        }
      } else {
        // Preserve existing understanding if an update attempt fails
        setAiError(formatUserFriendlyAiError(result.error));
        if (result.fallbackDraft) {
          setTitle(result.fallbackDraft.title);
          setDescription(result.fallbackDraft.description);
        }
      }
    } catch (err: unknown) {
      // Preserve existing understanding on unexpected error/timeout
      const msg = err instanceof Error ? err.message : "Network error during visual analysis";
      setAiError(formatUserFriendlyAiError(msg));
      const totalClientMs = Math.round(performance.now() - clientStartTime);
      setTimings((prev) => ({
        ...prev,
        totalClientMs,
      }));
    } finally {
      setIsInterpreting(false);
    }
  };

  const handleContinueToDetails = () => {
    setStep("details");
    handleRunAnalysis();
  };

  const handleConfirmUnderstanding = async () => {
    if (clarification.trim() && clarification.trim() !== lastAnalyzedClarificationRef.current) {
      await handleRunAnalysis(clarification.trim());
    }
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
                  <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-zk-border p-8 text-center">
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

                    {/* Microphone toggle */}
                    <div className="mt-4 flex w-full max-w-sm items-center justify-between rounded-xl border border-zk-border bg-zk-chip/40 px-3.5 py-2.5 text-left transition hover:bg-zk-chip/60">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`flex h-7 w-7 items-center justify-center rounded-lg transition ${
                            withAudio ? "bg-zk-accent text-white" : "bg-zk-surface text-zk-muted"
                          }`}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            <line x1="12" x2="12" y1="19" y2="22" />
                          </svg>
                        </span>
                        <div>
                          <p className="text-xs font-semibold text-zk-text">Record voice narration</p>
                          <p className="text-[11px] text-zk-muted">Explain what you are demonstrating</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={withAudio}
                        aria-label="Toggle voice narration"
                        onClick={() => setWithAudio(!withAudio)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                          withAudio ? "bg-zk-accent" : "bg-zk-border"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                            withAudio ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>

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

                    {withAudio && micActive && (
                      <div className="mt-3 flex items-center gap-1.5 rounded-full bg-zk-accent/15 px-3 py-1 text-xs font-semibold text-zk-accent">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                          <line x1="12" x2="12" y1="19" y2="22" />
                        </svg>
                        Microphone active (recording voice)
                      </div>
                    )}
                    {micDenied && (
                      <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                        Microphone permission denied; recording screen without audio.
                      </p>
                    )}

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
                        muted={false}
                        autoPlay={false}
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
                    <div className="relative flex max-h-[340px] items-center justify-center overflow-hidden rounded-2xl border border-zk-border bg-black/80 p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={media.url}
                        alt="Captured screenshot"
                        className="max-h-[320px] w-auto max-w-full rounded-lg object-contain shadow-xs"
                      />
                      {media.width && media.height ? (
                        <div className="absolute top-3 right-3 rounded-md bg-black/75 px-2 py-0.5 text-[10px] font-mono font-bold text-white backdrop-blur-xs">
                          {media.width} × {media.height}
                        </div>
                      ) : null}
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

            {/* Scrollable middle body so long AI interpretation and clarification fit cleanly */}
            <div className="flex flex-col space-y-4 max-h-[min(52vh,460px)] overflow-y-auto pr-1">
              {/* Media Evidence Card */}
            {media && (
              <div className="flex items-center gap-3 rounded-xl border border-zk-border bg-zk-chip/30 p-2.5">
                <div className="relative flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black/80 p-0.5">
                  {media.type === "video" ? (
                    <>
                      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                      <video
                        src={media.url}
                        className="h-full w-full object-contain opacity-80"
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
                      className="h-full w-full object-contain"
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
                      : media.width && media.height
                      ? `${media.width} × ${media.height} cropped region stored locally in browser memory`
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

            {/* Voice narration transcript */}
            {narration ? (
              <div className="flex flex-col space-y-2 rounded-xl border border-zk-border bg-zk-chip/30 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-zk-accent text-white">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" x2="12" y1="19" y2="22" />
                      </svg>
                    </span>
                    <span className="text-xs font-bold text-zk-text">Voice narration</span>
                    <span className="text-[10px] text-zk-muted">Recorded via microphone</span>
                  </div>
                  {!isEditingNarration && !isInterpreting && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditedNarration(narration);
                        setIsEditingNarration(true);
                      }}
                      className="text-xs font-semibold text-zk-accent hover:underline"
                    >
                      Edit transcript
                    </button>
                  )}
                </div>

                {isEditingNarration ? (
                  <div className="space-y-2 pt-1">
                    <textarea
                      rows={3}
                      value={editedNarration}
                      onChange={(e) => setEditedNarration(e.target.value)}
                      disabled={isInterpreting}
                      aria-label="Edit voice narration transcript"
                      placeholder="Review or edit your spoken narration transcript..."
                      className="block w-full resize-none rounded-lg border border-zk-border bg-zk-surface p-2.5 text-xs text-zk-text placeholder:text-zk-muted focus:border-zk-accent focus:outline-hidden"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setIsEditingNarration(false)}
                        className="rounded-md px-2.5 py-1 text-xs font-semibold text-zk-muted hover:text-zk-text"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const updated = editedNarration.trim();
                          setNarration(updated);
                          setIsEditingNarration(false);
                          handleRunAnalysis(undefined, updated);
                        }}
                        disabled={!editedNarration.trim() || isInterpreting}
                        className="inline-flex items-center rounded-md bg-zk-accent px-3 py-1 text-xs font-semibold text-white transition hover:opacity-95 disabled:opacity-50"
                      >
                        Update &amp; re-analyze
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-zk-text italic leading-relaxed">&ldquo;{narration}&rdquo;</p>
                )}
              </div>
            ) : withAudio && media?.type === "video" ? (
              <div className="flex flex-col space-y-2 rounded-xl border border-zk-border bg-zk-chip/20 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-zk-accent/20 text-zk-accent">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" x2="12" y1="19" y2="22" />
                      </svg>
                    </span>
                    <div>
                      <span className="text-xs font-semibold text-zk-text">Voice narration recorded</span>
                      <p className="text-[11px] text-zk-muted">Audio track is active and audible during video playback</p>
                    </div>
                  </div>
                  {!isEditingNarration && !isInterpreting && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditingNarration(true);
                        setEditedNarration("");
                      }}
                      className="text-xs font-semibold text-zk-accent hover:underline"
                    >
                      + Add spoken notes
                    </button>
                  )}
                </div>

                {isEditingNarration && (
                  <div className="space-y-2 pt-1">
                    <textarea
                      rows={3}
                      value={editedNarration}
                      onChange={(e) => setEditedNarration(e.target.value)}
                      disabled={isInterpreting}
                      aria-label="Add voice narration notes"
                      placeholder="Type what you explained in your voice narration..."
                      className="block w-full resize-none rounded-lg border border-zk-border bg-zk-surface p-2.5 text-xs text-zk-text placeholder:text-zk-muted focus:border-zk-accent focus:outline-hidden"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setIsEditingNarration(false)}
                        className="rounded-md px-2.5 py-1 text-xs font-semibold text-zk-muted hover:text-zk-text"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const updated = editedNarration.trim();
                          setNarration(updated);
                          setIsEditingNarration(false);
                          handleRunAnalysis(undefined, updated);
                        }}
                        disabled={!editedNarration.trim() || isInterpreting}
                        className="inline-flex items-center rounded-md bg-zk-accent px-3 py-1 text-xs font-semibold text-white transition hover:opacity-95 disabled:opacity-50"
                      >
                        Add &amp; analyze
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {/* AI Progress Indicator when interpreting */}
            {isInterpreting && (
              <div className="flex flex-col space-y-3 rounded-2xl border border-zk-border/80 bg-zk-chip/30 p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 relative flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-zk-accent text-white shadow-xs">
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="motion-safe:animate-spin"
                      aria-hidden="true"
                    >
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-zk-text">
                      {narration
                        ? "Understanding demonstration and voice narration…"
                        : "Understanding visual demonstration…"}
                    </p>
                    <p className="mt-0.5 text-[11px] text-zk-muted leading-relaxed">
                      Synthesizing screen evidence to prepare a proposed issue draft for your review.
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-zk-divider/50 pt-2.5 text-xs">
                  <span className="text-[11px] text-zk-muted">
                    Usually takes 5–15 seconds
                  </span>
                  <button
                    type="button"
                    onClick={() => setStep("review")}
                    className="font-semibold text-zk-muted hover:text-zk-accent underline decoration-dotted"
                  >
                    Skip waiting &amp; draft manually &rarr;
                  </button>
                </div>
              </div>
            )}

            {/* AI Error / Unavailable Notice */}
            {!isInterpreting && aiError && !understanding && (
              <div className="flex flex-col space-y-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
                <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span className="text-xs font-bold">Live AI interpretation unavailable</span>
                </div>
                <p className="text-xs text-zk-muted">
                  {aiError}
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleRunAnalysis()}
                    className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-zk-border bg-zk-surface px-3 text-xs font-semibold text-zk-text hover:bg-zk-chip"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                      <path d="M3 3v5h5" />
                      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                      <path d="M16 21h5v-5" />
                    </svg>
                    Retry analysis
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep("review")}
                    className="inline-flex min-h-8 items-center rounded-lg bg-zk-accent px-3 text-xs font-bold text-white transition hover:opacity-95"
                  >
                    Continue to draft manually
                  </button>
                </div>
              </div>
            )}

            {/* AI Understanding Card (once interpreted) */}
            {!isInterpreting && understanding && (
              <div className="flex flex-col space-y-3 rounded-2xl border border-zk-border bg-zk-tint/20 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-zk-accent text-white">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="m12 2 1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2Z" />
                      </svg>
                    </span>
                    <span className="text-xs font-bold text-zk-text">Ziki&apos;s understanding</span>
                  </div>
                  <span className="rounded-full bg-zk-accent/15 px-2 py-0.5 text-[10px] font-semibold text-zk-accent">
                    Proposed understanding
                  </span>
                </div>
                <p className="text-[11px] text-zk-muted">
                  Proposed interpretation synthesized from your demonstration. You can review, clarify, or edit before creating your issue draft.
                </p>

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

            {/* Notice if an update/correction attempt failed, while keeping previous understanding intact */}
            {!isInterpreting && aiError && understanding && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                <div className="flex items-center gap-1.5 font-bold">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>Could not update with correction</span>
                </div>
                <p className="mt-1 text-[11px] text-zk-muted">
                  {aiError}
                </p>
              </div>
            )}

            {/* Execution timing diagnosis metrics */}
            {!isInterpreting && timings && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-zk-border/60 bg-zk-chip/25 px-3 py-2 text-[11px] text-zk-muted">
                <span className="font-semibold text-zk-text2">
                  ⚡ Total: {timings.totalClientMs !== undefined ? `${(timings.totalClientMs / 1000).toFixed(2)}s` : `${((timings.totalServerMs || 0) / 1000).toFixed(2)}s`}
                </span>
                {timings.claudeApiMs !== undefined && (
                  <span>
                    {timings.provider === "gemini"
                      ? "Gemini API"
                      : timings.provider === "openrouter"
                      ? "OpenRouter API"
                      : "Claude API"}
                    : {(timings.claudeApiMs / 1000).toFixed(2)}s
                  </span>
                )}
                {timings.frameExtractionMs !== undefined && (
                  <span>Frames: {timings.frameExtractionMs}ms</span>
                )}
                {timings.serverActionMs !== undefined && (
                  <span>Server Action: {timings.serverActionMs}ms</span>
                )}
                {timings.validationMs !== undefined && (
                  <span>Validation: {timings.validationMs}ms</span>
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
            </div>

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

            {/* Scrollable form body so long descriptions or previews fit within viewport */}
            <div className="max-h-[min(54vh,480px)] overflow-y-auto pr-1">
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
                          playsInline
                          autoPlay={false}
                          muted={false}
                          className="max-h-[180px] w-full rounded-lg object-contain"
                        />
                        <div className="absolute top-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-mono font-bold text-white">
                          {formatTime(media.duration)}
                        </div>
                      </div>
                    ) : (
                      <div className="relative flex max-h-[180px] items-center justify-center overflow-hidden rounded-lg">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={media.url}
                          alt="Captured evidence"
                          className="max-h-[180px] w-auto max-w-full object-contain"
                        />
                        {media.width && media.height ? (
                          <div className="absolute top-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-mono font-bold text-white">
                            {media.width} × {media.height}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
              )}
              </div>
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
