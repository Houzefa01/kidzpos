---
name: frontend-skill
description: >
  Skill frontend KidzPOS. Se déclenche sur : composant React, page POS, page Sales,
  page Stock, page Settings, page Customers, page Users, Dashboard, AppLayout,
  AppSidebar, store Zustand, hook, shadcn/ui, Tailwind, Radix UI, design system,
  money formatting, outbox, SSE côté client, syncBackend, schemas Zod frontend,
  apiClient, useFormatMoney, useAuth, useData, useSettings, useExchange, useCustomers,
  useBackend, offline, panier, caisse, reçu PDF, export CSV.
---

# Skill Frontend — KidzPOS

## Contexte applicatif

SPA React offline-first. La source de vérité est le backend PostgreSQL, mais le frontend
fonctionne sans réseau grâce aux stores Zustand persistés et à la file d'outbox.

---

## Organisation des fichiers (`src/`)

```
src/
├── App.tsx                  # Router + QueryClientProvider + lazy loading
├── main.tsx                 # startBackendWatcher() via queueMicrotask (après hydratation Zustand)
├── index.css                # Design system (tokens HSL, classes utilitaires)
├── pages/
│   ├── POS.tsx              # Caisse : grille produits + panier + paiement
│   ├── Sales.tsx            # Historique ventes + filtre + export CSV/PDF
│   ├── Stock.tsx            # Ajustements + transferts inter-magasins
│   ├── Settings.tsx         # Paramètres shop (ADMIN only)
│   ├── Customers.tsx        # Programme fidélité
│   ├── Users.tsx            # Gestion comptes (ADMIN only)
│   ├── Dashboard.tsx        # KPIs + Recharts
│   ├── Login.tsx            # Auth locale + backend
│   └── Index.tsx            # Redirect vers POS
├── components/
│   ├── ui/                  # shadcn/ui — NE PAS MODIFIER MANUELLEMENT
│   ├── AppLayout.tsx        # Layout + RequireRole + session-expired handler
│   ├── AppSidebar.tsx       # Navigation principale
│   ├── OfflineBanner.tsx    # Bannière offline + count outbox
│   ├── CategoryCombobox.tsx # Combobox catégories produits
│   ├── CustomerPicker.tsx   # Sélecteur client fidélité
│   ├── ConfirmDialog.tsx    # Dialogs de confirmation destructive
│   ├── StatCard.tsx         # Carte KPI Dashboard
│   ├── NavLink.tsx          # Lien sidebar actif
│   └── ThemeToggle.tsx      # Bascule dark/light
├── store/
│   ├── auth.ts              # user, users, passwords (offline), tentatives
│   ├── data.ts              # stores, products, sales, moves, parked carts
│   ├── settings.ts          # taxRate, currency, shopName, points…
│   ├── exchange.ts          # taux EUR→AR (live ou manuel)
│   ├── backend.ts           # lanReachable, pendingCount, pulse(), pushMutation()
│   └── customers.ts         # programme fidélité
├── lib/
│   ├── apiClient.ts         # fetch wrapper, tokenStore, ApiError, pingBackend
│   ├── apiConfig.ts         # getApiUrl() — URL backend configurable
│   ├── outbox.ts            # File localStorage offline (max 500 entrées)
│   ├── sse.ts               # EventSource + reconnexion exponentielle
│   ├── syncBackend.ts       # hydrateFromBackend() — re-fetch complet
│   ├── schemas.ts           # Zod schemas miroir des DTOs Java
│   ├── money.ts             # formatMoney() + useFormatMoney()
│   ├── crypto.ts            # hashPassword / verifyPassword (SubtleCrypto)
│   ├── pdf.ts               # downloadReceiptPdf / downloadSalesReportPdf
│   ├── sync.ts              # broadcastSync (BroadcastChannel entre onglets)
│   └── preload.ts           # Préchargement des pages lazy
└── hooks/
    ├── useDebouncedValue.ts # Debounce recherche produits
    ├── useHotkeys.ts        # Raccourcis clavier POS (F2, F9, Escape)
    └── useOnlineStatus.ts   # navigator.onLine
```

---

## Patterns de stores Zustand

### Structure type d'un store

```typescript
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useMonStore = create<MonState>()(
  persist(
    (set, get) => ({
      // état initial
      items: [],

      // actions
      addItem: (item) => {
        set((s) => ({ items: [...s.items, item] }));
        broadcastSync("kidzpos-mon-store");
        pushMutation("/api/items", "POST", item, `item:${item.id}`);
      },
    }),
    {
      name: "kidzpos-mon-store",  // clé localStorage
      version: 1,                  // incrémenter si le schema change
      migrate: (persisted, version) => {
        // gérer les migrations de schema ici
        return persisted;
      },
    }
  )
);
```

### Règles Zustand impératives

