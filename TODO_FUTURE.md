# TODO_FUTURE.md — Améliorations reportées

État au 2026-05-18. Items hors-scope du plan strict mais identifiés
pendant les audits successifs. Aucun n'est bloquant.

Légende : **🟡 À faire** · **✅ Résolu** (date + référence)

---

## Sécurité

### ✅ Cross-store mutations + lectures (audit P1 + P4 — 2026-05)
`StoreAccessGuard.denyIfCrossStore(me, storeId)` appliqué uniformément :
- Mutations (5 endpoints) : `Sale.checkout/refund`, `Stock.adjust`,
  `Product.create/update`. `delete` + `Stock.transfer` restent ADMIN-only.
- Lectures (3 endpoints) : `GET /api/sales`, `/api/products`,
  `/api/stock/movements` — 403 strict pour EMPLOYEE cross-store, ADMIN
  passe partout. Frontend `syncBackend.ts` passe `?storeId=` pour EMPLOYEE.
- Couverture : `StoreAccessGuardTest` (6) + `CrossStoreReadGuardTest` (10).
- Message d'erreur 403 neutre (anti-énumération).

### ✅ Rate limiting `/api/auth/login` (M3)
`LoginRateLimitFilter` in-memory : fenêtre 5 min / 5 tentatives, seuls
les 401 consomment le quota. Mono-instance ; portage Redis nécessaire si
multi-backend.

### ✅ Rate limiting `/api/auth/refresh` (P2.2)
`RefreshRateLimitFilter` : fenêtre 1 min / 10 tentatives. Même remarque
mono-instance que login.

### ✅ Authentification SSE `/api/events/stream` (M5)
`EventTokenStore` émet un UUID single-use 60s via `POST /api/events/auth`
(auth JWT) ; `GET /api/events/stream?token=…` consomme avant d'ouvrir
l'`SseEmitter`.

### ✅ JWT fail-fast (audit P1.2 — 2026-05)
`JwtService` lève `IllegalStateException` au boot si `JWT_SECRET` vide
ou < 32 octets. Plus de défaut dans `application.yml`.

### ✅ Refresh tokens rotatifs (P2 sécurité)
V12 — `refresh_tokens` table, SHA-256 hash, rotation à chaque refresh,
revoke-all en cascade sur reuse détecté. Cleanup `@Scheduled` quotidien.

### 🟡 Headers sécurité HTTP
À ajouter via `SecurityFilterChain` :
- `Strict-Transport-Security` (HSTS) — uniquement en HTTPS prod
- `Content-Security-Policy` — restreindre les sources script/style/connect
- `X-Frame-Options: DENY` ou `frame-ancestors 'none'`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Content-Type-Options: nosniff`

Faisable en 1 PR. Calibrer la CSP en mode `Report-Only` d'abord.

### 🟡 Rate-limit multi-instance
`LoginRateLimitFilter` + `RefreshRateLimitFilter` sont in-memory.
Acceptable mono-instance LAN ; portage Redis (ou bucket4j-redis) requis
si on passe en multi-backend derrière un LB.

---

## Performance

### ✅ Pagination `GET /api/sales` (audit perf)
`SaleController.list(?page=&size=)` retourne `Page<Sale>` (PageRequest
clamp 1-500). Rétrocompat : sans `page` → liste complète. Index dédié
`idx_sales_store_date` (V10).

### ✅ Soft-delete Product (audit perf — intégrité)
`@SQLRestriction("deleted_at IS NULL")` + V4 (colonne `deleted_at` +
unique partiel `(store_id, sku) WHERE deleted_at IS NULL`). Refund
utilise `findByIdIncludingDeleted` (native bypass).

### ✅ Optimistic locking Product (V11)
`@Version` JPA → ETag/If-Match sur `GET/PUT /api/products/{id}`,
conflit = 412.

### ✅ Séparation `useSales` non persisté (audit P1.3 — 2026-05)
Extrait `sales`/`saleSeq` du store persisté `useData` pour éviter la
saturation localStorage à long terme. Migration v5→v6 + `partialize`
whitelist. Backend = source de vérité (réhydraté au boot).

### 🟡 Cache utilisateur dans `JwtAuthFilter`
Le filter relit `users.findById(...)` à chaque requête. À 100 req/s =
100 SELECT/s constants sur table users. Caffeine cache TTL ~30s +
invalidation sur event user.updated (déjà publié par `UserController`).
À déclencher si métriques DB le justifient.

### 🟡 ETag sur `GET /api/products` (collection)
Le singulier `GET /api/products/{id}` retourne déjà un ETag (V11).
La collection n'a pas de support `If-None-Match` → pas de 304 possible
sur les hydrate massifs. Calcul ETag = `max(version)` ou hash du payload.

### 🟡 Compression gzip Spring
Ajouter dans `application.yml` :
```yaml
server:
  compression:
    enabled: true
    mime-types: application/json,text/html,text/css,application/javascript
    min-response-size: 1024
