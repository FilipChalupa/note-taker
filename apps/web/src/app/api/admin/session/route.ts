import { NextResponse } from "next/server";
import { ADMIN_COOKIE, adminConfigured, checkPassword, clientKey, isAdminRequest, recordFailure, sessionCookieOptions, sessionCookieValue, tooManyFailures } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return NextResponse.json({ configured: adminConfigured(), unlocked: isAdminRequest(req) });
}

/** POST { password } unlocks token management for 12 hours. */
export async function POST(req: Request) {
  if (!adminConfigured()) return NextResponse.json({ error: "ADMIN_NOT_CONFIGURED" }, { status: 403 });
  const key = clientKey(req);
  if (tooManyFailures(key)) return NextResponse.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429 });
  let body: { password?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* treated as a wrong password */
  }
  if (!checkPassword(body.password)) {
    recordFailure(key);
    return NextResponse.json({ error: "WRONG_PASSWORD" }, { status: 401 });
  }
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(ADMIN_COOKIE, sessionCookieValue(), sessionCookieOptions(req));
  return res;
}

export async function DELETE(req: Request) {
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(ADMIN_COOKIE, "", { ...sessionCookieOptions(req), maxAge: 0 });
  return res;
}
