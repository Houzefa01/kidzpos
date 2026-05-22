package com.kidzpos.web;

import com.kidzpos.IntegrationTestBase;
import com.kidzpos.domain.*;
import com.kidzpos.dto.Dtos.*;
import com.kidzpos.repo.*;
import com.kidzpos.security.JwtAuthFilter.AuthPrincipal;
import com.kidzpos.sync.NodeContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * V19-audit — Tests d'intégration d'isolation multi-magasin.
 *
 * Vérifie qu'un nœud configuré pour le magasin S1 ne peut :
 *   - lister, lire, modifier, supprimer aucune donnée du magasin S2
 *   - vendre, ajuster stock, ou créer client référençant un produit/client S2
 *
 * Utilise TestContainers Postgres (cf {@link IntegrationTestBase}) et override
 * le bean {@link NodeContext} pour simuler le nœud S1.
 *
 * Exécution : {@code mvn verify -pl backend}. Skippé en {@code mvn package -DskipTests}.
 */
@Import(StoreIsolationAuditTest.NodeS1Config.class)
class StoreIsolationAuditTest extends IntegrationTestBase {

    /** Override le bean NodeContext pour simuler un nœud rattaché au store "s1". */
    @TestConfiguration
    static class NodeS1Config {
        @Bean @Primary
        NodeContext testNodeContext() {
            return new NodeContext("s1");
        }
    }

    @Autowired ProductController productController;
    @Autowired SaleController saleController;
    @Autowired StockController stockController;
    @Autowired CustomerController customerController;

    @Autowired ProductRepository products;
    @Autowired SaleRepository sales;
    @Autowired StockMovementRepository moves;
    @Autowired CustomerRepository customers;
    @Autowired StoreRepository stores;
    @Autowired SettingsRepository settings;

    @BeforeEach
    void seed() {
        moves.deleteAll();
        sales.deleteAll();
        customers.deleteAll();
        products.findAll().forEach(p -> products.delete(p));
        stores.findAll().forEach(s -> stores.delete(s));
        if (settings.count() == 0) {
            settings.save(Settings.builder().id(1L)
                    .maxDiscountPercent(10).pointsPerAr(0.0002).arPerPoint(100)
                    .shopName("test").currency("AR").build());
        }
        stores.save(Store.builder().id("s1").name("S1").location("").build());
        stores.save(Store.builder().id("s2").name("S2").location("").build());

        // Produits dans les 2 magasins
        products.save(productOf("p-s1", "s1"));
        products.save(productOf("p-s2", "s2"));

        // Clients dans les 2 magasins
        customers.save(Customer.builder().id("c-s1").name("Alice (S1)").points(100)
                .totalSpent(0).visits(0).createdAt(Instant.now()).storeId("s1").build());
        customers.save(Customer.builder().id("c-s2").name("Bob (S2)").points(100)
                .totalSpent(0).visits(0).createdAt(Instant.now()).storeId("s2").build());
    }

    private static Product productOf(String id, String store) {
        return Product.builder()
                .id(id).name("Produit " + id).price(1000).stock(10)
                .storeId(store).sku("SKU-" + id)
                .createdAt(Instant.now())
                .build();
    }

    // ─── 1) LISTING : un nœud s1 ne voit JAMAIS les produits/ventes/movements de s2 ───

