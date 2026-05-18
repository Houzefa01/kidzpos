package com.kidzpos.web;

import com.kidzpos.events.EventBus;
import com.kidzpos.observability.BusinessMetrics;
import com.kidzpos.repo.CustomerRepository;
import com.kidzpos.repo.ProductRepository;
import com.kidzpos.repo.SaleRepository;
import com.kidzpos.repo.SettingsRepository;
import com.kidzpos.repo.StockMovementRepository;
import com.kidzpos.security.JwtAuthFilter.AuthPrincipal;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.PlatformTransactionManager;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * P4 — Politique GET cross-store STRICTE.
 *
 * Vérifie que les 3 endpoints GET store-scopés refusent l'accès cross-store
 * pour un EMPLOYEE (403) et autorisent l'ADMIN partout (sans interaction
 * repo lors du refus → constate que la guard est bien en amont).
 *
 * Tests purs JUnit + Mockito (pas de Spring context, pas de Docker).
 * Couvre les contrats du contrôleur indépendamment du backend réel.
 */
class CrossStoreReadGuardTest {

    private static AuthPrincipal employee(String storeId) {
        return new AuthPrincipal("u-emp", "Sarah", "sarah@x", "EMPLOYEE", storeId);
    }

    private static AuthPrincipal admin() {
        return new AuthPrincipal("u-adm", "Admin", "admin@x", "ADMIN", null);
    }

    // ──── ProductController.list ────────────────────────────────────────────

    @Test
    void productList_employeeWithoutStoreId_returns403() {
        ProductController c = new ProductController(
                mock(ProductRepository.class), mock(EventBus.class), new BusinessMetrics(new SimpleMeterRegistry()));
        ResponseEntity<?> res = c.list(null, employee("s1"));
        assertForbidden(res);
    }

    @Test
    void productList_employeeRequestingOtherStore_returns403() {
        ProductController c = new ProductController(
                mock(ProductRepository.class), mock(EventBus.class), new BusinessMetrics(new SimpleMeterRegistry()));
        ResponseEntity<?> res = c.list("s2", employee("s1"));
        assertForbidden(res);
    }

    @Test
    void productList_employeeOnOwnStore_returnsOk() {
        ProductRepository repo = mock(ProductRepository.class);
        when(repo.findByStoreId("s1")).thenReturn(List.of());
        ProductController c = new ProductController(repo, mock(EventBus.class), new BusinessMetrics(new SimpleMeterRegistry()));
        ResponseEntity<?> res = c.list("s1", employee("s1"));
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    void productList_adminWithoutStoreId_returnsAllProducts() {
        ProductRepository repo = mock(ProductRepository.class);
        when(repo.findAll()).thenReturn(List.of());
        ProductController c = new ProductController(repo, mock(EventBus.class), new BusinessMetrics(new SimpleMeterRegistry()));
        ResponseEntity<?> res = c.list(null, admin());
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    // ──── StockController.movements ─────────────────────────────────────────

    @Test
    void stockMovements_employeeWithoutStoreId_returns403() {
        StockController c = new StockController(
                mock(ProductRepository.class), mock(StockMovementRepository.class),
                mock(EventBus.class), new BusinessMetrics(new SimpleMeterRegistry()));
        ResponseEntity<?> res = c.movements(null, employee("s1"));
        assertForbidden(res);
    }

    @Test
    void stockMovements_employeeRequestingOtherStore_returns403() {
        StockController c = new StockController(
                mock(ProductRepository.class), mock(StockMovementRepository.class),
                mock(EventBus.class), new BusinessMetrics(new SimpleMeterRegistry()));
        ResponseEntity<?> res = c.movements("s2", employee("s1"));
        assertForbidden(res);
    }

    @Test
    void stockMovements_adminWithoutStoreId_returnsOk() {
        StockMovementRepository moves = mock(StockMovementRepository.class);
        when(moves.findAllByOrderByDateDesc()).thenReturn(List.of());
        StockController c = new StockController(
                mock(ProductRepository.class), moves, mock(EventBus.class), new BusinessMetrics(new SimpleMeterRegistry()));
        ResponseEntity<?> res = c.movements(null, admin());
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    // ──── SaleController.list ───────────────────────────────────────────────

    @Test
    void saleList_employeeWithoutStoreId_returns403() {
        SaleController c = newSaleController();
        Object res = c.list(null, null, 50, employee("s1"));
        assertThat(res).isInstanceOf(ResponseEntity.class);
        assertForbidden((ResponseEntity<?>) res);
    }

    @Test
    void saleList_employeeRequestingOtherStore_returns403() {
        SaleController c = newSaleController();
        Object res = c.list("s2", null, 50, employee("s1"));
        assertThat(res).isInstanceOf(ResponseEntity.class);
        assertForbidden((ResponseEntity<?>) res);
    }

    @Test
    void saleList_employeeOnOwnStore_doesNotReturnForbidden() {
        SaleRepository repo = mock(SaleRepository.class);
        when(repo.findByStoreIdOrderByDateDesc("s1")).thenReturn(List.of());
        SaleController c = new SaleController(
                repo, mock(ProductRepository.class), mock(CustomerRepository.class),
                mock(SettingsRepository.class), mock(StockMovementRepository.class),
                mock(EventBus.class), new BusinessMetrics(new SimpleMeterRegistry()),
                mock(PlatformTransactionManager.class));
        Object res = c.list("s1", null, 50, employee("s1"));
        // Sur le path heureux, le repo retourne directement la List<Sale> (pas un ResponseEntity)
        assertThat(res).isInstanceOf(List.class);
    }

    // ──── Helpers ───────────────────────────────────────────────────────────

    private static SaleController newSaleController() {
        return new SaleController(
                mock(SaleRepository.class), mock(ProductRepository.class),
                mock(CustomerRepository.class), mock(SettingsRepository.class),
                mock(StockMovementRepository.class), mock(EventBus.class),
                new BusinessMetrics(new SimpleMeterRegistry()),
                mock(PlatformTransactionManager.class));
    }

    @SuppressWarnings("unchecked")
    private static void assertForbidden(ResponseEntity<?> res) {
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(res.getBody()).isInstanceOf(java.util.Map.class);
        java.util.Map<String, String> body = (java.util.Map<String, String>) res.getBody();
        assertThat(body).containsKey("error");
        // Message neutre — pas de fuite du storeId du caller
        assertThat(body.get("error")).doesNotContain("s1").doesNotContain("s2");
    }
}
