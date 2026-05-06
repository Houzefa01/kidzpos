package com.kidzpos.web;

import com.kidzpos.domain.*;
import com.kidzpos.dto.Dtos.*;
import com.kidzpos.repo.*;
import com.kidzpos.security.JwtAuthFilter.AuthPrincipal;
import jakarta.validation.Valid;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.*;
import java.util.UUID;

@RestController
@RequestMapping("/api/sales")
public class SaleController {

    /** Retry sur collision uk_sale_store_seq (concurrence checkout/refund parallèle). */
    private static final int SEQ_RETRY_MAX = 5;

    private final SaleRepository sales;
    private final ProductRepository products;
    private final CustomerRepository customers;
    private final SettingsRepository settingsRepo;
    private final StockMovementRepository moves;
    private final com.kidzpos.events.EventBus bus;
    private final TransactionTemplate tx;

    public SaleController(SaleRepository sales, ProductRepository products,
                          CustomerRepository customers, SettingsRepository settingsRepo,
                          StockMovementRepository moves, com.kidzpos.events.EventBus bus,
                          PlatformTransactionManager txm) {
        this.sales = sales; this.products = products;
        this.customers = customers; this.settingsRepo = settingsRepo;
        this.moves = moves; this.bus = bus;
        this.tx = new TransactionTemplate(txm);
    }

    @GetMapping
    public List<Sale> list(@RequestParam(required = false) String storeId) {
        return storeId == null ? sales.findAllByOrderByDateDesc() : sales.findByStoreIdOrderByDateDesc(storeId);
    }