```
Gain ~5-10× sur les payloads `/api/products` et `/api/sales`.

### 🟡 Numéro de ticket via table `store_seq`
Alternative au retry `MAX(seq)+1` actuel (`SaleController.runWithSeqRetry`).
Table dédiée `store_seq(store_id, next_seq)` avec `UPDATE … RETURNING`
atomique. Plus robuste à fort débit. Pas urgent (LAN, 2 caisses).

---

## DX

### ✅ Tests intégration backend TestContainers
`IntegrationTestBase` + `ConcurrentCheckoutTest`, `RefundConcurrencyTest`,
`AuthRefreshFlowTest`, `RefreshHardeningTest`, `IdempotentReplayTest`.
Couvre les invariants critiques sur checkout/refund/stock concurrents.

### ✅ Tests Vitest sur sync engine (audit DX + P3)
Couvre `apiClient`, `outbox` (via `syncService.test.ts`),
`failedReplays`, `metricsReporter`, throttle/stateMachine/backoff,
`ids`, et tests composant POS + E2E runtime golden path.

### ✅ ESLint `@typescript-eslint/no-floating-promises` (P3.1 — 2026-05)
Activé en type-aware ciblé. 24 violations corrigées via `void`.

### ✅ Helper `newId()` unifié (P2.3)
`crypto.randomUUID()` → `crypto.getRandomValues()` (16 octets) →
`Date.now()+Math.random` fallback. Élimine les collisions d'IDs en boucle
synchrone (régression `bulkImportProducts`).

### 🟡 Génération des types TS depuis les DTOs Java — **PROCHAINE PR**
Drift FE/BE silencieux possible (schemas Zod miroirs maintenus à la main
dans `src/lib/schemas.ts`). Pipeline :
1. `springdoc-openapi-starter-webmvc-ui` côté backend → expose
   `/v3/api-docs` (OpenAPI spec auto-générée depuis les controllers).
2. `openapi-typescript` côté frontend → génère `src/lib/api-types.ts`
   au build.
3. Adapter les `*Schema` Zod pour valider _en plus_ des types générés,
   ou les supprimer si on accepte le contrat TS pur.

Effort estimé : 1 PR moyenne. Vrai gain structurel (élimine une classe
entière de bugs).

### 🟡 Tests Vitest dédiés sur `money.ts`
Format/parsing AR ↔ EUR via `parseMoneyToAr`, arrondis, edge cases
(0, négatifs, NaN). Couverture indirecte uniquement aujourd'hui.

### 🟡 Test composant Sales (refund flow)
Sur le même pattern que `POS.test.tsx`. Couvre refund + assertions
state useSales/useData/customers.

---

## Observabilité

### ✅ Stack ops complète
Prometheus + Grafana + Alertmanager + bot Telegram + node-exporter +
postgres-exporter + 3 dashboards Grafana + runbooks
(`outbox_saturation.md`, `incident_backend_down.md`) + backup script.

### ✅ Métriques applicatives (BusinessMetrics + FrontendMetricsCollector)
`/actuator/prometheus` expose :
- `kidzpos.sale.seq_retry`, `kidzpos.sale.idempotent_replay`
- `kidzpos.optimistic_lock.conflict`, `kidzpos.login.rate_limited`
- `kidzpos.auth.refresh_*` (success, failure, reuse_detected, cleanup)
- `kidzpos.frontend.outbox_size`, `kidzpos.frontend.failed_replays`,
  `kidzpos.frontend.sync_latency_ms` (histogram p50/p95/p99)
- `kidzpos.frontend.replay_*` (P5 adaptive metrics)

### ✅ MDC structuré (correlationId + userId + storeId)
`CorrelationIdFilter` injecte les champs dans le MDC ; logback affiche
`[correlationId] [userId/storeId]` à chaque ligne. Grep-friendly.

### 🟡 Logs JSON (Loki / ELK)
Aujourd'hui pattern texte. Pour Loki/ELK : ajouter `logstash-logback-encoder`
et remplacer le pattern par `<encoder class="net.logstash.logback.encoder.LogstashEncoder"/>`.
Référence : commentaire en tête de `logback-spring.xml`.

### 🟡 Healthcheck enrichi
`/actuator/health` actuel = check DB basique. Enrichir avec :
- État du dernier event SSE (`bus.subscribers()` + timestamp dernier ping)
- Taille outbox côté serveur (si une telle notion est ajoutée)
- Statut Flyway (migrations appliquées vs attendues)

### 🟡 Audit log dédié
Table `audit_log` pour traçabilité forte :
- Création/suppression user
- Refund (qui, quand, montant, original sale)
- Ajustement stock (delta, raison, opérateur)
- Changement settings (diff avant/après)
- Login échoués → bonus anti-incident

Différent des access logs HTTP : sémantique métier, requêtable par auditeur
externe (fiscal, sécurité).

---

## Métier

### 🟡 Multi-store par utilisateur
Un caissier peut basculer entre plusieurs magasins assignés.
Modèle : `user_stores(user_id, store_id)` (relation N:N) + UI sélecteur
de magasin actif. Implique adaptation de `me.storeId()` → set de stores,
et propagation dans `StoreAccessGuard`.

### 🟡 Export comptable PDF mensuel par magasin
Conformité fiscale malgache. Récapitulatif ventes/TVA/modes de paiement
par mois, signé numériquement. À cadrer avec le client final.

### 🟡 Devise canonique : migrer `double` → `long` (iraimbilanja)
Aujourd'hui : `double` en Ariary (entier de fait, pas de centimes). Si
EUR devient mode de paiement réel (pas juste affichage), les `double`
EUR causeront des erreurs d'arrondi à l'accumulation. Migration vers
`long` (iraimbilanja = 1/5 Ar, mais en pratique 1 Ar suffit) ou
`BigDecimal`. Touche entité Sale/Product + frontend TS.

---

## Méta

### 🟡 Backlog historique pré-audit
`AUDIT_FIXES.md` et anciens lots de phase (M1…M9, B1…B6, I1…I8, P0…P5)
sont référencés dans les commits. Pas de consolidation centralisée :
la connaissance est dans les commit messages + CLAUDE.md. Acceptable.
