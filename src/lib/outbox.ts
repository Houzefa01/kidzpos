// File d'attente offline : quand le backend LAN n'est pas joignable,
// on enfile les mutations et on les rejoue dès qu'il revient.
// Stocké en localStorage pour survivre à un reload.
//
// Module bas-niveau : pure persistance. Toute la logique de submit/replay vit
// désormais dans @/lib/syncService (P1 anti-corruption layer).

import { z } from "zod";

export interface OutboxEntry {
  id: string;
  ts: number;
  path: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Identifiant logique (ex: "sale:sale-123") pour dédoublonnage UI. */
  ref?: string;
  retries: number;
  lastError?: string;
}

const OutboxEntrySchema = z.object({
  id: z.string(),
  ts: z.number(),
  path: z.string(),
  method: z.enum(["POST", "PUT", "PATCH", "DELETE"]),
  body: z.unknown().optional(),
  ref: z.string().optional(),
  retries: z.number(),
  lastError: z.string().optional(),
});

const KEY = "kidzpos-outbox";
/** I6 : plafond pour éviter la saturation localStorage après plusieurs jours offline. */
const MAX_ENTRIES = 500;

function read(): OutboxEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return z.array(OutboxEntrySchema).parse(raw);
  } catch { return []; }
}
function write(list: OutboxEntry[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent("outbox:change"));
}

export const outbox = {
  list: () => read(),
  size: () => read().length,
  enqueue(entry: Omit<OutboxEntry, "id" | "ts" | "retries">) {
    let all = read();
    // I6 : dédoublonnage par `ref` pour PUT et DELETE — un nouvel update/delete remplace
    // les précédents pour la même ressource (évite N PUT redondants pour un seul produit).
    // POST n'est PAS dédupliqué : chaque vente / création client est une mutation distincte.
    if (entry.ref && (entry.method === "PUT" || entry.method === "DELETE")) {
      all = all.filter((e) => !(e.ref === entry.ref && (e.method === "PUT" || e.method === "DELETE")));
    }
    all.push({
      ...entry,
      id: `ob-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ts: Date.now(),
      retries: 0,
    });
    // I6 : FIFO bounded — on garde les MAX_ENTRIES plus récentes.
    if (all.length > MAX_ENTRIES) {
      all = all.slice(-MAX_ENTRIES);
    }
    write(all);
  },
  remove(id: string) {
    write(read().filter((e) => e.id !== id));
  },
  clear() {
    write([]);
  },
};
