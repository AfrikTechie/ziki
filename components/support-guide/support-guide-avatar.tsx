"use client";

import React from "react";

export type AvatarSize = "sm" | "md" | "lg" | "xl";

interface SupportGuideAvatarProps {
  size?: AvatarSize;
  className?: string;
  isOnline?: boolean;
  animated?: boolean;
}

const SIZE_MAP: Record<AvatarSize, { px: number; iconSize: number }> = {
  sm: { px: 32, iconSize: 20 },
  md: { px: 44, iconSize: 26 },
  lg: { px: 56, iconSize: 34 },
  xl: { px: 68, iconSize: 42 },
};

/**
 * Human Customer Support & Guide Agent Avatar.
 * Features a friendly robotic helper wearing a customer support headset
 * with glowing warm eyes, friendly expression, and an active green status beacon.
 */
export function SupportGuideAvatar({
  size = "md",
  className = "",
  isOnline = true,
  animated = true,
}: SupportGuideAvatarProps) {
  const { px } = SIZE_MAP[size];

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 select-none ${className}`}
      style={{ width: px, height: px }}
    >
      <svg
        viewBox="0 0 64 64"
        width={px}
        height={px}
        className={`w-full h-full drop-shadow-sm ${
          animated ? "transition-transform duration-300 hover:scale-105" : ""
        }`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="sg-bg-gradient" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#3978f6" />
            <stop offset="100%" stopColor="#1f4ab8" />
          </linearGradient>
          <linearGradient id="sg-face-gradient" x1="16" y1="18" x2="48" y2="50" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#eaf2fe" />
          </linearGradient>
          <linearGradient id="sg-visor-gradient" x1="20" y1="26" x2="44" y2="38" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#0b1733" />
            <stop offset="100%" stopColor="#152449" />
          </linearGradient>
          <radialGradient id="sg-eye-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#5eead4" />
            <stop offset="70%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#0284c7" />
          </radialGradient>
        </defs>

        {/* Outer Circular Aura */}
        <circle cx="32" cy="32" r="30" fill="url(#sg-bg-gradient)" />
        <circle cx="32" cy="32" r="28" stroke="rgba(255, 255, 255, 0.25)" strokeWidth="1.5" />

        {/* Antenna with beacon glow */}
        <path d="M32 16V9" stroke="#cbd5e1" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="32" cy="8" r="3.5" fill="#34d399" className={animated ? "animate-pulse" : ""} />
        <circle cx="32" cy="8" r="6" stroke="#34d399" strokeWidth="1" opacity="0.4" />

        {/* Head Base */}
        <rect
          x="16"
          y="17"
          width="32"
          height="30"
          rx="12"
          fill="url(#sg-face-gradient)"
          stroke="#cbd5e1"
          strokeWidth="1.5"
        />

        {/* Support Headset Band */}
        <path
          d="M13 32C13 20 20 14 32 14C44 14 51 20 51 32"
          stroke="#0b1733"
          strokeWidth="3.2"
          strokeLinecap="round"
        />

        {/* Left Ear Cushion */}
        <rect x="11" y="27" width="5.5" height="11" rx="2.75" fill="#0b1733" />
        <rect x="12" y="28.5" width="3.5" height="8" rx="1.75" fill="#3978f6" />

        {/* Right Ear Cushion */}
        <rect x="47.5" y="27" width="5.5" height="11" rx="2.75" fill="#0b1733" />
        <rect x="48.5" y="28.5" width="3.5" height="8" rx="1.75" fill="#3978f6" />

        {/* Visor Screen */}
        <rect x="21" y="24" width="22" height="12" rx="5" fill="url(#sg-visor-gradient)" />

        {/* Cheerful Friendly Glowing Eyes */}
        <circle cx="26.5" cy="29.5" r="2.8" fill="url(#sg-eye-glow)" />
        <circle cx="27.3" cy="28.7" r="1" fill="#ffffff" />

        <circle cx="37.5" cy="29.5" r="2.8" fill="url(#sg-eye-glow)" />
        <circle cx="38.3" cy="28.7" r="1" fill="#ffffff" />

        {/* Smiling Mouth */}
        <path
          d="M27.5 40C29 42.2 35 42.2 36.5 40"
          stroke="#2563eb"
          strokeWidth="2"
          strokeLinecap="round"
        />

        {/* Cheeks blush */}
        <circle cx="21" cy="39" r="1.8" fill="#f472b6" opacity="0.6" />
        <circle cx="43" cy="39" r="1.8" fill="#f472b6" opacity="0.6" />

        {/* Support Headset Boom Mic */}
        <path
          d="M49 35C49 43 43 47 37 47H34"
          stroke="#0b1733"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <rect x="30.5" y="45" width="5" height="4" rx="2" fill="#22c55e" />
      </svg>

      {/* Online indicator dot */}
      {isOnline && (
        <span
          className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center"
          title="Customer Support Guide Online"
        >
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500 dark:border-slate-900" />
        </span>
      )}
    </div>
  );
}
