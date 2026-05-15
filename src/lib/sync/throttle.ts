/**
 * Throttle simple à intervalle minimum (équivalent à un token bucket de
 * capacité 1, taux régulier). Sert à lisser les requêtes du replay outbox :
 * 5 req/s par défaut empêche le burst au reconnect (1000 mutations en
 * cascade ne saturent plus le backend).
 *
 * Asynchrone et non-bloquant : la promesse `acquire()` se résout via
 * setTimeout. Aucun blocage du thread UI.
 *
 * Cumule le temps d'attente total dans `totalDelayMs()` — exposé pour la
 * métrique `replay_throttle_delay_ms` du metricsReporter.
 */

export interface ThrottleController {
  /** Attends jusqu'à ce qu'un slot soit disponible. Résout immédiatement si OK. */
  acquire(): Promise<void>;
  /** Cumul des ms d'attente depuis le dernier reset(). */
  totalDelayMs(): number;
  /** Reset le cumul (typiquement après envoi des metrics au backend). */
  reset(): void;
}

export interface ThrottleOptions {
  /** Default 5. Doit être > 0. */
  maxRequestsPerSecond?: number;
  /** Pour les tests : remplace setTimeout et Date.now. */
  setTimeout?: (cb: () => void, ms: number) => unknown;
  now?: () => number;
}

export function createThrottle(opts: ThrottleOptions = {}): ThrottleController {
  const rps = Math.max(0.1, opts.maxRequestsPerSecond ?? 5);
  const minIntervalMs = 1000 / rps;
  const setTimeoutFn = opts.setTimeout ?? globalThis.setTimeout;
  const now = opts.now ?? Date.now;

  let lastEmitMs = 0;
  let firstAcquired = false;  // évite la condition fragile lastEmitMs > 0 avec une horloge fake @ 0
  let totalDelay = 0;
  // Sérialise les acquire() : si N appellent au même tick, ils s'enchaînent
  // au lieu de tous démarrer en même temps.
  let chain: Promise<void> = Promise.resolve();

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeoutFn(resolve, ms));
  }

  return {
    acquire() {
      const wait = chain.then(async () => {
        if (firstAcquired) {
          const elapsed = now() - lastEmitMs;
          if (elapsed < minIntervalMs) {
            const w = minIntervalMs - elapsed;
            totalDelay += w;
            await sleep(w);
          }
        }
        lastEmitMs = now();
        firstAcquired = true;
      });
      chain = wait.catch(() => {});
      return wait;
    },
    totalDelayMs() { return totalDelay; },
    reset() { totalDelay = 0; },
  };
}
