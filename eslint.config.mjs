// Lints everything except the Next.js app, which has its own config (eslint-config-next needs `next`
// to be resolvable). `pnpm lint` runs both.
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

const unused = ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }];

export default defineConfig([
  globalIgnores(["**/node_modules/**", "**/dist/**", "**/data/**", "apps/web/**", "apps/worker/**"]),

  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: { "@typescript-eslint/no-unused-vars": unused },
  },
  {
    files: ["**/*.{js,mjs}"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: { "no-unused-vars": unused },
  },
  // The intake page's browser script
  { files: ["apps/intake/public/**/*.js"], languageOptions: { globals: globals.browser, sourceType: "module" } },
]);
