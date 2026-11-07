import Link from "next/link";
import { LoginHistory } from "@/components/login-history";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import {
  formatLoginHistoryDate,
  loginStatusLabel,
  normalizeLoginStatus,
  type LoginHistoryView,
} from "@/lib/user-sessions";

export const metadata = { title: "Login history" };

const PAGE_SIZE = 25;

function parsePage(raw: string | string[] | undefined): number {
  const str = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number.parseInt(str ?? "1", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

export default async function LoginHistoryPage(props: {
  searchParams?: Promise<{ page?: string | string[] | undefined }>;
}) {
  const user = await requireUser();
  const params = props.searchParams ? await props.searchParams : {};
  const requestedPage = parsePage(params.page);

  const totalCount = await prisma.loginHistory.count({ where: { userId: user.id } });
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const skip = (page - 1) * PAGE_SIZE;

  const rows = await prisma.loginHistory.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    skip,
    take: PAGE_SIZE,
  });

  const items: LoginHistoryView[] = rows.map((row) => {
    const status = normalizeLoginStatus(row.status);
    return {
      id: row.id,
      dateTime: formatLoginHistoryDate(row.createdAt),
      status,
      statusLabel: loginStatusLabel(status),
      device: row.device,
      ipAddress: row.ipAddress,
      location: row.location,
    };
  });

  const from = totalCount === 0 ? 0 : skip + 1;
  const to = skip + items.length;
  const rangeLabel =
    totalCount === 0 ? "Showing 0 of 0" : `Showing ${from}–${to} of ${totalCount}`;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 pb-10">
      <div className="flex flex-col gap-2.5">
        <Link
          href="/settings?section=account"
          className="inline-flex min-h-8 items-center gap-1.5 self-start text-sm font-semibold text-zk-accent hover:underline"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to settings
        </Link>
        <h1 className="m-0 text-[28px] font-extrabold tracking-[-0.02em] text-zk-text">
          Login history
        </h1>
        <p className="m-0 text-sm text-zk-muted">
          Complete history of successful and failed sign-in attempts on your account.
        </p>
      </div>

      <LoginHistory
        items={items}
        totalCount={totalCount}
        compact={false}
        rangeLabel={rangeLabel}
      />

      {totalPages > 1 ? (
        <nav
          aria-label="Login history pages"
          className="flex items-center justify-between gap-3"
        >
          {page > 1 ? (
            <Link
              href={`/settings/login-history?page=${page - 1}`}
              className="inline-flex h-[38px] items-center rounded-full border border-zk-border bg-zk-surface px-4 text-[13px] font-bold text-zk-text transition hover:bg-zk-chip"
            >
              &larr; Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs font-medium text-zk-muted">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={`/settings/login-history?page=${page + 1}`}
              className="inline-flex h-[38px] items-center rounded-full border border-zk-border bg-zk-surface px-4 text-[13px] font-bold text-zk-text transition hover:bg-zk-chip"
            >
              Next &rarr;
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}

