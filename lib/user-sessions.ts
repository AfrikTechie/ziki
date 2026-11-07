import { createHmac } from "node:crypto";
import { resolveAuthSecret } from "@/lib/auth-secret";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { clientIpFrom } from "@/lib/rate-limit";

export type SessionDeviceType = "laptop" | "mobile" | "desktop";

export type LoginHistoryStatus =
  | "successful"
  | "failed_password"
  | "failed_two_factor"
  | "failed_2fa_required";

export type ActiveSessionView = {
  id: string;
  device: string;
  deviceType: SessionDeviceType;
  ipAddress: string;
  location: string;
  isCurrent: boolean;
  lastActiveText: string;
};

export type LoginHistoryView = {
  id: string;
  dateTime: string;
  status: LoginHistoryStatus;
  statusLabel: string;
  device: string;
  ipAddress: string;
  location: string;
};

export type ParsedClientMeta = {
  maskedIp: string;
  sessionDevice: string;
  historyDevice: string;
  deviceType: SessionDeviceType;
  sessionLocation: string;
  historyLocation: string;
};

const TOUCH_INTERVAL_MS = 5 * 60_000;

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const regionNames =
  typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

function unquote(value: string | null | undefined): string {
  if (!value) return "";
  return value.trim().replace(/^"+|"+$/g, "").trim();
}

function safeDecode(value: string | null | undefined): string {
  const trimmed = unquote(value);
  if (!trimmed) return "";
  try {
    return decodeURIComponent(trimmed.replace(/\+/g, " ")).trim();
  } catch {
    return trimmed;
  }
}

function unwrapIp(rawIp: string | null | undefined): string | null {
  if (!rawIp) return null;
  const trimmed = rawIp.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^::ffff:/i, "");
}