    @Test
    void productList_onStoreScopedNode_filtersToOwnStore() {
        authenticate("u-adm", "ADMIN", null);  // même ADMIN, ne doit pas voir s2
        ResponseEntity<?> res = productController.list(null, null, currentPrincipal());
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.OK);
        @SuppressWarnings("unchecked")
        List<Product> body = (List<Product>) res.getBody();
        assertThat(body).extracting(Product::getStoreId).containsOnly("s1");
    }

    @Test
    void productList_adminRequestingS2_silentlyForced_toS1() {
        authenticate("u-adm", "ADMIN", null);
        // Même si l'admin demande explicitement storeId=s2, enforceStoreScope force s1.
        ResponseEntity<?> res = productController.list("s2", null, currentPrincipal());
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.OK);
        @SuppressWarnings("unchecked")
        List<Product> body = (List<Product>) res.getBody();
        assertThat(body).noneMatch(p -> "s2".equals(p.getStoreId()));
    }

    // ─── 2) READ BY ID : 404 si l'entité appartient à un autre store ───

    @Test
    void productGetOne_crossStore_returns404NotForbidden() {
        authenticate("u-adm", "ADMIN", null);
        ResponseEntity<Product> res = productController.getOne("p-s2", currentPrincipal());
        // 404 (pas 403) — défense anti-énumération.
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void productGetOne_inScope_returnsProduct() {
        authenticate("u-adm", "ADMIN", null);
        ResponseEntity<Product> res = productController.getOne("p-s1", currentPrincipal());
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(res.getBody().getId()).isEqualTo("p-s1");
    }

    // ─── 3) WRITE : impossible de vendre un produit cross-store ───

    @Test
    void checkout_referencingS2Product_returnsBadRequest() {
        authenticate("u-emp", "EMPLOYEE", "s1");
        var req = new CheckoutReq(
                "s1",                                       // sale store = mon store
                "client-sale-cross",
                List.of(new SaleItemReq("p-s2", 1)),       // produit cross-store
                0.0, PaymentMode.CASH, 1000.0,
                null, 0, "AR");
        ResponseEntity<?> res = saleController.checkout(req, currentPrincipal());
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        // Le stock du produit S2 ne doit PAS avoir bougé.
        assertThat(products.findById("p-s2").orElseThrow().getStock()).isEqualTo(10);
    }

    @Test
    void checkout_redeemingPointsOfS2Customer_returnsBadRequest() {
        authenticate("u-emp", "EMPLOYEE", "s1");
        var req = new CheckoutReq(
                "s1", "client-sale-pts",
                List.of(new SaleItemReq("p-s1", 1)),
                0.0, PaymentMode.CASH, 1000.0,
                "c-s2",                                     // client cross-store
                50,                                          // tente de débiter 50 pts
                "AR");
        ResponseEntity<?> res = saleController.checkout(req, currentPrincipal());
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        // Les points du client S2 ne doivent PAS avoir été touchés.
        assertThat(customers.findById("c-s2").orElseThrow().getPoints()).isEqualTo(100);
    }

    // ─── 4) STOCK : transfer source doit appartenir au nœud ───

    @Test
    void stockTransfer_sourceProductS2_returns404() {
        authenticate("u-adm", "ADMIN", null);
        var req = new TransferReq("p-s2", "s1", 1, "client-mv-1");
        ResponseEntity<?> res = stockController.transfer(req, currentPrincipal());
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        // Stock du produit source intact.
        assertThat(products.findById("p-s2").orElseThrow().getStock()).isEqualTo(10);
    }

    // ─── 5) CUSTOMERS : listing isolé ───

    @Test
    void customerList_onStoreScopedNode_excludesOtherStores() {
        authenticate("u-emp", "EMPLOYEE", "s1");
        List<Customer> list = customerController.list();
        assertThat(list).extracting(Customer::getId).containsOnly("c-s1");
        assertThat(list).noneMatch(c -> "c-s2".equals(c.getId()));
    }

    @Test
    void customerGet_crossStore_returns404() {
        authenticate("u-emp", "EMPLOYEE", "s1");
        ResponseEntity<?> res = customerController.update("c-s2", new CustomerReq(null, "X", null, null, null, null), currentPrincipal());
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private AuthPrincipal currentPrincipal() {
        return (AuthPrincipal) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
    }

    private void authenticate(String userId, String role, String storeId) {
        var principal = new AuthPrincipal(userId, "Test " + userId, userId + "@test", role, storeId);
        var auth = new UsernamePasswordAuthenticationToken(
                principal, null, List.of(new SimpleGrantedAuthority("ROLE_" + role)));
        SecurityContextHolder.getContext().setAuthentication(auth);
    }
}
