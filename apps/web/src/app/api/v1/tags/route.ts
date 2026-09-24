import { NextResponse } from "next/server";
import { requireToken, withApi } from "@/lib/auth";
import { listTags } from "@/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi("tags", async (req) => {
  const token = requireToken(req, "read");
  const tags = listTags().filter((t) => !token.tagFilter || t.tag.toLowerCase() === token.tagFilter.toLowerCase());
  return { response: NextResponse.json({ tags }), token };
});