    @GetMapping("/{id}")
    public ResponseEntity<Sale> get(@PathVariable String id) {
        return sales.findById(id).map(ResponseEntity::ok).orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/checkout")
    public ResponseEntity<?> checkout(@Valid @RequestBody CheckoutReq req, Authentication auth) {
        AuthPrincipal me = (AuthPrincipal) auth.getPrincipal();
        return runWithSeqRetry(() -> tx.execute(status -> doCheckout(req, me)));
    }

    private ResponseEntity<?> doCheckout(CheckoutReq req, AuthPrincipal me) {
        Settings s = settingsRepo.findById(1L).orElseThrow();

        // Charger produits + valider stock
        Map<String, Product> prodMap = new HashMap<>();
        for (var it : req.items()) {
            var p = products.findById(it.productId()).orElse(null);
            if (p == null) return ResponseEntity.badRequest().body(Map.of("error", "Produit introuvable: " + it.productId()));
            if (p.getStock() < it.quantity()) return ResponseEntity.badRequest().body(Map.of("error", "Stock insuffisant: " + p.getName()));
            prodMap.put(p.getId(), p);
        }

        // Calculs
        double subtotal = 0;
        List<SaleItem> items = new ArrayList<>();
        for (var it : req.items()) {
            Product p = prodMap.get(it.productId());
            subtotal += p.getPrice() * it.quantity();
            items.add(SaleItem.builder()
                    .productId(p.getId()).name(p.getName())
                    .quantity(it.quantity()).price(p.getPrice())
                    .build());
        }

        double discount = req.discount();
        if (!"ADMIN".equals(me.role())) {
            double maxDiscount = subtotal * s.getMaxDiscountPercent() / 100.0;
            if (discount > maxDiscount) {
                return ResponseEntity.status(403).body(Map.of("error", "Remise dépasse plafond employé"));
            }
        }

        // B5 : redeem possible uniquement si client identifié + points effectivement détenus
        if (req.pointsRedeemed() > 0) {
            if (req.customerId() == null) {
                return ResponseEntity.badRequest().body(Map.of("error", "Client requis pour utiliser des points"));
            }
            var c = customers.findById(req.customerId()).orElse(null);
            if (c == null) {
                return ResponseEntity.badRequest().body(Map.of("error", "Client introuvable"));
            }
            if (req.pointsRedeemed() > c.getPoints()) {
                return ResponseEntity.badRequest().body(Map.of("error", "Points insuffisants"));
            }
        }

        double pointsValue = req.pointsRedeemed() * s.getEuroPerPoint();
        double afterDiscount = Math.max(0, subtotal - discount - pointsValue);
        double tax = afterDiscount * s.getTaxRate() / 100.0;
        double total = afterDiscount + tax;
        int pointsEarned = (int) Math.floor(total * s.getPointsPerEuro());

        long seq = sales.findMaxSeqByStoreId(req.storeId()).orElse(0L) + 1;
        String saleId = "sale-" + UUID.randomUUID();

        Sale sale = Sale.builder()
                .id(saleId).seq(seq)
                .storeId(req.storeId())
                .userId(me.id()).userName(me.email())
                .subtotal(round(subtotal)).tax(round(tax)).taxRate(s.getTaxRate())
                .discount(round(discount)).total(round(total))
                .date(Instant.now())
                .customerId(req.customerId()).customerName(null)
                .pointsEarned(pointsEarned).pointsRedeemed(req.pointsRedeemed())
                .paymentMode(req.paymentMode())
                .amountPaid(req.amountPaid())
                .change(req.amountPaid() == null ? null : round(req.amountPaid() - total))
                .build();

        for (var i : items) { i.setSale(sale); sale.getItems().add(i); }

        // Décrémente stock atomiquement (B6) + journal
        for (var it : req.items()) {
            Product p = prodMap.get(it.productId());
            int updated = products.decrementStockIfAvailable(p.getId(), it.quantity());
            if (updated == 0) {
                return ResponseEntity.badRequest().body(Map.of("error", "Stock insuffisant (concurrence): " + p.getName()));
            }
            p.setStock(p.getStock() - it.quantity()); // sync l'objet en mémoire pour la réponse JSON
            moves.save(StockMovement.builder()
                    .productId(p.getId()).storeId(p.getStoreId())
                    .type(MovementType.SALE).quantity(-it.quantity())
                    .date(Instant.now()).userId(me.id())
                    .relatedSaleId(saleId).build());
        }

        // Client / fidélité
        if (req.customerId() != null) {
            customers.findById(req.customerId()).ifPresent(c -> {
                c.setPoints(Math.max(0, c.getPoints() + pointsEarned - req.pointsRedeemed()));
                c.setTotalSpent(round(c.getTotalSpent() + total));
                c.setVisits(c.getVisits() + 1);
                if (c.getName() != null) sale.setCustomerName(c.getName());
                customers.save(c);
            });
        }

        // saveAndFlush : déclenche la contrainte uk_sale_store_seq dans cette transaction
        // (sans flush, l'erreur surviendrait au commit, hors du try/catch du retry).
        var saved = sales.saveAndFlush(sale);
        bus.publish("sale", "created", saved);
        bus.publish("product", "bulkUpdated", null);
        return ResponseEntity.ok(saved);
    }

    @PostMapping("/refund")
    public ResponseEntity<?> refund(@Valid @RequestBody RefundReq req, Authentication auth) {
        AuthPrincipal me = (AuthPrincipal) auth.getPrincipal();
        if (!"ADMIN".equals(me.role())) return ResponseEntity.status(403).body(Map.of("error", "Admin requis"));
        return runWithSeqRetry(() -> tx.execute(status -> doRefund(req, me)));
    }

    private ResponseEntity<?> doRefund(RefundReq req, AuthPrincipal me) {
        var orig = sales.findById(req.saleId()).orElse(null);
        if (orig == null) return ResponseEntity.notFound().build();
        // I5 : refund idempotent — bloquer double-remboursement et refund-d'un-refund
        if (orig.getRefundedFrom() != null) {
            return ResponseEntity.badRequest().body(Map.of("error", "Une vente d'avoir ne peut être remboursée"));
        }
        if (sales.existsByRefundedFrom(orig.getId())) {
            return ResponseEntity.badRequest().body(Map.of("error", "Vente déjà remboursée"));
        }

        long seq = sales.findMaxSeqByStoreId(orig.getStoreId()).orElse(0L) + 1;
        String id = "ref-" + UUID.randomUUID();
        Sale refund = Sale.builder()
                .id(id).seq(seq).storeId(orig.getStoreId())
                .userId(me.id()).userName(me.email())
                .subtotal(-orig.getSubtotal()).tax(-orig.getTax()).taxRate(orig.getTaxRate())
                .discount(-orig.getDiscount()).total(-orig.getTotal())
                .date(Instant.now())
                .pointsEarned(0).pointsRedeemed(0)
                .paymentMode(orig.getPaymentMode())
                .refundedFrom(orig.getId())
                .build();

        for (var i : orig.getItems()) {
            var ri = SaleItem.builder()
                    .productId(i.getProductId()).name(i.getName())
                    .quantity(-i.getQuantity()).price(i.getPrice())
                    .sale(refund).build();
            refund.getItems().add(ri);
            products.findById(i.getProductId()).ifPresent(p -> {
                p.setStock(p.getStock() + i.getQuantity());
                products.save(p);
                moves.save(StockMovement.builder()
                        .productId(p.getId()).storeId(p.getStoreId())
                        .type(MovementType.REFUND).quantity(i.getQuantity())
                        .date(Instant.now()).userId(me.id())
                        .relatedSaleId(id).build());
            });
        }
        var saved = sales.saveAndFlush(refund);
        bus.publish("sale", "refunded", saved);
        bus.publish("product", "bulkUpdated", null);
        return ResponseEntity.ok(saved);
    }

    /**
     * Exécute une opération retournant ResponseEntity, avec retry sur DataIntegrityViolationException
     * (typiquement collision uk_sale_store_seq sous concurrence).
     */
    private ResponseEntity<?> runWithSeqRetry(java.util.function.Supplier<ResponseEntity<?>> op) {
        for (int attempt = 0; attempt < SEQ_RETRY_MAX; attempt++) {
            try {
                return op.get();
            } catch (DataIntegrityViolationException e) {
                if (attempt == SEQ_RETRY_MAX - 1) {
                    return ResponseEntity.status(409).body(Map.of("error", "Conflit numérotation, réessayez"));
                }
                // retry : la prochaine itération relit MAX(seq) dans une nouvelle transaction
            }
        }
        return ResponseEntity.status(409).body(Map.of("error", "Conflit numérotation"));
    }

    private static double round(double v) { return Math.round(v * 100.0) / 100.0; }
}
