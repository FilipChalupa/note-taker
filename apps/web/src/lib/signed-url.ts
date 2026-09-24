/** Short-lived signed links to audio, so an agent can hand a plain URL to a tool that cannot set headers. */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getSetting, setSetting } from "@/lib/settings";

function secret(): string {
  let value = getSetting("audio_signing_secret");
  if (!value) {
    value = randomBytes(32).toString("base64url");
    setSetting("audio_signing_secret", value);
  }
  return value;
}

const sign = (id: string, exp: number) => createHmac("sha256", secret()).update(`${id}:${exp}`).digest("base64url");

export function signAudioPath(id: string, ttlSeconds = 900): string {
  const exp = Math.floor(Date.now() / 1000) + Math.max(30, Math.min(86400, ttlSeconds));
  return `/api/v1/recordings/${id}/audio?exp=${exp}&sig=${sign(id, exp)}`;
}

export function verifyAudioSignature(id: string, exp: string | null, sig: string | null): boolean {
  if (!exp || !sig) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum * 1000 < Date.now()) return false;
  const expected = Buffer.from(sign(id, expNum));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
