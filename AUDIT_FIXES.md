# AUDIT_FIXES.md — Suivi des corrections

Référence : audit complet de la session (6 phases, 22 items + 4 reportés).
Convention : `[ ]` à faire · `[x]` fait + commit hash.

## Phase 1 — Backend : sécurité & intégrité données (14 items)

- [x] **1.1** B1 🔴 SQLite `ddl-auto: create` → `update` — `application.yml`
- [x] **1.2** B2 🔴 Migration Flyway V1 : schéma complet — `V1__Initial_schema.sql`
- [x] **1.3** B3 🔴 `Sale.seq` unique constraint + retry — `Sale.java`, `SaleController.java`
- [x] **1.4** B5 🔴 `pointsRedeemed @PositiveOrZero` + plafond — `Dtos.java`, `SaleController.java`
- [x] **1.5** B6 🔴 Stock concurrent atomique — `ProductRepository.java`, `SaleController.java`
- [x] **1.6** I3 🟠 DELETE customers/products + PUT/DELETE stores ADMIN-only — `SecurityConfig.java`, `CustomerController.java`
- [ ] **1.7** I4 🟠 `CustomerController` `@Valid` — `CustomerController.java`
- [ ] **1.8** I5 🟠 Refund idempotent — `SaleRepository.java`, `SaleController.java`
- [ ] **1.9** I9 🟠 CORS HTTPS par défaut — `application.yml`
- [ ] **1.10** M1 🟡 `JwtAuthFilter` log debug — `JwtAuthFilter.java`
- [ ] **1.11** M2 🟡 `DataInitializer` ne log pas les passwords — `DataInitializer.java`
- [ ] **1.12** M4 🟡 `/api/exchange/**` authenticated — `SecurityConfig.java`
- [ ] **1.13** M8 🟡 `SettingsReq` borné `<= 100` — `Dtos.java`
- [ ] **1.14** M10 🟡 `@AuthenticationPrincipal` partout — `SaleController.java`, `StockController.java`

## Phase 2 — Backend : API & contrats (5 items)

- [ ] **2.1** B4 🔴 `Sale.items` LAZY + `@EntityGraph` — `Sale.java`, `SaleRepository.java`
- [ ] **2.2** I1 🟠 `@RestControllerAdvice` global — nouveau `GlobalExceptionHandler.java`
- [ ] **2.3** I2 🟠 `AuthPrincipal.name` + Sale.userName — `JwtAuthFilter.java`, `SaleController.java`
- [ ] **2.4** I8-BE 🟠 `CheckoutReq.clientSaleId` + idempotence — `Dtos.java`, `SaleController.java`
- [ ] **2.5** I7-BE 🟠 URL `open.er-api.com` — `ExchangeController.java`

## Phase 3 — Frontend : couche réseau (2 items)

- [ ] **3.1** I6 🟠 Outbox dédoublonnage + plafond — `outbox.ts`
- [ ] **3.2** M7 🟡 Pas de password clair en outbox — `auth.ts`

## Phase 4 — Frontend : stores Zustand (1 item)

- [ ] **4.1** I8-FE 🟠 `clientSaleId` dans payload checkout — `data.ts`

## Phase 5 — Frontend : UI & UX (2 items)

- [ ] **5.1** I7-FE 🟠 URL `open.er-api.com` — `exchange.ts`
- [ ] **5.2** M6 🟡 `useFormatMoney` sans rerender redondant — `money.ts`

## Phase 6 — Tests E2E (6 scénarios)

- [ ] **6.1** Login admin + employé
- [ ] **6.2** Création produit → SSE multi-onglet
- [ ] **6.3** Vente offline → reconnexion → flush outbox
- [ ] **6.4** Devise Ar↔EUR online/offline
- [ ] **6.5** Refund admin uniquement (403 employé, double-refund bloqué)
- [ ] **6.6** Multi-poste : modif sur onglet A → MAJ sur B via SSE

## Items reportés (voir `TODO_FUTURE.md`)

- M3 — Rate limiting backend `/api/auth/login`
- M5 — Auth SSE pour exposition Internet
- M9 — Vite dev port collision avec backend
- Section 4 de l'audit (perf, DX, observabilité, sécurité avancée, métier)
