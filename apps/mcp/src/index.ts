#!/usr/bin/env node
/**
 * Note Taker MCP server.
 *
 *   NOTE_TAKER_URL=http://localhost:3000 NOTE_TAKER_TOKEN=nt_... note-taker-mcp
 *
 * Default transport is stdio, so the agent starts the process itself and nothing is exposed on the network.
 * With --http the server listens on 127.0.0.1 and requires the same token as a bearer, with DNS rebinding
 * protection enabled.
 */
import { randomUUID } from "node:crypto";
import http from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { NoteTakerApi } from "./api.js";
import { buildServer } from "./server.js";

interface Args {
  url: string;
  token: string;
  http: boolean;
  host: string;
  port: number;
  allowDestructive: boolean;
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    url: (get("--url") ?? env.NOTE_TAKER_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
    token: get("--token") ?? env.NOTE_TAKER_TOKEN ?? "",
    http: argv.includes("--http"),
    host: get("--host") ?? env.NOTE_TAKER_MCP_HOST ?? "127.0.0.1",
    port: Number(get("--port") ?? env.NOTE_TAKER_MCP_PORT ?? 7337),
    allowDestructive: argv.includes("--allow-destructive") || /^(1|true|yes)$/i.test(env.NOTE_TAKER_ALLOW_DESTRUCTIVE ?? ""),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), process.env);
  if (!args.token) {
    console.error("NOTE_TAKER_TOKEN is required. Create a token in Note Taker under Settings, Agent access.");
    process.exit(2);
  }
  const api = new NoteTakerApi(args.url, args.token);
  let identity;
  try {
    identity = await api.me();
  } catch (err) {
    console.error(`Cannot talk to Note Taker at ${args.url}: ${(err as Error).message}`);
    process.exit(2);
  }
  const server = buildServer(api, identity, { allowDestructive: args.allowDestructive });
  console.error(`[note-taker-mcp] token "${identity.name}" with scopes ${identity.scopes.join(", ")}${identity.tagFilter ? ` limited to tag ${identity.tagFilter}` : ""}`);

  if (!args.http) {
    await server.connect(new StdioServerTransport());
    return;
  }

  // HTTP mode: one transport per request, loopback only, bearer token required.
  const httpServer = http.createServer(async (req, res) => {
    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${args.token}`) {
      res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableDnsRebindingProtection: true,
      allowedHosts: [`${args.host}:${args.port}`, `localhost:${args.port}`, `127.0.0.1:${args.port}`],
    });
    res.on("close", () => void transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
  httpServer.listen(args.port, args.host, () => console.error(`[note-taker-mcp] streamable HTTP on http://${args.host}:${args.port}`));
}

main().catch((err) => {
  console.error("[note-taker-mcp] fatal:", err);
  process.exit(1);
});
