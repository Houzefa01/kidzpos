package com.kidzpos.web;

import com.kidzpos.domain.Customer;
import com.kidzpos.dto.Dtos.CustomerReq;
import com.kidzpos.events.EventBus;
import com.kidzpos.repo.CustomerRepository;
import com.kidzpos.security.JwtAuthFilter.AuthPrincipal;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/customers")
public class CustomerController {
    private final CustomerRepository repo;
    private final EventBus bus;
    public CustomerController(CustomerRepository repo, EventBus bus) { this.repo = repo; this.bus = bus; }

    @GetMapping public List<Customer> list() { return repo.findAll(); }

    @PostMapping
    public ResponseEntity<?> create(@Valid @RequestBody CustomerReq r) {
        // I4 : un client doit avoir au moins un nom OU un téléphone (validation métier).
        if (isBlank(r.name()) && isBlank(r.phone())) {
            return ResponseEntity.badRequest().body(Map.of("error", "Nom ou téléphone requis"));
        }
        var c = repo.save(Customer.builder()
                .id(r.id() != null ? r.id() : "c" + System.currentTimeMillis())
                .name(r.name()).phone(r.phone()).email(r.email())
                .points(r.points() == null ? 0 : r.points())
                .totalSpent(0).visits(0)
                .createdAt(Instant.now())
                .build());
        bus.publish("customer", "created", c);
        return ResponseEntity.ok(c);
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> update(@PathVariable String id, @Valid @RequestBody CustomerReq r,
                                    @AuthenticationPrincipal AuthPrincipal me) {
        var c = repo.findById(id).orElse(null);
        if (c == null) return ResponseEntity.notFound().build();
        if (r.name() != null) c.setName(r.name());
        if (r.phone() != null) c.setPhone(r.phone());
        if (r.email() != null) c.setEmail(r.email());
        // I3 : édition des points fidélité réservée à l'admin (anti-fraude employé).
        if (r.points() != null) {
            if (!"ADMIN".equals(me.role())) {
                return ResponseEntity.status(403).body(Map.of("error", "Édition des points réservée à l'admin"));
            }
            c.setPoints(r.points());
        }
        var saved = repo.save(c);
        bus.publish("customer", "updated", saved);
        return ResponseEntity.ok(saved);
    }

    @DeleteMapping("/{id}") public void delete(@PathVariable String id) {
        repo.deleteById(id);
        bus.publish("customer", "deleted", Map.of("id", id));
    }

    private static boolean isBlank(String s) { return s == null || s.isBlank(); }
}
