import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { buildLoginHistoryCsv } from "@/lib/user-sessions";

/**
 * Streams the signed-in account's login history as an RFC-4180 CSV file with
 * spreadsheet-formula neutralisation.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const rows = await prisma.loginHistory.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        status: true,
        device: true,
        ipAddress: true,
        location: true,
      },
    });

    const csv = buildLoginHistoryCsv(rows);
    const dateStamp = new Date().toISOString().slice(0, 10);

    // Prepend UTF-8 BOM so Excel on Windows decodes "·" as UTF-8 instead of CP1252 ("Â·").
    return new NextResponse(`\uFEFF${csv}`, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="login-history-${dateStamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    unstable_rethrow(error);
    console.error("[api/user/login-history] CSV export failed:", error);
    return new NextResponse(
      JSON.stringify({ error: "Failed to export login history" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

