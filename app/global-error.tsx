"use client";

import { useEffect } from "react";
import { logger } from "@/lib/logger";

/**
 * Last-resort error page for failures in the root layout itself (#214).
 * It replaces the root layout, so it can't rely on globals.css or fonts:
 * everything here is styled inline.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    logger.error("[app:global-error]", error.digest ?? "", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#f8fafc",
          color: "#0f172a",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
        }}
      >
        <title>Something went wrong | Ziki - AI Agent Marketplace</title>
        <main style={{ maxWidth: 448, margin: "0 auto", padding: "96px 16px" }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: "0 0 12px" }}>
            Ziki couldn&apos;t load
          </h1>
          <p style={{ fontSize: 14, lineHeight: "24px", color: "#475569", margin: "0 0 20px" }}>
            Something went wrong on our side. Trying again usually works.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => retry()}
              style={{
                background: "#0f766e",
                color: "#fff",
                border: 0,
                borderRadius: 8,
                padding: "8px 14px",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            {/* A plain link: the app's router may be what failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/home"
              style={{
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                padding: "8px 14px",
                fontSize: 14,
                fontWeight: 500,
                color: "#1e293b",
                textDecoration: "none",
                background: "#fff",
              }}
            >
              Go to issues
            </a>
          </div>
          {error.digest ? (
            <p style={{ fontSize: 12, color: "#64748b", marginTop: 20 }}>
              Reference: <code>{error.digest}</code>
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