export function isLocalOrPrivateIp(rawIp: string | null | undefined): boolean {
  const ip = unwrapIp(rawIp);
  if (!ip) return false;
  if (ip === "::1" || ip === "localhost" || ip.startsWith("127.")) return true;
  if (ip.startsWith("10.") || ip.startsWith("192.168.")) return true;
  const match172 = /^172\.(\d{1,3})\./.exec(ip);
  if (match172) {
    const second = Number(match172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  const lower = ip.toLowerCase();
  return lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:");
}

/**
 * Masks the lower half of an IP address ("102.89.43.12" -> "102.89.xx.xx") so
 * account owners can recognise their network without storing full raw IPs.
 */
export function maskIpAddress(rawIp: string | null | undefined): string {
  const ip = unwrapIp(rawIp);
  if (!ip) return "Unknown IP";
  if (ip === "::1" || ip === "127.0.0.1") return "127.0.xx.xx";

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    return `${v4[1]}.${v4[2]}.xx.xx`;
  }

  if (ip.includes(":")) {
    const parts = ip.split(":").filter((part) => part.length > 0);
    const first = parts[0] ?? "0";
    const second = parts[1] ?? "0";
    return `${first}:${second}::xxxx`;
  }

  return "Unknown IP";
}

function detectBrowser(ua: string, chUa: string): string {
  if (/Brave/i.test(chUa)) return "Brave";
  if (/Microsoft Edge/i.test(chUa) || /Edg(?:e|A|iOS)?\//i.test(ua)) return "Edge";
  if (/Opera/i.test(chUa) || /OPR\/|Opera/i.test(ua)) return "Opera";
  if (/Vivaldi/i.test(chUa) || /Vivaldi\//i.test(ua)) return "Vivaldi";
  if (/SamsungBrowser\//i.test(ua)) return "Samsung Internet";
  if (/Firefox\/|FxiOS\//i.test(ua)) return "Firefox";
  if (/Google Chrome/i.test(chUa) || /Chrome\/|CriOS\//i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua) && /Version\//i.test(ua)) return "Safari";
  return "Unknown";
}

function cleanAndroidModel(raw: string): string {
  const cleaned = raw.replace(/\s*Build\/.*$/i, "").trim();
  if (!cleaned || cleaned === "K" || cleaned.toLowerCase() === "wv") return "";
  return cleaned.slice(0, 40);
}

function detectOsAndDevice(
  ua: string,
  chPlatform: string,
  chPlatformVersion: string,
  chModel: string,
  chMobile: boolean,
): { osSession: string; osHistory: string; model: string; deviceType: SessionDeviceType } {
  if (/Android/i.test(ua) || /^Android$/i.test(chPlatform)) {
    const uaModelMatch = /Android(?:\s+[\d.]+)?;\s*([^;)]+)/i.exec(ua);
    const model = cleanAndroidModel(chModel) || cleanAndroidModel(uaModelMatch?.[1] ?? "");
    return { osSession: "Android", osHistory: "Android", model, deviceType: "mobile" };
  }

  if (/iPad/i.test(ua)) {
    return { osSession: "iPadOS", osHistory: "iPadOS", model: "", deviceType: "mobile" };
  }

  if (/iPhone|iPod/i.test(ua) || /^iOS$/i.test(chPlatform)) {
    return { osSession: "iOS", osHistory: "iOS", model: "", deviceType: "mobile" };
  }

  if (/Windows NT/i.test(ua) || /^Windows$/i.test(chPlatform)) {
    let winLabel = "Windows";
    const majorHint = Number.parseInt(chPlatformVersion.split(".")[0] ?? "", 10);
    if (Number.isFinite(majorHint) && majorHint > 0) {
      winLabel = majorHint >= 13 ? "Windows 11" : "Windows 10";
    } else if (/Windows NT 6\.3/i.test(ua)) {
      winLabel = "Windows 8.1";
    } else if (/Windows NT 6\.1/i.test(ua)) {
      winLabel = "Windows 7";
    }
    return { osSession: winLabel, osHistory: winLabel, model: "", deviceType: "laptop" };
  }

  if (/CrOS/i.test(ua) || /^Chrome OS$/i.test(chPlatform)) {
    return { osSession: "ChromeOS", osHistory: "ChromeOS", model: "", deviceType: "laptop" };
  }

  if (/Macintosh|Mac OS X/i.test(ua) || /^macOS$/i.test(chPlatform)) {
    return { osSession: "macOS", osHistory: "macOS", model: "", deviceType: "laptop" };
  }

  const ubuntuMatch = /Ubuntu(?:\/([\d.]+))?/i.exec(ua);
  if (ubuntuMatch) {
    const ver = ubuntuMatch[1]?.split(".").slice(0, 2).join(".");
    return {
      osSession: ver ? `Ubuntu ${ver}` : "Ubuntu",
      osHistory: "Ubuntu",
      model: "",
      deviceType: "desktop",
    };
  }

  if (/Linux/i.test(ua) || /^Linux$/i.test(chPlatform)) {
    return {
      osSession: "Linux",
      osHistory: "Linux",
      model: "",
      deviceType: chMobile ? "mobile" : "desktop",
    };
  }

  return {
    osSession: "Unknown OS",
    osHistory: "Unknown",
    model: "",
    deviceType: chMobile ? "mobile" : "desktop",
  };
}

function resolveCountryName(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return "";
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

function parseGeoLocation(
  hdrs: Headers | null | undefined,
  rawIp: string | null,
): { sessionLocation: string; historyLocation: string } {
  if (hdrs) {
    const rawCountry = (
      hdrs.get("cf-ipcountry") ||
      hdrs.get("x-vercel-ip-country") ||
      hdrs.get("x-country-code") ||
      hdrs.get("cloudfront-viewer-country") ||
      hdrs.get("fly-client-ip-country") ||
      ""
    )
      .trim()
      .toUpperCase();

    const countryCode =
      rawCountry && rawCountry !== "XX" && rawCountry !== "T1" ? rawCountry : "";
    const city = safeDecode(
      hdrs.get("cf-ipcity") ||
        hdrs.get("x-vercel-ip-city") ||
        hdrs.get("x-geo-city") ||
        hdrs.get("cloudfront-viewer-city"),
    );
    const region = safeDecode(
      hdrs.get("cf-region") ||
        hdrs.get("x-vercel-ip-country-region-name") ||
        hdrs.get("cloudfront-viewer-country-region-name"),
    );

    if (countryCode || city) {
      const countryName = countryCode ? resolveCountryName(countryCode) : "";
      const cleanRegion =
        region && region.toLowerCase() !== city.toLowerCase() && !/^\d+$/.test(region)
          ? region
          : "";
      const fullParts = [city, cleanRegion, countryName].filter(Boolean);
      const sessionLocation = fullParts.join(", ") || countryCode || "Unknown location";
      const historyLocation =
        city && countryCode
          ? `${city}, ${countryCode}`
          : city || countryName || countryCode || "Unknown";
      return { sessionLocation, historyLocation };
    }
  }

  if (isLocalOrPrivateIp(rawIp)) {
    return { sessionLocation: "Local network", historyLocation: "Local" };
  }
  return { sessionLocation: "Unknown location", historyLocation: "Unknown" };
}

function resolveRequestIp(hdrs: Headers | null | undefined): string | null {
  if (!hdrs || typeof hdrs.get !== "function") return null;
  // Pass a plain `{ get }` adapter so Next.js's ReadonlyHeaders proxy (`"headers" in h === true`)
  // isn't mistaken by `clientIpFrom` for a Request object.
  const ip = clientIpFrom({ get: (name: string) => hdrs.get(name) });
  if (ip) return ip;

  const host = (hdrs.get("x-forwarded-host") || hdrs.get("host") || "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
    return "127.0.0.1";
  }
  return null;
}

/**
 * Extracts masked IP, browser/OS labels, device icon kind, and approximate
 * location from incoming HTTP headers without calling third-party geo APIs.
 */
export function parseRequestClient(hdrs: Headers | null | undefined): ParsedClientMeta {
  const rawIp = resolveRequestIp(hdrs);
  const maskedIp = maskIpAddress(rawIp);

  const ua = hdrs?.get("user-agent") ?? "";
  const chUa = hdrs?.get("sec-ch-ua") ?? "";
  const chPlatform = unquote(hdrs?.get("sec-ch-ua-platform"));
  const chPlatformVersion = unquote(hdrs?.get("sec-ch-ua-platform-version"));
  const chModel = unquote(hdrs?.get("sec-ch-ua-model"));
  const chMobile = unquote(hdrs?.get("sec-ch-ua-mobile")) === "?1" || /Mobile/i.test(ua);

  const browser = detectBrowser(ua, chUa);
  const { osSession, osHistory, model, deviceType } = detectOsAndDevice(
    ua,
    chPlatform,
    chPlatformVersion,
    chModel,
    chMobile,
  );

  const modelSuffix = model ? ` (${model})` : "";
  let sessionDevice: string;
  if (browser === "Unknown" && osSession === "Unknown OS") {
    sessionDevice = "Web browser";
  } else if (browser === "Unknown") {
    sessionDevice = `Unknown browser on ${osSession}`;
  } else if (osSession === "Unknown OS") {
    sessionDevice = browser;
  } else {
    sessionDevice = `${browser} on ${osSession}${modelSuffix}`;
  }

  const historyDevice =
    browser === "Unknown" && osHistory === "Unknown"
      ? "Unknown · Web"
      : `${browser} · ${osHistory}`;

  const { sessionLocation, historyLocation } = parseGeoLocation(hdrs, rawIp);

  return {
    maskedIp,
    sessionDevice,
    historyDevice,
    deviceType,
    sessionLocation,
    historyLocation,
  };
}

/**
 * Stable HMAC key for a pre-deploy JWT that does not carry `sid` yet.
 */
export function legacySessionKey(userId: string, hdrs: Headers | null | undefined): string {
  const ua = (hdrs && typeof hdrs.get === "function" ? (hdrs.get("user-agent") ?? "") : "").slice(0, 300);
  const maskedIp = maskIpAddress(resolveRequestIp(hdrs));
  return createHmac("sha256", resolveAuthSecret())
    .update(`legacy-session:${userId}:${ua}:${maskedIp}`)
    .digest("hex");
}

export function formatRelativeSessionTime(
  lastActiveAt: Date,
  isCurrent: boolean,
  nowMs = Date.now(),
): string {
  if (isCurrent) return "Active now";
  const diffMs = Math.max(0, nowMs - lastActiveAt.getTime());
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "Active now";
  if (mins === 1) return "Last active 1 minute ago";
  if (mins < 60) return `Last active ${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return "Last active 1 hour ago";
  if (hours < 24) return `Last active ${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Last active 1 day ago";
  return `Last active ${days} days ago`;
}

/**
 * Formats a login history timestamp as "Nov 4, 2026 · 09:37" (UTC-consistent on
 * server render so SSR and client match cleanly).
 */
export function formatLoginHistoryDate(date: Date): string {
  const month = MONTHS_SHORT[date.getUTCMonth()];
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${month} ${day}, ${year} · ${hours}:${minutes}`;
}

export function normalizeLoginStatus(raw: string): LoginHistoryStatus {
  if (
    raw === "successful" ||
    raw === "failed_password" ||
    raw === "failed_two_factor" ||
    raw === "failed_2fa_required"
  ) {
    return raw;
  }
  return "failed_password";
}

export function loginStatusLabel(status: LoginHistoryStatus): string {
  switch (status) {
    case "successful":
      return "Successful";
    case "failed_two_factor":
      return "Failed · wrong code";
    case "failed_2fa_required":
      return "Failed · 2FA required";
    case "failed_password":
    default:
      return "Failed · wrong password";
  }
}

function escapeCsvCell(value: string): string {
  // Neutralise spreadsheet formula injection (=, +, -, @, tab, CR).
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildLoginHistoryCsv(
  rows: Array<{
    createdAt: Date;
    status: string;
    device: string;
    ipAddress: string;
    location: string;
  }>,
): string {
  const header = ["Date & Time", "Status", "Device", "IP Address", "Location", "Timestamp (UTC)"];
  const lines = rows.map((row) => {
    const status = normalizeLoginStatus(row.status);
    return [
      escapeCsvCell(formatLoginHistoryDate(row.createdAt)),
      escapeCsvCell(loginStatusLabel(status)),
      escapeCsvCell(row.device),
      escapeCsvCell(row.ipAddress),
      escapeCsvCell(row.location),
      escapeCsvCell(row.createdAt.toISOString()),
    ].join(",");
  });
  return [header.join(","), ...lines].join("\r\n");
}

type OptionalSessionDelegates = {
  userSession?: typeof prisma.userSession;
  loginHistory?: typeof prisma.loginHistory;
  securityAuditEvent?: typeof prisma.securityAuditEvent;
};

/**
 * Records a successful sign-in: creates a tracked `UserSession` row and appends
 * a `"successful"` `LoginHistory` entry. Returns the new `sessionId` (or
 * undefined if persistence wasn't available).
 */
export async function recordSignInSuccess({
  userId,
  sessionVersion,
  headers,
}: {
  userId: string;
  sessionVersion: number;
  headers: Headers | null | undefined;
}): Promise<string | undefined> {
  const delegates = prisma as unknown as OptionalSessionDelegates;
  const meta = parseRequestClient(headers);
  let sessionId: string | undefined;

  if (delegates.userSession?.create) {
    try {
      const created = await delegates.userSession.create({
        data: {
          userId,
          sessionVersion,
          device: meta.sessionDevice,
          deviceType: meta.deviceType,
          ipAddress: meta.maskedIp,
          location: meta.sessionLocation,
        },
        select: { id: true },
      });
      sessionId = created.id;
    } catch (error) {
      logger.error("[sessions] could not create UserSession on sign-in", error);
    }
  }

  if (delegates.loginHistory?.create) {
    try {
      await delegates.loginHistory.create({
        data: {
          userId,
          status: "successful",
          device: meta.historyDevice,
          ipAddress: meta.maskedIp,
          location: meta.historyLocation,
        },
      });
    } catch (error) {
      logger.error("[sessions] could not record successful LoginHistory", error);
    }
  }

  return sessionId;
}

/**
 * Records a failed sign-in attempt on an existing account without throwing.
 */
export async function recordSignInFailure({
  userId,
  status,
  headers,
}: {
  userId: string;
  status: Exclude<LoginHistoryStatus, "successful">;
  headers: Headers | null | undefined;
}): Promise<void> {
  const delegates = prisma as unknown as OptionalSessionDelegates;
  if (!delegates.loginHistory?.create) return;
  const meta = parseRequestClient(headers);
  try {
    await delegates.loginHistory.create({
      data: {
        userId,
        status,
        device: meta.historyDevice,
        ipAddress: meta.maskedIp,
        location: meta.historyLocation,
      },
    });
  } catch (error) {
    logger.error("[sessions] could not record failed LoginHistory", error);
  }
}

/**
 * Validates that a tracked session (`sessionId`) has not been revoked and
 * belongs to `userId` at `userSessionVersion`. Fails closed on lookup error.
 */
export async function isTrackedSessionValid({
  sessionId,
  userId,
  userSessionVersion,
  now = new Date(),
}: {
  sessionId: string;
  userId: string;
  userSessionVersion: number;
  now?: Date;
}): Promise<boolean> {
  const delegates = prisma as unknown as OptionalSessionDelegates;
  if (!delegates.userSession?.findUnique) return true;

  try {
    const row = await delegates.userSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        userId: true,
        sessionVersion: true,
        revokedAt: true,
        lastActiveAt: true,
      },
    });
    if (!row) return false;
    if (row.userId !== userId) return false;
    if (row.revokedAt !== null) return false;
    if (row.sessionVersion !== userSessionVersion) return false;

    if (
      delegates.userSession.update &&
      now.getTime() - row.lastActiveAt.getTime() >= TOUCH_INTERVAL_MS
    ) {
      void delegates.userSession
        .update({
          where: { id: row.id },
          data: { lastActiveAt: now },
        })
        .catch(() => undefined);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * For a pre-deploy JWT without `sessionId`, checks whether a legacy session row
 * for this client fingerprint was explicitly revoked at the current version.
 */
export async function isLegacySessionRevoked({
  userId,
  userSessionVersion,
  headers,
}: {
  userId: string;
  userSessionVersion: number;
  headers: Headers | null | undefined;
}): Promise<boolean> {
  const delegates = prisma as unknown as OptionalSessionDelegates;
  if (!delegates.userSession?.findUnique) return false;

  try {
    const key = legacySessionKey(userId, headers);
    const row = await delegates.userSession.findUnique({
      where: { legacyKey: key },
      select: { userId: true, sessionVersion: true, revokedAt: true },
    });
    if (!row || row.userId !== userId) return false;
    return row.sessionVersion === userSessionVersion && row.revokedAt !== null;
  } catch {
    return false;
  }
}

/**
 * Marks a session row revoked on explicit logout so it leaves Active sessions
 * right away.
 */
export async function revokeSessionOnLogout({
  userId,
  sessionId,
  headers,
}: {
  userId?: string | null;
  sessionId?: string | null;
  headers?: Headers | null;
}): Promise<void> {
  const delegates = prisma as unknown as OptionalSessionDelegates;
  if (!delegates.userSession?.updateMany) return;

  const now = new Date();
  try {
    if (sessionId) {
      await delegates.userSession.updateMany({
        where: userId
          ? { id: sessionId, userId, revokedAt: null }
          : { id: sessionId, revokedAt: null },
        data: { revokedAt: now },
      });
      return;
    }
    if (userId && headers) {
      const key = legacySessionKey(userId, headers);
      await delegates.userSession.updateMany({
        where: { legacyKey: key, userId, revokedAt: null },
        data: { revokedAt: now },
      });
    }
  } catch (error) {
    logger.error("[sessions] could not revoke session on logout", error);
  }
}

/**
 * Ensures the signed-in caller's current device has an up-to-date `UserSession`
 * row (creating one for pre-deploy tokens without `sessionId`, and backfilling
 * an initial `LoginHistory` entry if the account had none yet), then returns
 * the active session list and current session ID.
 */
export async function loadAccountSecurityActivity({
  userId,
  sessionId,
  sessionVersion,
  headers,
  historyLimit = 5,
}: {
  userId: string;
  sessionId?: string;
  sessionVersion: number;
  headers: Headers | null | undefined;
  historyLimit?: number;
}): Promise<{
  currentSessionId: string | null;
  sessions: ActiveSessionView[];
  history: LoginHistoryView[];
  historyTotal: number;
}> {
  const meta = parseRequestClient(headers);
  const now = new Date();
  let currentSessionId: string | null = sessionId ?? null;

  try {
    if (currentSessionId) {
      const existing = await prisma.userSession.findUnique({
        where: { id: currentSessionId },
        select: { id: true, userId: true, device: true, revokedAt: true },
      });
      if (existing && existing.userId === userId && existing.revokedAt === null) {
        await prisma.userSession.update({
          where: { id: existing.id },
          data: {
            lastActiveAt: now,
            // Upgrade label if Client Hints added OS version / model after sign-in.
            ...(meta.sessionDevice !== "Web browser" ? { device: meta.sessionDevice, deviceType: meta.deviceType } : {}),
          },
        });
      } else {
        currentSessionId = null;
      }
    }

    if (!currentSessionId) {
      const key = legacySessionKey(userId, headers);
      const upserted = await prisma.userSession.upsert({
        where: { legacyKey: key },
        create: {
          userId,
          legacyKey: key,
          sessionVersion,
          device: meta.sessionDevice,
          deviceType: meta.deviceType,
          ipAddress: meta.maskedIp,
          location: meta.sessionLocation,
          lastActiveAt: now,
        },
        update: {
          sessionVersion,
          revokedAt: null,
          device: meta.sessionDevice,
          deviceType: meta.deviceType,
          ipAddress: meta.maskedIp,
          location: meta.sessionLocation,
          lastActiveAt: now,
        },
        select: { id: true, createdAt: true },
      });
      currentSessionId = upserted.id;
    }

    const existingHistoryCount = await prisma.loginHistory.count({ where: { userId } });
    if (existingHistoryCount === 0) {
      await prisma.loginHistory.create({
        data: {
          userId,
          status: "successful",
          device: meta.historyDevice,
          ipAddress: meta.maskedIp,
          location: meta.historyLocation,
        },
      });
    }

    const [sessionRows, historyTotal, historyRows] = await Promise.all([
      prisma.userSession.findMany({
        where: { userId, revokedAt: null, sessionVersion },
        orderBy: { lastActiveAt: "desc" },
      }),
      prisma.loginHistory.count({ where: { userId } }),
      prisma.loginHistory.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: historyLimit,
      }),
    ]);

    const sortedSessions = [...sessionRows].sort((a, b) => {
      if (a.id === currentSessionId) return -1;
      if (b.id === currentSessionId) return 1;
      return b.lastActiveAt.getTime() - a.lastActiveAt.getTime();
    });

    const sessions: ActiveSessionView[] = sortedSessions.map((row) => {
      const isCurrent = row.id === currentSessionId;
      const deviceType: SessionDeviceType =
        row.deviceType === "mobile"
          ? "mobile"
          : row.deviceType === "desktop"
            ? "desktop"
            : "laptop";
      return {
        id: row.id,
        device: row.device,
        deviceType,
        ipAddress: row.ipAddress,
        location: row.location,
        isCurrent,
        lastActiveText: formatRelativeSessionTime(row.lastActiveAt, isCurrent, now.getTime()),
      };
    });

    const history: LoginHistoryView[] = historyRows.map((row) => {
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

    return { currentSessionId, sessions, history, historyTotal };
  } catch (error) {
    logger.error("[sessions] could not load account security activity, using request fallback", error);
    return {
      currentSessionId: "current",
      sessions: [
        {
          id: "current",
          device: meta.sessionDevice,
          deviceType: meta.deviceType,
          ipAddress: meta.maskedIp,
          location: meta.sessionLocation,
          isCurrent: true,
          lastActiveText: "Active now",
        },
      ],
      history: [],
      historyTotal: 0,
    };
  }
}

/**
 * Resolves the caller's current `UserSession.id` for mutations (`signOutSession`,
 * `signOutOtherSessions`, two-factor version bumps).
 */
export async function resolveCurrentSessionId({
  userId,
  sessionId,
  headers,
}: {
  userId: string;
  sessionId?: string | null;
  headers: Headers | null | undefined;
}): Promise<string | null> {
  if (sessionId) return sessionId;
  const delegates = prisma as unknown as OptionalSessionDelegates;
  if (!delegates.userSession?.findUnique) return null;
  try {
    const key = legacySessionKey(userId, headers);
    const row = await delegates.userSession.findUnique({
      where: { legacyKey: key },
      select: { id: true, userId: true },
    });
    return row?.userId === userId ? row.id : null;
  } catch {
    return null;
  }
}

/**
 * Keeps only the caller's current `UserSession` row at `newSessionVersion` when
 * another flow (such as enabling/disabling 2FA) already bumped `User.sessionVersion`.
 */
export async function syncSessionsAfterVersionBump({
  userId,
  currentSessionId,
  newSessionVersion,
}: {
  userId: string;
  currentSessionId: string | null;
  newSessionVersion: number;
}): Promise<void> {
  const delegates = prisma as unknown as OptionalSessionDelegates;
  if (!delegates.userSession?.updateMany) return;
  const now = new Date();
  try {
    await delegates.userSession.updateMany({
      where: currentSessionId
        ? { userId, id: { not: currentSessionId }, revokedAt: null }
        : { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    if (currentSessionId) {
      await delegates.userSession.updateMany({
        where: { id: currentSessionId, userId },
        data: { sessionVersion: newSessionVersion, lastActiveAt: now, revokedAt: null },
      });
    }
  } catch (error) {
    logger.error("[sessions] could not sync sessions after version bump", error);
  }
}

