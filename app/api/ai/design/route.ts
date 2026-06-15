import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { generateDesignUpdate, type AiDesignRequest } from "@/lib/ai-design";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 35;

const MAX_BODY_BYTES = 256 * 1024;
const NO_STORE_HEADERS = {
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
};
const RATE_LIMITS = [
  { windowMs: 60_000, max: 6 },
  { windowMs: 60 * 60_000, max: 60 },
] as const;

const globalForRateLimit = globalThis as typeof globalThis & {
  aiDesignRateLimit?: Map<string, number[]>;
};
const aiDesignRateLimit =
  globalForRateLimit.aiDesignRateLimit ?? new Map<string, number[]>();
globalForRateLimit.aiDesignRateLimit = aiDesignRateLimit;

export async function POST(req: Request) {
  try {
    if (!isSameOriginRequest(req)) {
      return jsonError("Invalid request origin.", 403, "forbidden");
    }

    const session = await auth();
    const userKey = signedInUserKey(session);
    if (!userKey) {
      return jsonError("Sign in to use BYOK AI.", 401, "unauthorized");
    }

    const rateLimit = checkRateLimit(userKey);
    if (!rateLimit.allowed) {
      return jsonError(
        `Too many AI requests. Try again in ${rateLimit.retryAfterSeconds}s.`,
        429,
        "rate_limited",
        { "retry-after": String(rateLimit.retryAfterSeconds) },
      );
    }

    const text = await req.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return jsonError("Request is too large.", 413);
    }
    const body = JSON.parse(text) as AiDesignRequest;
    const result = await generateDesignUpdate(body);
    return NextResponse.json(
      { ok: true, ...result },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    return jsonError(
      err instanceof Error ? err.message : "AI design update failed.",
      400,
    );
  }
}

function signedInUserKey(
  session: { user?: { id?: string; email?: string | null } } | null,
): string {
  const user = session?.user;
  return user?.id ?? user?.email ?? "";
}

function checkRateLimit(userKey: string):
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number } {
  const now = Date.now();
  const largestWindowMs = Math.max(...RATE_LIMITS.map((limit) => limit.windowMs));
  const recent = (aiDesignRateLimit.get(userKey) ?? []).filter(
    (time) => now - time < largestWindowMs,
  );

  for (const limit of RATE_LIMITS) {
    const windowed = recent.filter((time) => now - time < limit.windowMs);
    if (windowed.length >= limit.max) {
      const oldest = Math.min(...windowed);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((limit.windowMs - (now - oldest)) / 1000)),
      };
    }
  }

  recent.push(now);
  aiDesignRateLimit.set(userKey, recent);
  return { allowed: true };
}

function isSameOriginRequest(req: Request): boolean {
  const source = req.headers.get("origin") ?? req.headers.get("referer");
  if (!source) return true;

  try {
    const sourceUrl = new URL(source);
    const targetUrl = new URL(requestOrigin(req));
    return sourceUrl.origin === targetUrl.origin;
  } catch {
    return false;
  }
}

function requestOrigin(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return "http://localhost";
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");
  return `${proto}://${host}`;
}

function jsonError(
  message: string,
  status: number,
  error = "ai_design_failed",
  extraHeaders?: HeadersInit,
) {
  return NextResponse.json(
    {
      ok: false,
      error,
      message,
    },
    { status, headers: { ...NO_STORE_HEADERS, ...extraHeaders } },
  );
}
