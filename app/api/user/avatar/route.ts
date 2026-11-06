import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { validateAvatarBytes } from "@/lib/avatar-upload";

/**
 * GET /api/user/avatar — returns the signed-in user's avatar image URL.
 */
export async function GET() {
  const user = await requireUser();
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { image: true },
  });
  return NextResponse.json({ image: dbUser?.image ?? null });
}

/**
 * POST /api/user/avatar — upload a profile avatar (PNG, JPEG, WebP, GIF, up to 2MB).
 */
export async function POST(req: NextRequest) {
  const user = await requireUser();
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form payload." }, { status: 400 });
  }

  const file = (formData.get("avatar") ?? formData.get("file")) as File | null;
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Please select an image file to upload." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validated = validateAvatarBytes(bytes);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  await prisma.attachment.deleteMany({
    where: { uploaderId: user.id, filename: { startsWith: "avatar" } },
  }).catch(() => undefined);

  const ext = validated.contentType.split("/")[1] || "png";
  await prisma.attachment.create({
    data: {
      uploaderId: user.id,
      filename: `avatar-${user.id}.${ext}`,
      contentType: validated.contentType,
      size: bytes.byteLength,
      data: Buffer.from(bytes),
    },
  });

  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://ziki.dev")
    .replace(/^http:\/\//i, "https://")
    .replace(/\/$/, "");
  const avatarUrl = `${base}/api/users/${user.id}/avatar?v=${Date.now()}`;

  await prisma.user.update({
    where: { id: user.id },
    data: { image: avatarUrl },
  });

  revalidatePath("/", "layout");
  revalidatePath("/settings");
  revalidatePath(`/users/${user.id}`);

  return NextResponse.json({ ok: true, image: avatarUrl });
}

/**
 * DELETE /api/user/avatar — remove current profile avatar and restore default initials.
 */
export async function DELETE() {
  const user = await requireUser();
  await prisma.attachment.deleteMany({
    where: { uploaderId: user.id, filename: { startsWith: "avatar" } },
  }).catch(() => undefined);

  await prisma.user.update({
    where: { id: user.id },
    data: { image: null },
  });

  revalidatePath("/", "layout");
  revalidatePath("/settings");
  revalidatePath(`/users/${user.id}`);

  return NextResponse.json({ ok: true, image: null });
}
