# TODO_FUTURE.md — Améliorations reportées

Items hors-scope du plan de correction strict mais identifiés pendant l'audit.
Aucun n'est bloquant pour le fonctionnement actuel.

## Sécurité — pas de bug actuel mais à durcir

### M3 — Rate limiting backend sur `/api/auth/login`
**Pourquoi reporté** : nécessite ajout d'une dépendance externe (Bucket4j ou Resilience4j) ⇒ impacte l'architecture. Le front limite déjà à 5 essais/5 min, et BCrypt rend le brute-force coûteux (~100 ms par tentative).
**Solution proposée** : Bucket4j-Spring-Boot ou filtre custom in-memory `ConcurrentHashMap<IP, AttemptCounter>`.

### M5 — Authentification sur le flux SSE `/api/events/stream`
**Pourquoi reporté** : `EventSource` natif ne pose pas de header `Authorization`. Solutions possibles : token via query param (à signer/expirer), cookie HttpOnly, ou bibliothèque `event-source-polyfill`. Pas un bug en LAN privé.
**Solution proposée** : émettre un `eventToken` court (< 1 min) via `/api/events/auth` puis `?token=` sur le stream.

## Configuration / DX

### M9 — Vite dev server sur le port 8080 (collision avec backend)
**Pourquoi reporté** : config dev uniquement, ne touche pas la prod (le frontend est servi en statique en prod via Caddy/nginx).
**Solution proposée** : `vite.config.ts > server.port = 5173` (défaut Vite).

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
- Soft-delete `Product` (champ `deletedAt`) — actuellement `DELETE` casse l'historique des ventes.
- Multi-store par utilisateur (un caissier peut basculer).
- Export comptable PDF mensuel par magasin (conformité fiscale malgache).
