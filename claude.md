# CLAUDE.md — Brief projet KidzPOS

---

## 1. Vue d'ensemble

KidzPOS est un **point de vente multi-postes** pour magasins de jouets/enfants.

- **Frontend** : React 18 + Vite 5 + TypeScript + Tailwind + shadcn/ui + Zustand
- **Backend** : Spring Boot 3 (Java 17) + Spring Security (JWT) + JPA/Hibernate
- **DB prod** : PostgreSQL 16 — **DB dev/embarqué** : SQLite (profil `sqlite`)
- **Temps réel** : Server-Sent Events (`/api/events/stream`)
- **Offline** : IndexedDB local + outbox + fallback localStorage des stores Zustand

Contraintes métier :
- Doit fonctionner **en LAN sans internet** (serveur local + clients web sur le même réseau).
- Doit fonctionner **sur internet** (serveur exposé, clients distants).
- **Synchro temps réel** entre tous les postes connectés (création produit, vente, modif user → propagé via SSE).
- **Perte de connexion** = bascule auto en mode offline (lecture des stores persistés, écriture en outbox, flush au retour).
- **Devise par défaut : Ariary (AR)**. Choix possible : AR ou EUR. Conversion EUR↔AR via `open.er-api.com` (gratuit, sans clé). Si pas d'internet → message "pas d'internet" et pas de conversion.

---

## 2. Structure du repo

```
/                     → frontend React (racine Vite)
  src/
    pages/            → routes (Login, Dashboard, POS, Sales, Stock, Customers, Users, Settings)
    store/            → stores Zustand (auth, data, customers, settings, backend, exchange)
    lib/              → apiClient, apiConfig, sse, syncBackend, outbox, money, pdf, crypto
    components/       → AppLayout, AppSidebar, OfflineBanner, ui/ (shadcn)
/backend/             → Spring Boot
  src/main/java/com/kidzpos/
    KidzposApplication.java
    config/           → CorsConfig, DataInitializer (seed admin + settings)
    domain/           → entités JPA (User, Product, Sale, SaleItem, Customer, Store, Settings, StockMovement, enums)
    dto/Dtos.java     → tous les records DTO
    repo/             → Spring Data repositories
    security/         → JwtService, JwtAuthFilter, SecurityConfig
    web/              → controllers REST (Auth, User, Product, Sale, Customer, Store, Stock, Settings, Exchange, Events)
    events/EventBus.java → broadcast SSE in-memory
  src/main/resources/application.yml  → profils postgres / sqlite
```

---

## 3. Règles non négociables

### Frontend
- **Jamais de couleurs en dur** (`text-white`, `bg-black`…). Utiliser les tokens sémantiques HSL définis dans `src/index.css` et `tailwind.config.ts`.
- **Pas de fetch nu** : passer par `src/lib/apiClient.ts` (gère JWT, baseURL, timeout, détection LAN).
- **Pas de logique métier dans les composants** : tout passe par les stores Zustand ou `lib/`.
- **Stores Zustand persistés** (`persist` middleware) → c'est le cache offline.
- Toute mutation envoyée au backend doit aussi : (a) updater le store local optimistiquement, (b) être ré-hydratée via SSE/`hydrateFromBackend` après confirmation.
- L'argent côté UI passe **toujours** par `src/lib/money.ts` (formatte selon `settings.currency`).

### Backend
- **JWT obligatoire** sur tous les endpoints sauf `/api/auth/**`, `/api/events/stream`, `/actuator/health`.
- **Rôles** : `ADMIN` et `EMPLOYEE`. Les opérations sensibles (refund, suppression user, modif settings) → `ADMIN` uniquement.
- **Plafond remise employé** : contrôlé serveur dans `SaleController.checkout` via `Settings.maxDiscountPercent`.
- **Stock** : décrémenté **dans la même transaction** que la vente, avec écriture d'un `StockMovement`.
- **Toute mutation publie un event** sur `EventBus` (`bus.publish(entity, action, payload)`) pour la synchro SSE.
- **Pas de Lombok magique caché** : `@Getter @Setter @Builder` OK, mais expliciter les constructeurs si ambigu.
- Ne jamais committer le `JWT_SECRET` réel. Lecture via env var.

