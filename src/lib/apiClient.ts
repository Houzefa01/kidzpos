import { getApiUrl } from "./apiConfig";

const TOKEN_KEY = "kidzpos-jwt";

function isTokenExpired(token: string): boolean {
  try {
    // JWT utilise base64url (- et _ au lieu de + et /) — atob() n'accepte que base64 standard
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64)) as { exp?: number };
    return typeof payload.exp === "number" && payload.exp * 1000 < Date.now();
  } catch {
    // Si on ne peut pas décoder, ne pas supprimer le token — laisser le backend valider
    return false;
  }
}

export const tokenStore = {
  get: (): string | null => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (t && isTokenExpired(t)) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return t;
  },
  set: (t: string | null) => {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  },
};

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, msg?: string) {
    super(msg ?? (body as Record<string, string>)?.error ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  timeoutMs?: number;
  noAuth?: boolean;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const token = opts.noAuth ? null : tokenStore.get();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 4000);
  try {
    const res = await fetch(`${getApiUrl()}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      if (res.status === 401) {
        tokenStore.set(null);
        // Émettre un événement pour que AppLayout gère la redirection via React Router
        // Évite le hard reload qui perd l'état React
        window.dispatchEvent(new CustomEvent("auth:session-expired"));
      }
      throw new ApiError(res.status, data);
    }
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(t: string): unknown {
  try { return JSON.parse(t); } catch { return t; }
}

/** Ping rapide pour détecter si le backend répond. Silencieux. */
export async function pingBackend(timeoutMs = 1500): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${getApiUrl()}/actuator/health`, {
      signal: ctrl.signal,
      // évite le bruit console
      mode: "cors",
    }).catch(() => null);
    clearTimeout(timer);
    return !!res && res.ok;
  } catch {
    return false;
  }
}