- `broadcastSync("kidzpos-*")` après chaque mutation (sync onglets)
- `pushMutation(path, method, body, ref)` est le SEUL chemin vers le backend
- Jamais de `useState` + `useEffect` pour ce qu'un sélecteur Zustand peut faire
- `version` à incrémenter + `migrate()` à implémenter si le schema change
- Les sélecteurs sont préférés aux subscriptions : `useStore((s) => s.field)`

### pushMutation — comportement

```typescript
// Dans backend.ts
export async function pushMutation(path, method, body?, ref?) {
  if (!lanReachable) {
    outbox.enqueue({ path, method, body, ref }); // → localStorage
    return { queued: true };
  }
  try {
    await api(path, { method, body, timeoutMs: 8000 });
    return { queued: false };
  } catch (err) {
    if (status >= 400 && status < 500) return { queued: false, error };
    outbox.enqueue(…); setLan(false);  // réseau HS → outbox
    return { queued: true };
  }
}
```

---

## Design system (index.css)

### Thème : dark SaaS POS

- Mode par défaut : **dark** (`:root` = dark, `.light` = light)
- Couleur primaire : violet `hsl(265 85% 65%)`
- Couleur accent : cyan `hsl(190 95% 55%)`
- Succès : vert `hsl(150 70% 50%)`, Warning : ambre `hsl(38 95% 60%)`
- Radius : `0.75rem`

### Classes utilitaires custom (dans `index.css`)

```css
.gradient-primary   /* bouton principal violet */
.gradient-card      /* fond de card dégradé */
.gradient-hero      /* fond radial hero */
.shadow-glow        /* lueur violette */
.hover:shadow-glow  /* lueur au survol */
.animate-fade-in    /* entrée douce des pages */
.font-display       /* polices titres */
.no-print           /* caché à l'impression */
.print-receipt      /* visible seulement à l'impression */
```

### Couleurs sémantiques à utiliser

```tsx
// Textes
className="text-primary"         // violet — chiffres importants
className="text-muted-foreground" // gris — labels secondaires
className="text-success"          // vert — succès
className="text-warning"          // ambre — points fidélité
className="text-destructive"      // rouge — erreurs/suppression

// Fonds
className="bg-secondary/40"       // fond léger card interne
className="bg-warning/10"         // fond très léger alerte
```

---

## Composants shadcn/ui utilisés

Importés depuis `@/components/ui/` :

| Composant | Import | Usage typique |
|---|---|---|
| `Card` | `@/components/ui/card` | Conteneurs principaux |
| `Button` | `@/components/ui/button` | Actions (variant: `outline`, `ghost`, `destructive`) |
| `Input` | `@/components/ui/input` | Saisies (className `h-7 w-24 font-mono` pour les inputs POS) |
| `Badge` | `@/components/ui/badge` | Statuts, compteurs |
| `Dialog` / `DialogContent` | `@/components/ui/dialog` | Modals |
| `Select` | `@/components/ui/select` | Sélecteurs (magasin, devise, paiement) |
| `Table` | `@/components/ui/table` | Listes Sales, Stock |
| `Label` | `@/components/ui/label` | Labels de formulaires |
| `Separator` | `@/components/ui/separator` | Dividers |
| `Tabs` | `@/components/ui/tabs` | Onglets Settings |

### Icônes : Lucide React

```tsx
import { Plus, Minus, Trash2, Search, Download, Eye } from "lucide-react";
// Toujours avec className="h-4 w-4" (standard) ou "h-3.5 w-3.5" (compact)
```

---

## Money — règle absolue

**Tous les montants sont stockés en EUR (number). Jamais de conversion en store.**

```typescript
// ✅ Correct : affichage via le hook
const fmt = useFormatMoney();
<span>{fmt(product.price)}</span>                     // devise globale
<span>{fmt(sale.total, sale.currency)}</span>          // devise figée de la vente

// ✅ Non-réactif (hors composant)
import { formatMoney } from "@/lib/money";
formatMoney(amount);

// ❌ Jamais calculer la conversion soi-même
const ar = amount * rate; // ne pas faire ça dans les composants
```

Devise `"AR"` → `{fmtAr.format(Math.round(amount * rate))} Ar`
Devise `"EUR"` → `{fmtEur.format(amount)} €`

---

## Schemas Zod (`src/lib/schemas.ts`)

Miroir exact des DTOs Java. À mettre à jour **dès qu'un DTO change**.

```typescript
// Pattern pour les champs nullable Postgres
field: z.string().nullish()   // string | null | undefined — PAS .optional() seul

// Champs avec défaut backend
currency: z.enum(["AR", "EUR"]).default("AR")
seq: z.number().default(0)

// Parsing des réponses (dans syncBackend.ts)
const products = z.array(ProductSchema).parse(rawProducts);
```

---

## Patterns de pages

### Page typique (liste + filtre + action)

