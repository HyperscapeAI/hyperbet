const STORAGE_KEY = "arena:invite:code";
const APPLIED_PREFIX = "arena:invite:applied";
const WEBSITE_INVITE_ORIGIN = "https://hyperscape.bet";
const INVITE_QUERY_KEYS = ["invite", "ref", "inviteCode"] as const;
const INVITE_CODE_PATTERN = /^[A-Z0-9_-]{4,64}$/;

export function normalizeInviteCode(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const normalized = trimmed.toUpperCase();
  if (!INVITE_CODE_PATTERN.test(normalized)) return null;
  return normalized;
}

export function extractInviteCodeFromInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.includes("://")) {
    return normalizeInviteCode(trimmed);
  }

  try {
    const parsed = new URL(trimmed);
    for (const key of INVITE_QUERY_KEYS) {
      const candidate = normalizeInviteCode(parsed.searchParams.get(key));
      if (candidate) return candidate;
    }
  } catch {
    return null;
  }
  return null;
}

export function getStoredInviteCode(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return normalizeInviteCode(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function captureInviteCodeFromLocation(): string | null {
  if (typeof window === "undefined") return null;

  const current = new URL(window.location.href);
  let captured: string | null = null;
  for (const key of INVITE_QUERY_KEYS) {
    const candidate = normalizeInviteCode(current.searchParams.get(key));
    if (candidate) {
      captured = candidate;
      break;
    }
  }

  if (!captured) {
    return getStoredInviteCode();
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, captured);
  } catch {
    // Ignore localStorage failures (e.g. privacy mode); invite capture is best-effort only.
  }

  for (const key of INVITE_QUERY_KEYS) {
    current.searchParams.delete(key);
  }
  const nextPath = `${current.pathname}${current.search}${current.hash}`;
  window.history.replaceState({}, "", nextPath || "/");

  return captured;
}

export function buildInviteShareLink(inviteCodeRaw: string): string {
  const inviteCode = normalizeInviteCode(inviteCodeRaw);
  if (!inviteCode) return "";

  if (typeof window === "undefined") {
    return `${WEBSITE_INVITE_ORIGIN}/?invite=${encodeURIComponent(inviteCode)}`;
  }

  const rawOrigin = window.location.origin;
  const origin =
    rawOrigin && rawOrigin !== "null" ? rawOrigin : WEBSITE_INVITE_ORIGIN;
  const url = new URL(window.location.pathname || "/", `${origin}/`);
  url.searchParams.set("invite", inviteCode);
  return url.toString();
}

export function wasInviteAppliedForWallet(
  walletRaw: string,
  inviteCodeRaw: string,
): boolean {
  if (typeof window === "undefined") return false;
  const wallet = walletRaw.trim();
  const inviteCode = normalizeInviteCode(inviteCodeRaw);
  if (!wallet || !inviteCode) return false;
  try {
    return (
      window.localStorage.getItem(
        `${APPLIED_PREFIX}:${wallet}:${inviteCode}`,
      ) === "1"
    );
  } catch {
    return false;
  }
}

export function markInviteAppliedForWallet(
  walletRaw: string,
  inviteCodeRaw: string,
): void {
  if (typeof window === "undefined") return;
  const wallet = walletRaw.trim();
  const inviteCode = normalizeInviteCode(inviteCodeRaw);
  if (!wallet || !inviteCode) return;
  try {
    window.localStorage.setItem(
      `${APPLIED_PREFIX}:${wallet}:${inviteCode}`,
      "1",
    );
  } catch {
    // Ignore localStorage failures (e.g. privacy mode); we can still proceed without persistence.
  }
}
