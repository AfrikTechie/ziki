import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  SKILL_CATEGORY_LABELS,
  createSubmissionSchema,
  slugify,
} from "@/lib/validations/skill";

export async function POST(req: NextRequest) {
  const user = await requireUser();

  // Rate limit: at most 5 submissions per 60 seconds per user
  const rateCheck = checkRateLimit(`skill-submission:${user.id}`, {
    max: 5,
    windowMs: 60 * 1000,
  });

  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "You're submitting skills too quickly. Please wait a moment." },
      {
        status: 429,
        headers: {
          "Retry-After": Math.ceil(rateCheck.retryAfterMs / 1000).toString(),
        },
      }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  // Derive human-readable category label server-side (preventing arbitrary client text)
  const categoryLabel = SKILL_CATEGORY_LABELS[parsed.data.category];

  // If revising an existing rejected submission, update it back to pending rather than creating an orphan
  if (parsed.data.revisionOfId) {
    const existingSubmission = await prisma.skillSubmission.findFirst({
      where: { id: parsed.data.revisionOfId, submittedById: user.id },
    });
    if (existingSubmission && existingSubmission.status === "rejected") {
      const updated = await prisma.skillSubmission.update({
        where: { id: existingSubmission.id },
        data: {
          title: parsed.data.title,
          category: parsed.data.category,
          categoryLabel,
          summary: parsed.data.summary,
          tags: parsed.data.tags,
          prompt: parsed.data.prompt,
          checklist: parsed.data.checklist ?? [],
          sampleCommand: parsed.data.sampleCommand || null,
          documentationUrl: parsed.data.documentationUrl || null,
          status: "pending",
          rejectionReason: null,
          reviewedById: null,
          reviewedAt: null,
        },
        select: {
          id: true,
          slug: true,
          title: true,
          category: true,
          categoryLabel: true,
          summary: true,
          tags: true,
          prompt: true,
          checklist: true,
          sampleCommand: true,
          documentationUrl: true,
          status: true,
          submittedById: true,
          createdAt: true,
        },
      });
      return NextResponse.json({ submission: updated }, { status: 200 });
    }
  }

  // Derive unique slug from title
  let baseSlug = slugify(parsed.data.title);
  if (!baseSlug) baseSlug = `skill-${Date.now().toString(36)}`;
  let uniqueSlug = baseSlug;

  const existing = await prisma.skillSubmission.findUnique({
    where: { slug: uniqueSlug },
    select: { id: true },
  });

  if (existing) {
    uniqueSlug = `${baseSlug}-${Math.random().toString(36).substring(2, 6)}`;
  }

  const submission = await prisma.skillSubmission.create({
    data: {
      slug: uniqueSlug,
      title: parsed.data.title,
      category: parsed.data.category,
      categoryLabel,
      summary: parsed.data.summary,
      tags: parsed.data.tags,
      prompt: parsed.data.prompt,
      checklist: parsed.data.checklist ?? [],
      sampleCommand: parsed.data.sampleCommand || null,
      documentationUrl: parsed.data.documentationUrl || null,
      status: "pending",
      submittedById: user.id,
    },
    select: {
      id: true,
      slug: true,
      title: true,
      category: true,
      categoryLabel: true,
      summary: true,
      tags: true,
      prompt: true,
      checklist: true,
      sampleCommand: true,
      documentationUrl: true,
      status: true,
      submittedById: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ submission }, { status: 201 });
}

