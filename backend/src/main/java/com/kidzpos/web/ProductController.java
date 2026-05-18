package com.kidzpos.web;

import com.kidzpos.domain.Product;
import com.kidzpos.dto.Dtos.ProductReq;
import com.kidzpos.events.EventBus;
import com.kidzpos.observability.BusinessMetrics;
import com.kidzpos.repo.ProductRepository;
import com.kidzpos.security.JwtAuthFilter.AuthPrincipal;
import com.kidzpos.security.StoreAccessGuard;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/products")
public class ProductController {
    private final ProductRepository repo;
    private final EventBus bus;
    private final BusinessMetrics metrics;
    public ProductController(ProductRepository repo, EventBus bus, BusinessMetrics metrics) {
        this.repo = repo; this.bus = bus; this.metrics = metrics;
    }

    /**
     * P4 — Politique GET cross-store STRICTE : un EMPLOYEE sans storeId (=
     * demande "tous les magasins") ou avec un storeId ≠ son magasin → 403.
     * ADMIN passe partout. Pas de fallback silencieux.
     */
    @GetMapping
    public ResponseEntity<?> list(@RequestParam(required = false) String storeId,
                                  @AuthenticationPrincipal AuthPrincipal me) {
        var deny = StoreAccessGuard.denyIfCrossStore(me, storeId);
        if (deny != null) return deny;
        var products = storeId == null ? repo.findAll() : repo.findByStoreId(storeId);
        return ResponseEntity.ok(products);
    }

    /** Variant GET unique : retourne ETag = version pour permettre If-Match au PUT. */
    @GetMapping("/{id}")
    public ResponseEntity<Product> getOne(@PathVariable String id) {
        return repo.findById(id)
                .map(p -> ResponseEntity.ok()
                        .header(HttpHeaders.ETAG, etagOf(p))
                        .body(p))
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<?> create(@Valid @RequestBody ProductReq r, @AuthenticationPrincipal AuthPrincipal me) {
        // P1.1 (extension) : un EMPLOYEE ne peut créer un produit que dans SON magasin.
        var deny = StoreAccessGuard.denyIfCrossStore(me, r.storeId());
        if (deny != null) return deny;
        if (repo.findByStoreIdAndSkuIgnoreCase(r.storeId(), r.sku()).isPresent()) {
            return ResponseEntity.badRequest().body(java.util.Map.of("error", "SKU déjà utilisé dans ce magasin"));
        }
        var p = Product.builder()
                .id(r.id() != null ? r.id() : "p" + System.currentTimeMillis())
                .name(r.name()).price(r.price()).stock(r.stock())
                .storeId(r.storeId()).category(r.category()).sku(r.sku())
                .createdAt(Instant.now())
                .build();
        var saved = repo.save(p);
        bus.publish("product", "created", saved);
        return ResponseEntity.ok(saved);
    }

    @PutMapping("/{id}")
    @Transactional
    public ResponseEntity<?> update(@PathVariable String id, @Valid @RequestBody ProductReq r,
                                    @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch,
                                    @AuthenticationPrincipal AuthPrincipal me) {
        var p = repo.findById(id).orElse(null);
        if (p == null) return ResponseEntity.notFound().build();
        // P1.1 (extension) : double check sur le produit existant ET sur le storeId
        // demandé. Empêche (a) un EMPLOYEE de modifier un produit cross-store et
        // (b) un EMPLOYEE de déplacer un produit hors de son magasin (ou d'en
        // siphonner un en le ré-allouant à son magasin).
        var denyCurrent = StoreAccessGuard.denyIfCrossStore(me, p.getStoreId());
        if (denyCurrent != null) return denyCurrent;
        var denyTarget = StoreAccessGuard.denyIfCrossStore(me, r.storeId());
        if (denyTarget != null) return denyTarget;
        // Optimistic locking : si le client a lu un ETag (via GET /{id}) et le repasse
        // en If-Match, on rejette 412 si la version a changé entretemps. L'absence du
        // header reste tolérée pour rétrocompat avec clients qui ne lisent pas l'ETag.
        if (ifMatch != null && !ifMatch.isBlank()) {
            Integer expected = parseEtag(ifMatch);
            if (expected == null || !expected.equals(p.getVersion())) {
                metrics.optimisticLockConflict.increment();
                return ResponseEntity.status(412)
                        .body(Map.of("error", "Le produit a été modifié entretemps, rechargez"));
            }
        }
        if (!p.getSku().equalsIgnoreCase(r.sku())) {
            var conflict = repo.findByStoreIdAndSkuIgnoreCase(r.storeId(), r.sku());
            if (conflict.isPresent() && !conflict.get().getId().equals(id)) {
                return ResponseEntity.badRequest().body(Map.of("error", "SKU déjà utilisé"));
            }
        }
        p.setName(r.name()); p.setPrice(r.price()); p.setStock(r.stock());
        p.setStoreId(r.storeId()); p.setCategory(r.category()); p.setSku(r.sku());
        try {
            var saved = repo.saveAndFlush(p);  // flush pour déclencher la check @Version maintenant
            bus.publish("product", "updated", saved);
            return ResponseEntity.ok()
                    .header(HttpHeaders.ETAG, etagOf(saved))
                    .body(saved);
        } catch (ObjectOptimisticLockingFailureException e) {
            metrics.optimisticLockConflict.increment();
            return ResponseEntity.status(412)
                    .body(Map.of("error", "Le produit a été modifié entretemps, rechargez"));
        }
    }

    private static String etagOf(Product p) {
        return "\"" + p.getVersion() + "\"";
    }

    private static Integer parseEtag(String raw) {
        // Accepte "12" et W/"12"
        String s = raw.trim();
        if (s.startsWith("W/")) s = s.substring(2).trim();
        if (s.startsWith("\"") && s.endsWith("\"") && s.length() >= 2) {
            s = s.substring(1, s.length() - 1);
        }
        try { return Integer.parseInt(s); } catch (NumberFormatException e) { return null; }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable String id) {
        var p = repo.findById(id).orElse(null);
        if (p == null) return ResponseEntity.notFound().build();
        // Soft-delete : préserve l'intégrité référentielle avec sale_items.product_id
        // (pas de FK mais on garde la trace) et libère le SKU via l'index partiel.
        p.setDeletedAt(Instant.now());
        repo.save(p);
        bus.publish("product", "deleted", java.util.Map.of("id", id));
        return ResponseEntity.noContent().build();
    }
}
