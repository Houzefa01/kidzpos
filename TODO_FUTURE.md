# TODO_FUTURE.md — Améliorations reportées

Items hors-scope du plan de correction strict mais identifiés pendant l'audit.
Aucun n'est bloquant pour le fonctionnement actuel.

## Sécurité — pas de bug actuel mais à durcir

### ~~M3 — Rate limiting backend sur `/api/auth/login`~~ — ✅ RÉSOLU
Filtre `LoginRateLimitFilter` (in-memory `ConcurrentHashMap<IP, Deque<timestamps>>`, fenêtre 5 min / 5 tentatives, seuls les 401 consomment le quota). Pas de nouvelle dépendance.

### ~~M5 — Authentification sur le flux SSE `/api/events/stream`~~ — ✅ RÉSOLU
`EventTokenStore` émet un UUID single-use 60s via `POST /api/events/auth` (auth JWT) ; `GET /api/events/stream?token=…` consomme avant d'ouvrir l'`SseEmitter`. Le frontend (`sse.ts`) fetch un nouveau token avant chaque connexion.

## Configuration / DX

### ~~M9 — Vite dev server sur le port 8080 (collision avec backend)~~ — ✅ RÉSOLU
`vite.config.ts > server.port` passe de `8080` à `5173` (défaut Vite).

### ~~Dette tsc pré-existante (12 erreurs `--strict` non liées à l'audit)~~ — ✅ RÉSOLU en Phase 5 bonus
Ces erreurs ont été corrigées via les commits `30c6a7b`, `418c3bf` et la fix Phase 5b.3 (cf `AUDIT_FIXES.md`).

## Performance

- Pagination sur `GET /api/sales` (`?page=&size=`) + index `(storeId, date DESC)`.
- Cache HTTP `ETag`/`If-None-Match` sur `GET /api/products`.
- Compression gzip Spring (`server.compression.enabled=true`).
- Scinder le store `useData.sales` dans un store séparé non persistant (re-hydraté à chaque login) pour limiter le payload localStorage.

## DX

- Tests d'intégration backend (TestContainers Postgres) sur checkout/refund/concurrent stock.
- Tests Vitest sur `outbox`, `money`, `apiClient`.
- ESLint rule `@typescript-eslint/no-floating-promises`.
- Génération des types TS depuis les DTO Java (springdoc-openapi + openapi-generator) pour éliminer la dérive FE/BE.

## Observabilité

- Logs structurés JSON (`logback-spring.xml` + `LogstashEncoder`).
- Métriques Micrometer + endpoint `/actuator/prometheus`.
- Healthcheck enrichi : DB, dernier event SSE, taille outbox côté serveur.
- Audit log dédié (`audit_log` table) pour : création/suppression user, refund, ajustement stock, changement settings.

## Sécurité avancée

- Refresh token + access token court (15 min).
- HSTS + CSP + X-Frame-Options via `SecurityFilterChain`.

## Métier

- Numéro de ticket via table `store_seq` dédiée (`UPDATE … RETURNING`) — alternative plus robuste que le retry sur `MAX(seq)+1` (déjà appliqué en Phase 1.3).
- ~~Soft-delete `Product`~~ — ✅ RÉSOLU. `@SQLRestriction("deleted_at IS NULL")` + V4 (colonne `deleted_at`, unique partiel `(store_id, sku) WHERE deleted_at IS NULL`). Refund utilise `findByIdIncludingDeleted` (native bypass).
- Multi-store par utilisateur (un caissier peut basculer).
- Export comptable PDF mensuel par magasin (conformité fiscale malgache).
