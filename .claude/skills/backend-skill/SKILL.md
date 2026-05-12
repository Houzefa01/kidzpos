---
name: backend-skill
description: >
  Skill backend KidzPOS. Se déclenche sur : Spring Boot, controller Java, entité JPA,
  Flyway migration, SaleController, ProductController, AuthController, StockController,
  SettingsController, CustomerController, UserController, StoreController, ExchangeController,
  EventsController, EventBus, SSE, Dtos.java, SecurityConfig, JwtAuthFilter, JwtService,
  CorsConfig, DataInitializer, repository, PostgreSQL, application.yml, pom.xml,
  endpoint API, auth JWT, BCrypt, validation Bean, outbox replay, checkout, refund,
  stock adjustment, transfer, CORS, actuator health, AuthPrincipal, storeId.
---

# Skill Backend — KidzPOS

## Contexte applicatif

Spring Boot 3.3.4 / Java 17. API REST + SSE, stateless JWT, PostgreSQL + Flyway.
Pas de service layer : la logique métier est directement dans les controllers.

---

## Structure du package `com.kidzpos`

```
config/
  CorsConfig.java          # CORS depuis ${CORS_ALLOWED_ORIGINS} — patterns LAN privés
  DataInitializer.java     # Seed DB vide au 1er boot (stores, users, settings)

domain/                    # Entités JPA (Lombok @Builder @Getter @Setter)
  Sale.java                # sale + @OneToMany items LAZY + @EntityGraph sur repo
  SaleItem.java            # @ManyToOne(sale) + @JsonBackReference
  Product.java
  Customer.java
  Store.java
  User.java
  Settings.java            # id=1L singleton
  StockMovement.java
  PaymentMode.java         # enum CASH | CARD | MIXED
  MovementType.java        # enum IN | OUT | ADJUST | TRANSFER | SALE | REFUND
  Role.java                # enum ADMIN | EMPLOYEE

dto/
  Dtos.java                # TOUS les records request/response dans un seul fichier

events/
  EventBus.java            # SSE broadcast asynchrone + heartbeat 30s

repo/                      # Interfaces Spring Data JPA
  SaleRepository.java      # findAllByOrderByDateDesc, findByStoreIdOrderByDateDesc,
                           # findMaxSeqByStoreId (→ Optional<Long>), existsByRefundedFrom
  ProductRepository.java   # decrementStockIfAvailable (UPDATE atomique),
                           # findByStoreId, findByStoreIdAndSkuIgnoreCase
  …

security/
  JwtService.java          # génération + validation JWT (JJWT 0.12.6)
  JwtAuthFilter.java       # OncePerRequestFilter → AuthPrincipal(id, name, email, role, storeId)
  SecurityConfig.java      # filterChain stateless

web/
  AuthController.java      # POST /api/auth/login → {token, user}
  SaleController.java      # GET /api/sales, POST /checkout, POST /refund
  ProductController.java   # CRUD /api/products
  StockController.java     # POST /api/stock/adjust, /transfer
  StoreController.java     # CRUD /api/stores
  CustomerController.java  # CRUD /api/customers
  UserController.java      # CRUD /api/users (POST/PUT/DELETE ADMIN only, GET authenticated)
  SettingsController.java  # GET + PUT /api/settings (PUT ADMIN only)
  ExchangeController.java  # POST /api/exchange/refresh (taux EUR→AR)
  EventsController.java    # GET /api/events/stream (SSE)
  GlobalExceptionHandler.java  # @RestControllerAdvice → {error: message} JSON
```

---

## Endpoints REST

