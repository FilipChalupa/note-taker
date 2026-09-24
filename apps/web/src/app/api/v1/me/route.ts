import { NextResponse } from "next/server";
import type { ApiIdentity } from "@note-taker/shared";
import { config } from "@/lib/config";
import { requireToken, withApi } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Capability discovery: the MCP server calls this at startup and exposes only the matching tools. */
export const GET = withApi("me", async (req) => {
  const token = requireToken(req, "any");
  const identity: ApiIdentity = {
    name: token.name,
    scopes: token.scopes,
    tagFilter: token.tagFilter,
    expiresAt: null,
    limits: { requestsPerHour: config.apiRequestsPerHour, submitsPerHour: config.apiSubmitsPerHour, maxUploadBytes: config.maxUploadBytes },
    defaultLanguage: config.defaultLanguage,
    version: "1",
  };
  return { response: NextResponse.json(identity), token };
});
