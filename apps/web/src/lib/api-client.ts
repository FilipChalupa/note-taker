/** Browser-side fetch wrapper: throws an Error with a translated message when the server says no. */
import type { Messages } from "@/lib/i18n";
import { errorLabel } from "@/lib/format";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(m: Messages, input: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, { ...init, headers: { ...(init?.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) } });
  } catch {
    throw new ApiError(m.errors.NETWORK, 0, null);
  }
  if (!res.ok) {
    let code: string | null = null;
    try {
      code = ((await res.json()) as { error?: string }).error ?? null;
    } catch {
      /* no body */
    }
    throw new ApiError(errorLabel(code ?? `HTTP:${res.status}`, m) ?? `HTTP ${res.status}`, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
