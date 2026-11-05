"use client";

import { useParams } from "next/navigation";
import { projectRef, type ProjectRef } from "@/lib/project-paths";

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The project the current address is in (`/<org>/<project>/…`, #project-urls), or null off a project page. */
export function useProjectRef(): ProjectRef | null {
  const params = useParams<{ org?: string; project?: string }>();
  return params?.org && params?.project ? projectRef(decode(params.org), decode(params.project)) : null;
}
