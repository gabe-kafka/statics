import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  deleteSavedAiApiKey,
  getSavedAiApiKeyInfo,
  saveAiApiKey,
} from "@/lib/ai-api-key-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_API_KEY_LENGTH = 8_192;
const MAX_MODEL_LENGTH = 120;
const NO_STORE_HEADERS = {
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
};

export async function GET() {
  const userId = await signedInUserId();
  if (!userId) return jsonError("Sign in to manage AI API key.", 401);

  const info = await getSavedAiApiKeyInfo(userId);
  return NextResponse.json(
    {
      hasKey: info.hasKey,
      provider: info.provider,
      model: info.model,
      updatedAt: info.updatedAt?.toISOString(),
    },
    { headers: NO_STORE_HEADERS },
  );
}

export async function PUT(req: Request) {
  if (!isSameOriginRequest(req)) {
    return jsonError("Invalid request origin.", 403);
  }

  const userId = await signedInUserId();
  if (!userId) return jsonError("Sign in to manage AI API key.", 401);

  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return jsonError("Request is too large.", 413);
  }

  let body: { provider?: unknown; apiKey?: unknown; model?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return jsonError("Body must be valid JSON.", 400);
  }

  if (body.provider !== "openai") {
    return jsonError("Saved API keys currently support OpenAI only.", 400);
  }

  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey) return jsonError("Missing API key.", 400);
  if (apiKey.length > MAX_API_KEY_LENGTH) {
    return jsonError("API key is too long.", 400);
  }

  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (model.length > MAX_MODEL_LENGTH) {
    return jsonError("Model name is too long.", 400);
  }

  try {
    await saveAiApiKey({
      userId,
      provider: "openai",
      model: model || null,
      apiKey,
    });
  } catch (err) {
    return jsonError(
      err instanceof Error ? err.message : "Could not save AI API key.",
      500,
    );
  }

  return NextResponse.json(
    { hasKey: true, provider: "openai", model: model || null },
    { headers: NO_STORE_HEADERS },
  );
}

export async function DELETE(req: Request) {
  if (!isSameOriginRequest(req)) {
    return jsonError("Invalid request origin.", 403);
  }

  const userId = await signedInUserId();
  if (!userId) return jsonError("Sign in to manage AI API key.", 401);

  await deleteSavedAiApiKey(userId);
  return NextResponse.json({ hasKey: false }, { headers: NO_STORE_HEADERS });
}

async function signedInUserId(): Promise<string> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? "";
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

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { ok: false, message },
    { status, headers: NO_STORE_HEADERS },
  );
}
