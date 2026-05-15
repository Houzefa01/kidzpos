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
import { createBackoffPolicy } from "@/lib/sync/backoff";
import { createThrottle } from "@/lib/sync/throttle";
import { processBatches } from "@/lib/sync/replayBatch";

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
   * P4 — Replay contrôlé.
   *
   *   • Batching        : tranche en lots de BATCH_SIZE, pause BATCH_PAUSE_MS
   *                       entre lots pour laisser respirer le backend.
   *   • Throttling      : THROTTLE_RPS req/s max (≃ 5/s par défaut) — élimine
   *                       les bursts au reconnect.
   *   • Backoff         : si un drain finit sur 5xx/réseau, on note l'échec
   *                       et le PROCHAIN appel à drainQueue (déclenché par
   *                       backend.pulse) est court-circuité tant que
   *                       `nextDrainAt` n'est pas atteint. Exponentiel +
   *                       jitter ±20 %, capé à 30 s.
   *   • Overflow guard  : si outbox > MAX_QUEUE_SIZE (5000), on PAUSE le
   *                       drain et on dépose UNE entrée synthétique dans
   *                       failedReplays (visible dans l'UI existante) à la
   *                       transition. Reset quand la file redescend.
   *
   * Le contrat extérieur est préservé : Promise<{sent, failed}> ; verrou
   * réentrance ; ordre FIFO strict ; 4xx → failedReplays + toast (inchangé).
   */
  async drainQueue() {
    if (drainingRef.value) return { sent: 0, failed: 0 };

    // Backoff : si le précédent drain a échoué, on attend la fenêtre.
    if (Date.now() < nextDrainAt) {
      return { sent: 0, failed: 0 };
    }

    // Overflow guard : on ne tente pas de drainer une file gigantesque
    // (signe que le backend est durablement KO ou que le client génère trop).
    const size = outbox.size();
    if (size > MAX_QUEUE_SIZE) {
      notifyOverflowOnce(size);
      return { sent: 0, failed: 0 };
    }
    // Sortie de l'overflow → on autorise les nouvelles notifications.
    clearOverflowNotification();

    drainingRef.value = true;
    try {
      const result = await processBatches({
        outboxList: () => outbox.list(),
        outboxRemove: (id) => outbox.remove(id),
        apiSend: (e) => api(e.path, { method: e.method, body: e.body, timeoutMs: 5000 }),
        onSuccess: (e) => {
          recordLatencySample(Date.now() - e.ts);
          batchItemsProcessed++;
        },
        onFailure4xx: (e, err) => {
          const body = (err as ApiError).body as { error?: string } | null;
          const message = body?.error ?? err.message ?? `HTTP ${err.status}`;
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
          batchItemsProcessed++;
        },
        on5xxOrNetwork: () => {
          // Réseau HS / 5xx — on stoppe le drain. Le backoff prend le relai.
        },
        throttle: replayThrottle,
        batchSize: BATCH_SIZE,
        batchPauseMs: BATCH_PAUSE_MS,
      });

      // Mise à jour de la politique backoff selon le résultat du drain.
      if (result.stoppedOnError) {
        backoff.fail();
        backoffRetries++;
        nextDrainAt = Date.now() + backoff.nextDelayMs();
      } else {
        backoff.reset();
        nextDrainAt = 0;
      }

      return { sent: result.sent, failed: result.failed };
    } finally {
      drainingRef.value = false;
    }
  },

  pendingCount: () => outbox.size(),
};

// Verrou réentrance pour drainQueue (cf flushing flag historique)
const drainingRef = { value: false };

// ────────────────────────────────────────────────────────────────────────────
// P4 — État interne du replay contrôlé (batch / throttle / backoff / overflow)
// ────────────────────────────────────────────────────────────────────────────

/** Taille d'un lot de drain. ~15 messages avant pause respiratoire. */
const BATCH_SIZE = 15;
/** Pause entre deux lots (ms). Pas trop long pour ne pas étirer un gros drain. */
const BATCH_PAUSE_MS = 50;
/** Throttle nominal : 5 req/s soutenu (≈ 200 ms entre deux fetchs). */
const THROTTLE_RPS = 5;
/** Plafond outbox : au-delà, on PAUSE le drain (signe de désastre réseau). */
const MAX_QUEUE_SIZE = 5000;

const backoff = createBackoffPolicy({ baseDelayMs: 1000, maxDelayMs: 30_000, jitterPct: 0.2 });
const replayThrottle = createThrottle({ maxRequestsPerSecond: THROTTLE_RPS });

/** Fenêtre temporelle : si non-nulle, drainQueue retourne immédiatement avant ce timestamp. */
let nextDrainAt = 0;

/** Compteurs cumulés (deltas exposés au metricsReporter, reset() à chaque envoi). */
let batchItemsProcessed = 0;
let backoffRetries = 0;

/** Lecture-destructive : appelé par metricsReporter pour expédier les deltas. */
export function drainReplayStats(): {
  batchSize: number;
  throttleDelayMs: number;
  backoffRetries: number;
} {
  const out = {
    batchSize: batchItemsProcessed,
    throttleDelayMs: Math.round(replayThrottle.totalDelayMs()),
    backoffRetries,
  };
  batchItemsProcessed = 0;
  backoffRetries = 0;
  replayThrottle.reset();
  return out;
}

/** Pour les tests : remet à zéro toute la machinerie P4. */
export function __resetReplayStateForTests(): void {
  drainingRef.value = false;
  backoff.reset();
  replayThrottle.reset();
  nextDrainAt = 0;
  batchItemsProcessed = 0;
  backoffRetries = 0;
  overflowNotified = false;
}

// ── Overflow guard ──────────────────────────────────────────────────────────
let overflowNotified = false;
function notifyOverflowOnce(currentSize: number): void {
  if (overflowNotified) return;
  overflowNotified = true;
  // Entrée synthétique visible dans le FailedReplaysButton existant.
  useFailedReplays.getState().add({
    ts: Date.now(),
    path: "<replay-paused>",
    method: "POST",
    status: 0,
    error: `Replay en pause — file d'attente saturée (${currentSize} actions). Reprise automatique dès retrait de l'excédent.`,
  });
}
function clearOverflowNotification(): void {
  overflowNotified = false;
}

// ────────────────────────────────────────────────────────────────────────────
// Sync latency samples (P3) — exposés à metricsReporter.
// On garde un ring buffer borné pour éviter toute fuite mémoire si le reporter
// est désactivé ou ne tourne pas. Lecture-destructive (drainLatencySamples).
// ────────────────────────────────────────────────────────────────────────────
const LATENCY_BUFFER_MAX = 100;
const latencySamples: number[] = [];

function recordLatencySample(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return;
  if (latencySamples.length >= LATENCY_BUFFER_MAX) {
    latencySamples.shift();
  }
  latencySamples.push(ms);
}

/** Retourne ET vide le buffer interne. Appelé par metricsReporter à chaque tick. */
export function drainLatencySamples(): number[] {
  if (latencySamples.length === 0) return [];
  const out = latencySamples.slice();
  latencySamples.length = 0;
  return out;
}

/** Instance singleton utilisée par pushMutation et backend.pulse. */
export const syncService = createSyncService(defaultTransport);
