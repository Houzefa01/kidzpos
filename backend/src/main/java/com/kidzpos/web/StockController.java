package com.kidzpos.web;

import com.kidzpos.domain.MovementType;
import com.kidzpos.domain.StockMovement;
import com.kidzpos.dto.Dtos.*;
import com.kidzpos.events.EventBus;
import com.kidzpos.repo.ProductRepository;
import com.kidzpos.repo.StockMovementRepository;
import com.kidzpos.security.JwtAuthFilter.AuthPrincipal;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/stock")
public class StockController {

    private final ProductRepository products;
    private final StockMovementRepository moves;
    private final EventBus bus;

    public StockController(ProductRepository products, StockMovementRepository moves, EventBus bus) {
        this.products = products; this.moves = moves; this.bus = bus;
    }

    @GetMapping("/movements")
    public List<StockMovement> movements(@RequestParam(required = false) String storeId) {
        return storeId == null ? moves.findAllByOrderByDateDesc() : moves.findByStoreIdOrderByDateDesc(storeId);
    }

    @PostMapping("/adjust")
    @Transactional
    public ResponseEntity<?> adjust(@Valid @RequestBody StockAdjustReq r, Authentication auth) {
        AuthPrincipal me = (AuthPrincipal) auth.getPrincipal();
        var p = products.findById(r.productId()).orElse(null);
        if (p == null) return ResponseEntity.notFound().build();
        int newStock = p.getStock() + r.delta();
        if (newStock < 0) return ResponseEntity.badRequest().body(Map.of("error", "Stock négatif"));
        p.setStock(newStock); products.save(p);
        moves.save(StockMovement.builder()
                .productId(p.getId()).storeId(p.getStoreId())
                .type(r.delta() >= 0 ? MovementType.IN : MovementType.OUT)
                .quantity(r.delta()).date(Instant.now())
                .userId(me.id()).reason(r.reason()).build());
        bus.publish("product", "updated", p);
        bus.publish("stock", "moved", Map.of("productId", p.getId()));
        return ResponseEntity.ok(p);
    }

    @PostMapping("/transfer")
    @Transactional
    public ResponseEntity<?> transfer(@Valid @RequestBody TransferReq r, Authentication auth) {
        AuthPrincipal me = (AuthPrincipal) auth.getPrincipal();
        if (!"ADMIN".equals(me.role())) return ResponseEntity.status(403).body(Map.of("error", "Admin requis"));
        var src = products.findById(r.productId()).orElse(null);
        if (src == null) return ResponseEntity.notFound().build();
        if (src.getStock() < r.quantity()) return ResponseEntity.badRequest().body(Map.of("error", "Stock insuffisant"));

        var target = products.findByStoreIdAndSkuIgnoreCase(r.targetStoreId(), src.getSku()).orElseGet(() -> {
            var n = com.kidzpos.domain.Product.builder()
                    .id("p" + System.currentTimeMillis())
                    .name(src.getName()).price(src.getPrice()).stock(0)
                    .storeId(r.targetStoreId()).category(src.getCategory()).sku(src.getSku())
                    .createdAt(Instant.now()).build();
            return products.save(n);
        });

        src.setStock(src.getStock() - r.quantity());
        target.setStock(target.getStock() + r.quantity());
        products.save(src); products.save(target);

        moves.save(StockMovement.builder()
                .productId(src.getId()).storeId(src.getStoreId())
                .type(MovementType.TRANSFER).quantity(-r.quantity())
                .date(Instant.now()).userId(me.id())
                .targetStoreId(r.targetStoreId()).build());
        moves.save(StockMovement.builder()
                .productId(target.getId()).storeId(target.getStoreId())
                .type(MovementType.TRANSFER).quantity(r.quantity())
                .date(Instant.now()).userId(me.id())
                .targetStoreId(src.getStoreId()).build());

        bus.publish("product", "bulkUpdated", null);
        bus.publish("stock", "transferred", Map.of("from", src.getId(), "to", target.getId()));
        return ResponseEntity.ok(Map.of("source", src, "target", target));
    }
}