| Méthode | Chemin | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | public | Login → JWT + user |
| GET | `/api/stores` | authenticated | Liste magasins |
| POST | `/api/stores` | ADMIN | Créer magasin |
| PUT | `/api/stores/{id}` | ADMIN | Modifier magasin |
| DELETE | `/api/stores/{id}` | ADMIN | Supprimer magasin |
| GET | `/api/products` | authenticated | Liste produits |
| POST | `/api/products` | authenticated | Créer produit |
| PUT | `/api/products/{id}` | authenticated | Modifier produit |
| DELETE | `/api/products/{id}` | ADMIN | Supprimer produit |
| GET | `/api/sales` | authenticated | Liste ventes |
| POST | `/api/sales/checkout` | authenticated | Encaissement |
| POST | `/api/sales/refund` | ADMIN | Remboursement |
| POST | `/api/stock/adjust` | authenticated | Ajustement stock |
| POST | `/api/stock/transfer` | authenticated | Transfert inter-magasins |
| GET | `/api/customers` | authenticated | Liste clients |
| POST | `/api/customers` | authenticated | Créer client |
| PUT | `/api/customers/{id}` | authenticated | Modifier client |
| DELETE | `/api/customers/{id}` | ADMIN | Supprimer client |
| GET | `/api/users` | authenticated | Liste utilisateurs (frontend ne l'appelle que si ADMIN) |
| POST | `/api/users` | ADMIN | Créer utilisateur |
| PUT | `/api/users/{id}` | ADMIN | Modifier utilisateur |
| DELETE | `/api/users/{id}` | ADMIN | Supprimer utilisateur |
| GET | `/api/settings` | authenticated | Paramètres shop |
| PUT | `/api/settings` | ADMIN | Modifier paramètres |
| POST | `/api/exchange/refresh` | authenticated | Rafraîchir taux EUR→AR |
| POST | `/api/events/auth` | authenticated | Émet un eventToken single-use 60s (M5) |
| GET | `/api/events/stream` | tokenized (M5) | SSE stream — `?token=…` consommé au handshake |
| GET | `/actuator/health` | public | Health check |

---

## Pattern controller standard

```java
@RestController
@RequestMapping("/api/resource")
public class ResourceController {

    private final ResourceRepository repo;
    private final EventBus bus;

    // Injection par constructeur — jamais @Autowired
    public ResourceController(ResourceRepository repo, EventBus bus) {
        this.repo = repo;
        this.bus = bus;
    }

    @GetMapping
    public List<Resource> list() {
        return repo.findAll();
    }

    @PostMapping
    public ResponseEntity<?> create(
            @Valid @RequestBody CreateResourceReq req,
            @AuthenticationPrincipal AuthPrincipal me) {
        // logique métier ici directement
        var entity = Resource.builder()
                .id(UUID.randomUUID().toString())
                .name(req.name())
                .build();
        var saved = repo.save(entity);
        bus.publish("resource", "created", saved);
        return ResponseEntity.ok(saved);
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> update(
            @PathVariable String id,
            @Valid @RequestBody UpdateResourceReq req,
            @AuthenticationPrincipal AuthPrincipal me) {
        return repo.findById(id)
                .map(r -> {
                    r.setName(req.name());
                    var saved = repo.save(r);
                    bus.publish("resource", "updated", saved);
                    return ResponseEntity.ok(saved);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable String id) {
        if (!repo.existsById(id)) return ResponseEntity.notFound().build();
        repo.deleteById(id);
        bus.publish("resource", "deleted", null);
        return ResponseEntity.ok().build();
    }
}
```

---

## DTOs — pattern record Java

Tous dans `Dtos.java`. Un seul fichier, pas de classes séparées.

```java
public class Dtos {

    // Requêtes
    public record CreateResourceReq(
        @NotBlank String name,
        @NotNull @Positive Double price
    ) {}

    // Réponses : les entités JPA sont sérialisées directement (Jackson)
    // Pas de DTO de réponse sauf si besoin de projection
}
```

### Contraintes Bean Validation utilisées

```java
@NotBlank       // String non vide (pas null, pas "")
@NotNull        // non null
@Positive       // > 0
@PositiveOrZero // >= 0
@Min(0) @Max(100)  // plages numériques (cf. SettingsReq.taxRate)
@Email          // format email
```

---

## Entités JPA — pattern Lombok

```java
@Entity @Table(name = "resources")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Resource {
    @Id private String id;              // VARCHAR(64), généré côté client
    @Column(nullable = false) private String name;
    private String optionalField;       // nullable sans @Column

    // Enum → STRING dans la DB
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ResourceType type;

    // Pour les relations LAZY (éviter N+1) :
    @OneToMany(mappedBy = "resource", cascade = CascadeType.ALL,
               orphanRemoval = true, fetch = FetchType.LAZY)
    @JsonManagedReference
    @Builder.Default
    private List<SubItem> items = new ArrayList<>();
}
```

### Accès à l'utilisateur courant

```java
// Dans la méthode du controller — jamais SecurityContextHolder directement
@AuthenticationPrincipal AuthPrincipal me

// AuthPrincipal record (JwtAuthFilter.java) — ordre exact des champs
public record AuthPrincipal(String id, String name, String email, String role, String storeId) {}

// Vérifier le rôle programmatiquement :
if (!"ADMIN".equals(me.role())) {
    return ResponseEntity.status(403).body(Map.of("error", "Admin requis"));
}

// me.storeId() est disponible mais peu utilisé actuellement (les contrôles storeId
// viennent du payload de la requête). Utile si on veut restreindre un employee
// à son propre magasin sans que le client envoie le storeId.
```

---

## Sécurité — SecurityConfig

### Routes publiques (actuelles)
```java
.requestMatchers("/api/auth/**", "/actuator/health", "/api/events/stream").permitAll()
// `/api/events/stream` reste permitAll côté Spring Security parce qu'EventSource
// ne peut pas porter d'header Authorization. La protection vit DANS le controller :
// EventTokenStore.consume(?token=...) avant ouverture du SseEmitter.
```

### ADMIN seulement (actuelles)
```java
POST/PUT/DELETE /api/users/**
PUT             /api/settings/**
DELETE          /api/products/**  DELETE /api/customers/**
POST/PUT/DELETE /api/stores/**
```

### Ajouter un nouvel endpoint protégé

```java
// Dans SecurityConfig.filterChain, avant .anyRequest().authenticated()
.requestMatchers(HttpMethod.POST, "/api/nouvelles-ressources/**").hasRole("ADMIN")
// NB : .hasRole("ADMIN") ajoute automatiquement le préfixe "ROLE_"
```

---

## Migrations Flyway

Fichiers dans `backend/src/main/resources/db/migration/`.

### Nommage obligatoire
`V{N}__description_avec_underscores.sql`

### Règles impératives
- `IF NOT EXISTS` partout (compatibilité `baseline-on-migrate`)
- `ALTER TABLE … ADD COLUMN IF NOT EXISTS` pour les colonnes ajoutées à une table existante
- **Jamais modifier** une migration existante (V1, V2, V3)
- Toujours créer une nouvelle migration numérotée

```sql
-- V4__add_resource_status.sql
ALTER TABLE resources ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_resources_status ON resources(status);
```

---

## PostgreSQL — conventions

- IDs : `VARCHAR(64)` — générés côté client (pattern `p${Date.now()}-${random}`)
- Montants : `DOUBLE PRECISION` — **valeurs en Ariary** (depuis V5). EUR n'existe que comme vue d'affichage frontend, jamais en base.
- Dates : `TIMESTAMP` — Java `Instant`, sérialisé ISO-8601 en JSON
- Enums : `VARCHAR(32)` avec `@Enumerated(EnumType.STRING)`
- Contraintes uniques nommées : `CONSTRAINT uk_nom UNIQUE (col1, col2)`
- Indexes nommés : `CREATE INDEX IF NOT EXISTS idx_table_col ON table(col)`

### Gotcha : enum + CHECK constraint résiduelle

Quand Hibernate crée une table avec `ddl-auto: create` (ou `update` ajoutant
la colonne) et une propriété `@Enumerated(EnumType.STRING)`, il génère
**automatiquement** un `CHECK (col IN ('VAL1', 'VAL2', …))` listant les
valeurs de l'enum à ce moment-là.

Avec `ddl-auto: validate` (notre prod actuelle), Hibernate **ne rafraîchit
plus** ce CHECK. Ajouter une valeur à l'enum côté Java → SQLState 23514
(`new row violates check constraint`) au prochain INSERT avec la nouvelle
valeur. Le retry-loop de `SaleController.runWithSeqRetry` masque l'erreur
en transformant en 409 "Conflit numérotation" — piège diagnostique.

**Recette** : pour toute extension d'enum déjà persisté, créer une migration
qui drop + recrée la CHECK avec les valeurs courantes.

```sql
-- V6__payment_mode_check_mobile_money.sql (ex réel)
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_mode_check;
ALTER TABLE sales ADD CONSTRAINT sales_payment_mode_check
    CHECK (payment_mode IN ('CASH', 'CARD', 'MIXED', 'MOBILE_MONEY'));
```

Pour identifier le nom : `SELECT conname FROM pg_constraint WHERE conrelid='ta_table'::regclass AND contype='c';`

---

## SSE — EventBus

```java
// Publier un changement après toute mutation
bus.publish("entity", "action", optionalPayload);
// → envoie { entity, action, ts } à tous les clients SSE

// Exemples d'appels existants
bus.publish("sale", "created", saved);
bus.publish("product", "bulkUpdated", null);
bus.publish("customer", "updated", saved);
```

Le payload `optionalPayload` est ignoré côté client — il re-fetch via `/api/*`.

### Handshake authentifié (M5)

`EventSource` ne peut pas envoyer de header `Authorization`, donc l'auth se fait
en deux temps :

```java
// EventTokenStore : UUID single-use, TTL 60s, in-memory ConcurrentHashMap
@PostMapping("/auth")              // auth JWT requise
public Map<String, Object> auth() { return Map.of("token", tokens.issue(), …); }

@GetMapping("/stream")             // permitAll côté Security, vérifié ici
public ResponseEntity<SseEmitter> stream(@RequestParam String token) {
    if (!tokens.consume(token)) return ResponseEntity.status(401).build();
    return ResponseEntity.ok(bus.subscribe());
}
```

Le token n'est vérifié qu'au handshake — une fois la connexion SSE ouverte, elle
n'est pas révoquée à l'expiration du token. Si on passe multi-instance backend,
remplacer le store in-memory par un JWT signé ou Redis.

---

## Soft-delete — pattern `@SQLRestriction` (Product)

Hibernate 6 (Spring Boot 3.3+) supporte `@SQLRestriction`, qui injecte un
prédicat dans **toutes** les requêtes JPQL générées (`findAll`, `findById`,
`findByStoreId`, dérivés Spring Data…) — sans toucher aux call sites.

```java
@Entity @Table(name = "products")
@SQLRestriction("deleted_at IS NULL")
public class Product {
    @Column(name = "deleted_at") private Instant deletedAt;
    // …
}
```

### Gotcha : ne s'applique qu'à JPQL, pas aux native queries

Pour les cas qui DOIVENT voir les lignes supprimées (ex : refund qui restocke
un produit retiré du catalogue), utiliser un native query explicite :

```java
@Query(value = "SELECT * FROM products WHERE id = :id", nativeQuery = true)
Optional<Product> findByIdIncludingDeleted(@Param("id") String id);
```

### Unique constraints + soft-delete

Une `UNIQUE (store_id, sku)` classique empêche de recycler un SKU après
suppression logique. Utiliser un **index partiel** PostgreSQL :

```sql
ALTER TABLE products DROP CONSTRAINT IF EXISTS uk_product_store_sku;
CREATE UNIQUE INDEX uk_product_store_sku_active
    ON products (store_id, sku) WHERE deleted_at IS NULL;
```

Et **retirer** `uniqueConstraints` de l'annotation `@Table` de l'entité (sinon
`ddl-auto: validate` ne reconnaît pas l'index partiel comme équivalent).

### Suppression dans le controller

```java
@DeleteMapping("/{id}")
public ResponseEntity<?> delete(@PathVariable String id) {
    var p = repo.findById(id).orElse(null);   // déjà filtré par @SQLRestriction
    if (p == null) return ResponseEntity.notFound().build();
    p.setDeletedAt(Instant.now());
    repo.save(p);
    bus.publish("product", "deleted", Map.of("id", id));
    return ResponseEntity.noContent().build();
}
```

---

## Filtres servlet custom — pattern OncePerRequestFilter

Deux filtres maison à ce jour : `JwtAuthFilter` (auth) et `LoginRateLimitFilter`
(rate-limit M3). Tous deux suivent le même montage :

```java
@Component
public class MyFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res,
                                    FilterChain chain) throws ServletException, IOException {
        // logique pré-chain
        chain.doFilter(req, res);
        // logique post-chain (peut lire res.getStatus())
    }
}
```

```java
// SecurityConfig — ordre dans la chaîne
.addFilterBefore(loginRateLimitFilter, JwtAuthFilter.class)
.addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class);
```

Le rate-limit est volontairement in-memory (`ConcurrentHashMap<IP, Deque<Long>>`)
— fenêtre glissante, seuls les 401 consomment le quota, IP nettoyée quand sa
queue se vide. Pas de dépendance externe ; à reprendre si on passe multi-instance.

---

## Gestion d'erreurs

### GlobalExceptionHandler

```java
@RestControllerAdvice
public class GlobalExceptionHandler {
    // Catch-all → {error: "message"} JSON
    // Les broken pipes SSE sont silencées (ClientAbortException / EofException)
}
```

### Pattern de réponse d'erreur dans les controllers

```java
// Erreur métier
return ResponseEntity.badRequest().body(Map.of("error", "Message explicite"));

// Interdit
return ResponseEntity.status(403).body(Map.of("error", "Admin requis"));

// Conflit (ex: contrainte unique)
return ResponseEntity.status(409).body(Map.of("error", "Message de conflit"));

// Not found
return ResponseEntity.notFound().build();

// Succès
return ResponseEntity.ok(entity);
```

---

## Cas particulier : SaleController

### Checkout avec retry sur contrainte `uk_sale_store_seq`

```java
// Pattern retry programmatique (concurrence parallèle)
private static final int SEQ_RETRY_MAX = 5;

private ResponseEntity<?> runWithSeqRetry(Supplier<ResponseEntity<?>> op) {
    for (int attempt = 0; attempt < SEQ_RETRY_MAX; attempt++) {
        try {
            return op.get();
        } catch (DataIntegrityViolationException e) {
            if (attempt == SEQ_RETRY_MAX - 1) {
                return ResponseEntity.status(409).body(Map.of("error", "Conflit numérotation"));
            }
        }
    }
    return ResponseEntity.status(409).body(…);
}

// TransactionTemplate programmatique (pas @Transactional) pour que le flush
// se fasse DANS la transaction et que DataIntegrityViolationException soit catchable
@PostMapping("/checkout")
public ResponseEntity<?> checkout(@Valid @RequestBody CheckoutReq req, …) {
    return runWithSeqRetry(() -> tx.execute(status -> doCheckout(req, me)));
}
```

### Idempotence checkout (I8)

```java
// Vérifier d'abord si clientSaleId déjà en base
if (req.clientSaleId() != null && !req.clientSaleId().isBlank()) {
    var existing = sales.findById(req.clientSaleId());
    if (existing.isPresent()) return ResponseEntity.ok(existing.get());
}
```

### Décrémentation stock atomique (B6)

```java
// Repository — UPDATE avec condition (évite les races conditions)
@Modifying
@Query("UPDATE Product p SET p.stock = p.stock - :qty WHERE p.id = :id AND p.stock >= :qty")
int decrementStockIfAvailable(@Param("id") String id, @Param("qty") int qty);

// Si retourne 0 → stock insuffisant concurrent
if (updated == 0) {
    return ResponseEntity.badRequest().body(Map.of("error", "Stock insuffisant (concurrence): " + p.getName()));
}
```

---

## Configuration application.yml

```yaml
kidzpos:
  jwt:
    secret: ${JWT_SECRET:change-me-in-prod-32+bytes}
    expiration-hours: 12
  cors:
    allowed-origins: ${CORS_ALLOWED_ORIGINS:http://localhost:5173,...}
  exchange:
    eur-to-ar-default: 4900    # fallback si internet indispo

spring:
  datasource:
    url: jdbc:postgresql://${DB_HOST:localhost}:${DB_PORT:5432}/${DB_NAME:kidzpos}
  jpa:
    hibernate:
      ddl-auto: validate       # Flyway gère le schema — Hibernate valide seulement
    open-in-view: false        # LAZY fetch explicite (pas de session ouverte dans la vue)
  flyway:
    baseline-on-migrate: true  # tolérer une base existante avant Flyway
```

---

## Settings — singleton id=1L

```java
// Settings est une entité singleton : une seule ligne en DB, toujours id=1L
// Pattern d'accès invariable dans tous les controllers :
Settings s = settingsRepo.findById(1L).orElseThrow();

// SettingsController.update() est la seule méthode qui utilise @Transactional déclaratif
// (exception au pattern TransactionTemplate) — pas de retry nécessaire ici.
```

---

## DataInitializer — seed au 1er boot

```java
// Déclenché seulement si stores.count() == 0 / users.count() == 0 /
// settings.count() == 0 / products.count() == 0.
// Chaque ressource est seedée indépendamment.
// Mots de passe lus depuis env vars KIDZPOS_*_PASSWORD ; sinon UUID
// affiché sur STDOUT (pas dans les logs — M2).
```

Ressources actuellement seedées :

| Resource | Quantité | Notes |
|---|---|---|
| stores | 2 (s1, s2) | Magasin A / B |
| users | 3 (admin, sarah, karim) | mots de passe via env vars |
| settings | 1 (id=1) | currency='AR', pointsPerAr=0.0002, arPerPoint=100 |
| products | 12 × 2 stores = 24 | prix Ariary réalistes (8 000 à 120 000 Ar) |

**Important** : depuis le passage à Postgres source-of-truth, DataInitializer
est la **seule** source de seed. L'ancien `buildSeedProducts` côté frontend
a été supprimé. Toute nouvelle entité avec des seeds attendus doit y être
ajoutée — sinon le frontend affiche une liste vide après chaque reset DB.

---

## Actuator

Exposé : `health`, `info` uniquement.
`show-details: never` — pas de détail DB en réponse publique.

```bash
curl http://localhost:8080/actuator/health
# → {"status":"UP"}
```

---

## Checklist pour un nouvel endpoint

1. **DTO** : ajouter le record dans `Dtos.java` avec annotations Bean Validation
2. **SecurityConfig** : déclarer le niveau d'accès (sinon `.anyRequest().authenticated()` s'applique)
3. **Controller** : `@Valid @RequestBody`, `@AuthenticationPrincipal AuthPrincipal me`
4. **bus.publish()** : notifier les clients SSE après toute mutation
5. **Flyway** : si nouveau champ DB → `V{N+1}__description.sql` avec `IF NOT EXISTS`
6. **Zod schema** : mettre à jour `src/lib/schemas.ts` côté frontend
7. **pushMutation** : câbler dans le store Zustand concerné