```tsx
export default function MaPage() {
  const { user } = useAuth();
  const fmt = useFormatMoney();
  const { items, doAction } = useData();
  const isAdmin = user?.role === "ADMIN";

  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    // filtre pur — useMemo obligatoire sur les listes
    return items.filter(…);
  }, [items, search]);

  return (
    <div className="space-y-6">
      {/* Header + actions */}
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">Titre</h1>
        {isAdmin && <Button onClick={…}>Action Admin</Button>}
      </div>

      {/* Contenu */}
      <Card className="gradient-card border-border">
        …
      </Card>
    </div>
  );
}
```

### Feedback utilisateur

```typescript
toast.success("Action réussie");    // via sonner
toast.error("Message d'erreur");

// Après une action sur store :
const res = useData.getState().addProduct(…);
if (!res.ok) { toast.error(res.error ?? "Erreur"); return; }
toast.success("Produit ajouté");
```

---

## Routing et protection

```tsx
// App.tsx — toutes les pages protégées
<Route element={<AppLayout />}>
  <Route path="/pos" element={<POS />} />                                    // EMPLOYEE + ADMIN
  <Route path="/users" element={<RequireRole role="ADMIN"><Users /></RequireRole>} />  // ADMIN only
</Route>

// RequireRole — dans AppLayout.tsx
export function RequireRole({ role, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to="/" replace />;
  return <>{children}</>;
}
```

---

## SSE et hydratation

```typescript
// IMPORTANT : startSse() est appelé à la FIN de hydrateFromBackend() réussie,
// pas directement au login. SSE ne démarre qu'après que les stores sont peuplés.

// Guard anti-concurrence dans syncBackend.ts :
let _hydrating = false;
let _needsRehydrate = false;
// Si SSE déclenche une hydratation pendant qu'une est en cours → _needsRehydrate = true
// → relancée 100ms après la fin de la première (jamais deux en parallèle)

// hydrateFromBackend() fetch en parallèle : stores, products, sales, customers, settings
// + users si ADMIN (non-bloquant : erreur sur /api/users n'interrompt pas le reste)
// Puis setState() sur chaque store Zustand
```

---

## Outbox (offline)

```typescript
// outbox.ts — file FIFO, max 500 entrées
outbox.enqueue({ path, method, body, ref });

// Dédoublonnage : PUT et DELETE sur la même `ref` → le dernier remplace
// POST : jamais dédupliqué (chaque vente est distincte)

// Flush au retour du réseau (dans backend.ts > pulse())
const { sent, failed } = await flushOutbox();
```

---

## Bus d'événements DOM

Communication inter-modules sans prop drilling ni React context :

```typescript
// Émettre
window.dispatchEvent(new CustomEvent("auth:session-expired"));
window.dispatchEvent(new CustomEvent("outbox:change"));
window.dispatchEvent(new CustomEvent("api-url:change"));

// Écouter (pattern dans backend.ts et AppLayout.tsx)
window.addEventListener("auth:session-expired", handler);
// Toujours retirer avec removeEventListener dans le cleanup
```

| Événement | Émetteur | Récepteur | Effet |
|---|---|---|---|
| `auth:session-expired` | `apiClient.ts` (401) | `AppLayout.tsx` | Logout + redirect `/login` sans reload |
| `outbox:change` | `outbox.ts` | `backend.ts` | Rafraîchit `pendingCount` |
| `api-url:change` | `Settings.tsx` | `backend.ts` | Coupe SSE + reconnecte sur nouvelle URL |

En plus : `visibilitychange` (natif browser) capturé par `backend.ts` pour re-pulser en sortie de veille.

---

## Tokens JWT — comportement client

```typescript
// tokenStore.get() dans apiClient.ts vérifie l'expiration AVANT chaque requête
// → décode le payload JWT (base64url) et compare exp * 1000 avec Date.now()
// → si expiré : supprime de localStorage et retourne null (pas d'attente 401)
// → si payload illisible : ne supprime PAS (laisse le backend valider)
```

---

## DEV vs production — seeds

```typescript
// auth.ts — 3 utilisateurs seed uniquement en DEV (import.meta.env.DEV)
// En production : liste vide → hydrateFromBackend() peuple depuis Postgres
// onRehydrateStorage() (hash des passwords seed) aussi DEV-only
```

---

## Conventions de nommage

| Type | Convention | Exemple |
|---|---|---|
| Composants | PascalCase | `CustomerPicker`, `ConfirmDialog` |
| Hooks | `useXxx` camelCase | `useFormatMoney`, `useDebouncedValue` |
| Stores | `useXxx` | `useAuth`, `useData`, `useSettings` |
| Fichiers pages | PascalCase | `POS.tsx`, `Sales.tsx` |
| Fichiers libs | camelCase | `apiClient.ts`, `syncBackend.ts` |
| IDs client | `{prefix}${Date.now()}-${random}` | `p1234567-ab3c` |
| Clés localStorage | `kidzpos-*` | `kidzpos-data`, `kidzpos-auth` |
