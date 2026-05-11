package com.kidzpos.web;

import com.kidzpos.domain.Product;
import com.kidzpos.dto.Dtos.ProductReq;
import com.kidzpos.events.EventBus;
import com.kidzpos.repo.ProductRepository;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;

@RestController
@RequestMapping("/api/products")
public class ProductController {
    private final ProductRepository repo;
    private final EventBus bus;
    public ProductController(ProductRepository repo, EventBus bus) { this.repo = repo; this.bus = bus; }

    @GetMapping
    public List<Product> list(@RequestParam(required = false) String storeId) {
        return storeId == null ? repo.findAll() : repo.findByStoreId(storeId);
    }

    @PostMapping
    public ResponseEntity<?> create(@Valid @RequestBody ProductReq r) {
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
    public ResponseEntity<?> update(@PathVariable String id, @Valid @RequestBody ProductReq r) {
        var p = repo.findById(id).orElse(null);
        if (p == null) return ResponseEntity.notFound().build();
        if (!p.getSku().equalsIgnoreCase(r.sku())) {
            var conflict = repo.findByStoreIdAndSkuIgnoreCase(r.storeId(), r.sku());
            if (conflict.isPresent() && !conflict.get().getId().equals(id)) {
                return ResponseEntity.badRequest().body(java.util.Map.of("error", "SKU déjà utilisé"));
            }
        }
        p.setName(r.name()); p.setPrice(r.price()); p.setStock(r.stock());
        p.setStoreId(r.storeId()); p.setCategory(r.category()); p.setSku(r.sku());
        var saved = repo.save(p);
        bus.publish("product", "updated", saved);
        return ResponseEntity.ok(saved);
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
