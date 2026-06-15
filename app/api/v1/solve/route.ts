import { NextResponse } from "next/server";
import type { ApiError, SolveRequest } from "@/lib/api/types";
import { solveRequest } from "@/lib/api/solve-request";

// Accepts any localhost / 127.0.0.1 dev origin (any port) plus the prod
// host. Add additional production origins here as needed.
const ALLOWED_HOSTS = new Set<string>([
  "statics.kafkadesign.io",
  "structural-terminal.vercel.app",
  "app-topaz-five-44.vercel.app",
]);

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true;
    return ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = isAllowedOrigin(origin) ? origin! : "http://localhost:5173";
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

export async function POST(req: Request) {
  const cors = corsHeaders(req.headers.get("origin"));
  let body: SolveRequest;
  try {
    body = (await req.json()) as SolveRequest;
  } catch {
    return jsonError(
      { ok: false, error: "invalid_input", message: "Body must be valid JSON." },
      400,
      cors,
    );
  }

  const response = solveRequest(body);
  if (!response.ok) return jsonError(response, responseStatus(response), cors);

  return new NextResponse(JSON.stringify(response), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function jsonError(err: ApiError, status: number, cors: Record<string, string>) {
  return new NextResponse(JSON.stringify(err), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function responseStatus(err: ApiError): number {
  return err.error === "invalid_input" ||
    err.error === "degenerate_member" ||
    err.error === "non_positive_section"
    ? 400
    : 422;
}
