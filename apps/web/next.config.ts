import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  // Monorepo: trace files from the workspace root so the standalone build includes hoisted deps
  outputFileTracingRoot: path.join(__dirname, "../../"),
  transpilePackages: ["@note-taker/shared"],
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
