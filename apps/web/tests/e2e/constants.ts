/** Ports and secrets shared by the global setup and the specs. */
export const WEB_PORT = 3124;
export const WORKER_PORT = 8765;
export const INTAKE_PORT = 8090;
export const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
export const INTAKE_URL = `http://127.0.0.1:${INTAKE_PORT}`;
export const INTAKE_CODE = "e2e-code";
export const INTAKE_TOKEN = "e2e-collect-token";