### Sécurité
- Rôles dans une **table dédiée** côté DB (déjà fait via `User.role` enum — acceptable car pas de RLS Postgres ici, l'autorisation est faite par `SecurityConfig` + `@PreAuthorize`/checks manuels).
- Mots de passe : BCrypt (`PasswordEncoder` configuré dans `SecurityConfig`).
- Jamais de check de rôle côté client uniquement → toujours re-vérifier serveur.

---

## 4. Commandes essentielles

### Frontend
```bash
npm install
npm run dev          # http://localhost:5173 et http://192.168.43.48:5173
npm run build
npm run lint
npx vitest run       # tests
```

### Backend
```bash
cd backend
./mvnw spring-boot:run                                # profil par défaut = postgres
SPRING_PROFILES_ACTIVE=sqlite ./mvnw spring-boot:run  # mode embarqué (fichier kidzpos.db)
./mvnw clean package                                   # → target/kidzpos-backend-*.jar
java -jar target/kidzpos-backend-*.jar
```

### Postgres local (Docker)
```bash
docker run -d --name kidzpg \
  -e POSTGRES_USER=kidzpos -e POSTGRES_PASSWORD=kidzpos -e POSTGRES_DB=kidzpos \
  -p 5432:5432 postgres:16
```

### Variables d'environnement backend
| Var | Défaut | Rôle |
|---|---|---|
| `SERVER_PORT` | 8080 | Port HTTP |
| `SPRING_PROFILES_ACTIVE` | postgres | `postgres` ou `sqlite` |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | localhost/5432/kidzpos/kidzpos/kidzpos | Postgres |
| `SQLITE_PATH` | ./kidzpos.db | Fichier SQLite |
| `JWT_SECRET` | placeholder | **À changer en prod** (≥32 chars) |
| `CORS_ALLOWED_ORIGINS` | `*` | Liste séparée par virgules en prod |

### Frontend → Backend
Configurer l'URL API dans **Settings → API URL** (stockée dans `localStorage` via `src/lib/apiConfig.ts`). Exemples :
- LAN : `http://192.168.1.10:8080`
- Internet : `https://api.mondomaine.com` a la fin

---

## 5. API REST (résumé)

| Méthode | Endpoint | Rôle | Description |
|---|---|---|---|
| POST | `/api/auth/login` | public | `{email,password}` → `{token,user}` |
| GET | `/api/events/stream` | public (SSE) | flux d'events `change` |
| GET/POST/PUT/DELETE | `/api/users` | ADMIN | CRUD utilisateurs |
| GET/POST/PUT/DELETE | `/api/products` | auth | CRUD produits |
| GET/POST/PUT/DELETE | `/api/customers` | auth | CRUD clients + fidélité |
| GET/POST/PUT/DELETE | `/api/stores` | ADMIN | CRUD magasins |
| GET | `/api/sales` | auth | liste ventes (filtre `?storeId=`) |
| POST | `/api/sales/checkout` | auth | enregistre vente + maj stock |
| POST | `/api/sales/refund` | ADMIN | remboursement |
| GET/POST | `/api/stock/movements` | auth | journal stock |
| GET/PUT | `/api/settings` | GET auth / PUT ADMIN | paramètres globaux |
| GET | `/api/exchange/eur-to-ar` | auth | dernier taux connu |
| POST | `/api/exchange/refresh` | auth | force refresh via internet |

---

## 6. Workflow attendu de Claude Code

1. **Avant toute modif** : lister les fichiers concernés, expliquer le plan, attendre validation.
2. **Toujours lancer** `npm run lint` (front) et `./mvnw -q -DskipTests package` (back) après une modif significative.
3. **Pas de refacto silencieux** : si un changement déborde du scope demandé, le proposer séparément.
4. **Synchro temps réel** : toute nouvelle mutation backend doit publier un event sur `EventBus`.
5. **Toute nouvelle entité** : créer entity + repo + DTO + controller + handler SSE + hydrate côté front.
6. **Tests** : ajouter au moins un test (vitest pour le front, JUnit pour le back) sur les chemins critiques (auth, checkout, refund, plafond remise).

---

## 7. Pièges connus

- **EventSource ne porte pas le header Authorization** → l'endpoint SSE est volontairement public et ne diffuse que des notifications "change" (pas de données sensibles).
- **SQLite + Hibernate** : utiliser le dialect community `org.hibernate.community.dialect.SQLiteDialect` (déjà configuré).
- **Sequence de vente par magasin** : `SaleController` calcule `seq` via `findByStoreIdOrderByDateDesc(storeId).size() + 1` — **ne pas remplacer par un global** sous peine de collisions multi-store.
- **Outbox** : flush déclenché par `lanReachable` qui repasse à `true` (watcher dans `src/store/backend.ts`). Ne pas flusher en parallèle deux fois.
- **CORS en prod** : remplacer `*` par la liste des origines réelles, sinon `allowCredentials=true` sera refusé par les navigateurs.

---

## 8. Définition de "fini"

Une tâche est terminée quand :
- ✅ Le code compile (front + back).
- ✅ Le lint passe sans nouvelle erreur.
- ✅ Les tests existants passent.
- ✅ Si endpoint ajouté → testé via `curl` ou test d'intégration.
- ✅ Si store/UI modifié → vérifié dans le preview.
- ✅ Si event ajouté → vérifié que la propagation SSE met bien à jour un 2e onglet.
- ✅ Aucun secret hardcodé, aucune couleur hors design system.
