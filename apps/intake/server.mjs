import { loadConfig } from "./src/config.mjs";
import { startIntake } from "./src/app.mjs";

const config = loadConfig();
if (!config.collectToken) console.warn("[intake] INTAKE_COLLECT_TOKEN is not set: uploads are accepted but nothing can collect them.");
const intake = await startIntake(config);
console.log(
  `[intake] listening on http://${config.host}:${intake.publicPort}` +
    (intake.collectPort != null ? `, collector API on ${config.collectHost}:${intake.collectPort}` : config.collectToken ? " (collector API on the same port)" : "") +
    (config.uploadCode ? ", access code required" : ""),
);
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    await intake.close();
    process.exit(0);
  });
}
