# AUDIT_FIXES.md — Suivi des corrections

Référence : audit complet de la session (6 phases, 22 items + 4 reportés).
Convention : `[ ]` à faire · `[x]` fait + commit hash.

## Phase 1 — Backend : sécurité & intégrité données (14 items) — ✅ TERMINÉE

- [x] **1.1** B1 🔴 SQLite `ddl-auto: create` → `update` — `6468564`
- [x] **1.2** B2 🔴 Migration Flyway V1 : schéma complet — `325dacf`
- [x] **1.3** B3 🔴 `Sale.seq` unique constraint + retry — `60e73d8`
- [x] **1.4** B5 🔴 `pointsRedeemed @PositiveOrZero` + plafond — `848ecaf`
- [x] **1.5** B6 🔴 Stock concurrent atomique — `1c9c602`
- [x] **1.6** I3 🟠 DELETE customers/products + PUT/DELETE stores ADMIN-only — `0d0108c`
- [x] **1.7** I4 🟠 `CustomerController` `@Valid` — `89b0be0`
- [x] **1.8** I5 🟠 Refund idempotent — `b783032`
- [x] **1.9** I9 🟠 CORS HTTPS par défaut — `5670a12`
- [x] **1.10** M1 🟡 `JwtAuthFilter` log debug — `1417509`
- [x] **1.11** M2 🟡 `DataInitializer` ne log pas les passwords — `730a1b1`
- [x] **1.12** M4 🟡 `/api/exchange/**` authenticated — `cf3f7df`
- [x] **1.13** M8 🟡 `SettingsReq` borné `<= 100` — `5b7eb30`
- [x] **1.14** M10 🟡 `@AuthenticationPrincipal` partout — `1e57bd1`

**Validation** : `mvn -DskipTests clean compile` ⇒ BUILD SUCCESS (36 sources, 0 warning).
`mvn test` ⇒ BUILD SUCCESS (no tests, suite vide existante).

## Phase 2 — Backend : API & contrats (5 items) — ✅ TERMINÉE

- [x] **2.1** B4 🔴 `Sale.items` LAZY + `@EntityGraph` — `d3a56b8`
- [x] **2.2** I1 🟠 `@RestControllerAdvice` global — `a6b90e8`
- [x] **2.3** I2 🟠 `AuthPrincipal.name` + Sale.userName — `963db45`
- [x] **2.4** I8-BE 🟠 `CheckoutReq.clientSaleId` + idempotence — `8915318`
- [x] **2.5** I7-BE 🟠 URL `open.er-api.com` — `611e709`

**Validation** : `mvn -DskipTests clean compile` ⇒ BUILD SUCCESS (37 sources, 0 warning).

## Phase 3 — Frontend : couche réseau (2 items) — ✅ TERMINÉE

- [x] **3.1** I6 🟠 Outbox dédoublonnage + plafond — `0a94d9e`
- [x] **3.2** M7 🟡 Pas de password clair en outbox — `2df133b`

**Validation** :
- `tsc --noEmit -p tsconfig.app.json` ⇒ 12 erreurs **toutes pré-existantes** (vérifié contre snapshot `afffda6`). Aucune erreur nouvelle. Détails dans TODO_FUTURE.md.
- `npm run build` ⇒ ✅ built in 2.80s, dist/ OK.
- `npm run lint` ⇒ 0 errors, 7 warnings pré-existantes (react-refresh sur composants ui/).

## Phase 4 — Frontend : stores Zustand (1 item) — ✅ TERMINÉE

- [x] **4.1** I8-FE 🟠 `clientSaleId` dans payload checkout — `f3704e2`

**Validation** : `tsc --noEmit` ⇒ 12 erreurs pré-existantes (0 régression). `npm run build` ⇒ ✅ built in 2.23s.

## Phase 5 — Frontend : UI & UX (2 items) — ✅ TERMINÉE

- [x] **5.1** I7-FE 🟠 URL `open.er-api.com` — `4acd1fb`
- [x] **5.2** M6 🟡 `useFormatMoney` sans rerender redondant — `bdb1853`

**Validation** : tsc 12 erreurs pré-existantes (0 régression), `npm run build` ✅ 2.15s, `npm run lint` ✅ 0 errors.

## Phase 5 bonus — résolution de la dette tsc pré-existante (3 items, 12 erreurs) — ✅ TERMINÉE

- [x] **5b.1** TS6133 — imports/params non utilisés (calendar.tsx, Dashboard.tsx, POS.tsx) — `30c6a7b`
- [x] **5b.2** TS2322 recharts — Tooltip `formatter` accepte `ValueType` (Dashboard.tsx) — `418c3bf`
- [x] **5b.3** TS2345/TS2322 auth.ts — gestion `string | null` de `hashPassword` — `eea1737`

**Validation finale** :
- `tsc --noEmit -p tsconfig.app.json` ⇒ ✅ **0 erreurs** (12 → 0)
- `npm run build` ⇒ ✅ built in 2.31s
- `npm run lint` ⇒ ✅ 0 errors, 7 warnings react-refresh pré-existantes (composants ui/ non modifiés)

## Phase 6 — Tests E2E — ✅ TERMINÉE

Backend SQLite démarré sur `/tmp/kidzpos-e2e.db` (DB volatile, isolée).
Tous les scénarios joués via curl ; SSE testé en background avec `curl -N`.

- [x] **6.1** Login admin + employé : ✅ token JWT, role/storeId corrects, 401 bad pwd, 403 no token
- [x] **6.2** Création produit → SSE : ✅ event `change {entity:product, action:created}` reçu
- [x] **6.3** Idempotence checkout (I8 bouclé) + B6 stock atomique : ✅ même `clientSaleId` ⇒ même vente, stock 10→8 sans double-décrément
- [x] **6.4** Devise Ar/EUR : ✅ default 4900, refresh online → live 4839.6 (open.er-api.com), 403 sans auth (M4)
- [x] **6.5** Refund admin only + idempotent : ✅ 403 employee, 200 admin, stock réintégré, double-refund 400, refund-of-refund 400
- [x] **6.6** SSE multi-mutation : ✅ events sur Customer/Product/Settings/Stock + ping heartbeat
- [x] **6.7** Stock concurrent (B6) + seq race (B3) : ✅ 8 checkouts // sur stock=3 → exactement 3 succès, seq distincts (3,4,5), stock=0
- [x] **6.8** Validations DTO + ACL : ✅ @PositiveOrZero, @DecimalMax, @Valid Customer, ACL admin-only, format `{error: "..."}` partout (I1)

## Items reportés (voir `TODO_FUTURE.md`)

- M3 — Rate limiting backend `/api/auth/login`
- M5 — Auth SSE pour exposition Internet
- M9 — Vite dev port collision avec backend
- Section 4 de l'audit (perf, DX, observabilité, sécurité avancée, métier)
