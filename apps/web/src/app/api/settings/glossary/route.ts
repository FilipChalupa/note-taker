import { NextResponse } from "next/server";
import { addGlossaryTerms, getAppSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { terms: string[] } – append terms to the global glossary. */
export async function POST(req: Request) {
  let body: { terms?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const terms = Array.isArray(body.terms) ? body.terms.filter((t): t is string => typeof t === "string").slice(0, 50) : [];
  const added = addGlossaryTerms(terms);
  return NextResponse.json({ added, glossary: getAppSettings().glossary });
}
