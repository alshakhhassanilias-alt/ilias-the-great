import type { ControlAction, ControlResponse, LoginResponse } from "./types";

const TOKEN_KEY = "qe_cc_token";
const MODE_KEY = "qe_cc_mode";

let memToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

function storageGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode / blocked) - memory copy still works */
  }
}

export function loadSession(): { token: string | null; mode: string | null } {
  memToken = memToken ?? storageGet(TOKEN_KEY);
  return { token: memToken, mode: storageGet(MODE_KEY) };
}

export function saveSession(token: string, mode: string): void {
  memToken = token;
  storageSet(TOKEN_KEY, token);
  storageSet(MODE_KEY, mode);
}

export function clearSession(): void {
  memToken = null;
  storageSet(TOKEN_KEY, null);
  storageSet(MODE_KEY, null);
}

export function getToken(): string | null {
  return memToken;
}

export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.detail === "string") return body.detail;
    if (body && Array.isArray(body.detail)) return body.detail.map((d: { msg?: string }) => d.msg ?? "").join("; ");
  } catch {
    /* non-JSON body */
  }
  return res.statusText || `HTTP ${res.status}`;
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (memToken) headers.Authorization = `Bearer ${memToken}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (res.status === 401) {
    clearSession();
    unauthorizedHandler?.();
    throw new ApiError(401, "Session expired - please log in again");
  }
  if (!res.ok) throw new ApiError(res.status, await errorDetail(res));
  return (await res.json()) as T;
}

export const apiGet = <T>(path: string) => request<T>("GET", path);

export async function login(username: string, password: string): Promise<LoginResponse> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username, password }),
    cache: "no-store",
  });
  if (res.status === 401) throw new ApiError(401, "Invalid username or password.");
  if (res.status === 429) throw new ApiError(429, "Too many login attempts. Wait a minute and try again.");
  if (!res.ok) throw new ApiError(res.status, `Login failed: ${await errorDetail(res)}`);
  return (await res.json()) as LoginResponse;
}

export function postControl(
  action: ControlAction,
  body: { confirm: string; reason: string; discrepancy_explained: boolean },
): Promise<ControlResponse> {
  return request<ControlResponse>("POST", `/api/controls/${action}`, body);
}
