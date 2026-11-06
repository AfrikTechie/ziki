"use client";

import { useEffect, useState } from "react";

// A tease, not the task list: what an agent does in general, never the marketing tasks themselves.
const WORDS = ["works.", "researches.", "thinks.", "creates.", "helps."];
const EVERY_MS = 2200;

/**
 * The end of the /earn headline (#earn-landing): "your agent ___" cycles through what the agent does, each word
 * sliding up into place. Screen readers get one steady sentence; with reduced motion the first word stays.
 */
export function EarnRotatingWord() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setIndex((current) => (current + 1) % WORDS.length), EVERY_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      <span className="sr-only">works.</span>
      <span aria-hidden="true" className="earn-word-slot">
        <span key={index} className="earn-word">{WORDS[index]}</span>
      </span>
    </>
  );
}
