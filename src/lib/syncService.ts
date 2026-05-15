/**
 * syncService — Anti-corruption layer offline-first.
 *
 * Point d'entrée UNIQUE pour toutes les mutations du frontend. Encapsule :
 *  - la décision online/offline → envoi direct ou file outbox
 *  - le replay de la file au retour réseau
 *  - la traçabilité des 4xx rejetés (failedReplays + toast)
 *  - la garde des mutations sensibles (POST/PUT /api/users : password jamais
 *    persisté dans localStorage, même sur timeout/5xx)
 *
 * Le module est paramétré par un Transport injectable → testable avec un mock
 * (cf syncService.test.ts), pas de fetch réel pendant les tests.
 *
 * Migration progressive : pushMutation (cf store/backend.ts) délègue à
 * syncService.submit() depuis P1, mais conserve sa signature pour que les
 * 24 call-sites des stores n'aient pas besoin d'être adaptés.
 */

import { api, ApiError } from "@/lib/apiClient";
import { outbox } from "@/lib/outbox";
import { useBackend } from "@/store/backend";
import { useFailedReplays } from "@/store/failedReplays";
import { toast } from "sonner";

export type HttpMethod = "POST" | "PUT" | "PATCH" | "DELETE";

export interface MutationSpec {
  path: string;
  method: HttpMethod;
  body?: unknown;
  /** Dédoublonnage outbox pour PUT/DELETE sur la même ressource logique. */
  ref?: string;
  /** Force le statut "sensible" (override de la détection automatique).
   *  Mutation sensible = jamais persistée localement (password en clair). */
  sensitive?: boolean;
}

export interface SubmitResult {
  queued: boolean;
  error?: string;
}

export interface ReplayResult {
  sent: number;
  failed: number;
}

/** Surface réseau / file abstraite. Remplaçable en test via createSyncService. */
export interface Transport {
  isOnline(): boolean;
  send(spec: MutationSpec): Promise<void>;
  enqueue(spec: MutationSpec, reason: "offline" | "failure-after-mark"): void;
  markUnreachable(): void;
  drainQueue(): Promise<ReplayResult>;
  pendingCount(): number;
}

export interface SyncService {
  submit(spec: MutationSpec): Promise<SubmitResult>;
  replay(): Promise<ReplayResult>;
  pendingCount(): number;
}

const SENSITIVE_AUTH_PATH = /^\/api\/users(\/|$)/;

function isSensitive(spec: MutationSpec): boolean {
  if (spec.sensitive) return true;
  if (spec.method !== "POST" && spec.method !== "PUT") return false;
  return SENSITIVE_AUTH_PATH.test(spec.path);
}

export function createSyncService(transport: Transport): SyncService {
  return {
    async submit(spec) {
      const sensitive = isSensitive(spec);

      if (!transport.isOnline()) {
        if (sensitive) {
          return { queued: false, error: "Connexion serveur requise pour cette opération" };
        }
        transport.enqueue(spec, "offline");
        return { queued: true };
      }

      try {
        await transport.send(spec);
        return { queued: false };
      } catch (err: unknown) {
        const status = (err as { status?: number })?.status;
        const message = err instanceof Error ? err.message : "Erreur inconnue";

        // 4xx : faute applicative côté client/données → ne pas enfiler, remonter l'erreur.
        if (status !== undefined && status >= 400 && status < 500) {
          return { queued: false, error: message };
        }

        // 5xx ou réseau : backend indisponible. Bascule lan=false dans tous les cas
        // (sensible ou non), puis enfile si non-sensible.
        transport.markUnreachable();
        if (sensitive) {
          return {
            queued: false,
            error: "Échec serveur — opération sensible non enregistrée, recommencez",
          };
        }
        transport.enqueue(spec, "failure-after-mark");
        return { queued: true };
      }
    },

    replay() {
      return transport.drainQueue();
    },

    pendingCount() {
      return transport.pendingCount();
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Transport par défaut : adapte apiClient + outbox + useBackend + failedReplays
// + sonner. Reproduit fidèlement le comportement de pushMutation + flushOutbox
// historique (mêmes side-effects sur lanReachable et pendingCount).
// ────────────────────────────────────────────────────────────────────────────

const defaultTransport: Transport = {
  isOnline: () => useBackend.getState().lanReachable,

  async send(spec) {
    await api(spec.path, { method: spec.method, body: spec.body, timeoutMs: 8000 });
  },

  enqueue(spec, _reason) {
    outbox.enqueue({ path: spec.path, method: spec.method, body: spec.body, ref: spec.ref });
    useBackend.getState().refreshPending();
  },

  markUnreachable() {
    useBackend.getState().setLan(false);
  },

  /**
   * Vide la file dans l'ordre. Pour chaque entrée :
   *  - succès → retire de l'outbox
   *  - 4xx → trace dans failedReplays + toast, retire (sinon boucle infinie)
   *  - 5xx / réseau → garde l'entrée, casse la boucle (inutile d'insister)
   *
   * Le verrou `flushing` est porté par cette closure pour empêcher la
   * réentrance (deux pulses concurrents au boot).
   */
  async drainQueue() {
    if (drainingRef.value) return { sent: 0, failed: 0 };
    drainingRef.value = true;
    let sent = 0;
    let failed = 0;
    try {
      const entries = outbox.list();
      for (const e of entries) {
        try {
          await api(e.path, { method: e.method, body: e.body, timeoutMs: 5000 });
          outbox.remove(e.id);
          sent++;
        } catch (err) {
          failed++;
          if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
            const message =
              (err.body as { error?: string } | null)?.error ?? err.message ?? `HTTP ${err.status}`;
            useFailedReplays.getState().add({
              ts: Date.now(),
              path: e.path,
              method: e.method,
              body: e.body,
              ref: e.ref,
              status: err.status,
              error: message,
            });
            toast.error(`Mutation rejetée (${err.status}) : ${message}`, { duration: 6000 });
            outbox.remove(e.id);
          } else {
            // Réseau HS / 5xx — inutile d'insister sur les suivantes
            break;
          }
        }
      }
    } finally {
      drainingRef.value = false;
    }
    return { sent, failed };
  },

  pendingCount: () => outbox.size(),
};

// Verrou réentrance pour drainQueue (cf flushing flag historique)
const drainingRef = { value: false };

/** Instance singleton utilisée par pushMutation et backend.pulse. */
export const syncService = createSyncService(defaultTransport);
