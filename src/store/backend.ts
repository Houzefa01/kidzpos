import { create } from "zustand";
import { pingBackend } from "@/lib/apiClient";
import { flushOutbox, outbox } from "@/lib/outbox";
import { startSse, stopSse, isSseOpen } from "@/lib/sse";

interface BackendState {
  lanReachable: boolean;
  pendingCount: number;
  lastSync: number | null;
  setLan: (v: boolean) => void;
  refreshPending: () => void;
  pulse: () => Promise<void>;
}

export const useBackend = create<BackendState>((set, get) => ({
  lanReachable: false,
  pendingCount: outbox.size(),
  lastSync: null,
  setLan: (v) => set({ lanReachable: v }),
  refreshPending: () => set({ pendingCount: outbox.size() }),
  pulse: async () => {
    const wasReachable = get().lanReachable;
    // Si SSE est ouverte, le backend répond forcément — inutile de le pinguer
    const ok = isSseOpen() || await pingBackend();
    if (ok !== wasReachable) {
      set({ lanReachable: ok });
      if (ok) {
        // hydrateFromBackend déclenche startSse() en interne au succès.
        // Pas de .finally(startSse) ici : (1) ça dédoublait l'appel pendant la
        // fenêtre async POST /api/events/auth (deux EventSource ouverts au boot),
        // (2) en cas d'échec hydrate, ouvrir SSE est inutile (backend unreachable).
        import("@/lib/syncBackend")
          .then(({ hydrateFromBackend }) => hydrateFromBackend())
          .catch(() => {});
      } else {
        stopSse();
      }
    }
    if (ok && outbox.size() > 0) {
      const { sent } = await flushOutbox();
      if (sent > 0) set({ lastSync: Date.now() });
    }
    set({ pendingCount: outbox.size() });
  },
}));

let started = false;
export function startBackendWatcher() {
  if (started) return () => {};
  started = true;

  // Backoff intelligent : ping souvent quand offline (5s), peu quand online (30s)
  let id: number | null = null;
  const schedule = () => {
    if (id) clearInterval(id);
    const interval = useBackend.getState().lanReachable ? 30_000 : 5_000;
    id = window.setInterval(async () => {
      await useBackend.getState().pulse();
      // Si l'état change → reschedule pour ajuster la fréquence
      schedule();
    }, interval) as unknown as number;
  };

  // Ping initial
  useBackend.getState().pulse().then(schedule);

  const onOnline = () => useBackend.getState().pulse();
  window.addEventListener("online", onOnline);

  const onOutbox = () => useBackend.getState().refreshPending();
  window.addEventListener("outbox:change", onOutbox);

  // Quand l'URL API change (depuis Paramètres) → reset connexion
  const onApiChange = () => {
    stopSse();
    useBackend.setState({ lanReachable: false });
    useBackend.getState().pulse();
  };
  window.addEventListener("api-url:change", onApiChange);

  // Re-pulse immédiatement quand l'onglet redevient visible (ex: retour après veille)
  const onVisible = () => {
    if (document.visibilityState === "visible") {
      useBackend.getState().pulse().then(schedule);
    }
  };
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    if (id) clearInterval(id);
    stopSse();
    window.removeEventListener("online", onOnline);
    window.removeEventListener("outbox:change", onOutbox);
    window.removeEventListener("api-url:change", onApiChange);
    document.removeEventListener("visibilitychange", onVisible);
    started = false;
  };
}

import { api } from "@/lib/apiClient";

export async function pushMutation(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
  ref?: string
) {
  const { lanReachable } = useBackend.getState();
  if (!lanReachable) {
    outbox.enqueue({ path, method, body, ref });
    useBackend.getState().refreshPending();
    return { queued: true };
  }
  try {
    await api(path, { method, body, timeoutMs: 8000 }); // 8s pour les mutations
    return { queued: false };
  } catch (err: unknown) {
    const apiErr = err instanceof Error ? err : null;
    const status = (err as { status?: number })?.status;
    if (status && status >= 400 && status < 500) {
      return { queued: false, error: apiErr?.message };
    }
    outbox.enqueue({ path, method, body, ref });
    useBackend.getState().setLan(false);
    useBackend.getState().refreshPending();
    return { queued: true };
  }
}
