package com.kidzpos.sync.handlers;

import com.fasterxml.jackson.databind.JsonNode;
import com.kidzpos.domain.Product;
import com.kidzpos.repo.ProductRepository;
import com.kidzpos.sync.InboxHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.UUID;

/**
 * Handler "product.created" : crée le produit localement s'il n'existe pas déjà.
 *
 * Idempotence : check {@code findByIdIncludingDeleted} (inclut les soft-deleted)
 * avant toute création → impossible de violer la PK même si l'événement est
 * rejoué. Un produit soft-deleted localement reste tel quel — on ne le ressuscite
 * pas automatiquement (volonté du gestionnaire local).
 *
 * Payload attendu (best-effort sur les champs optionnels) :
 *   { id, name, price, stock, storeId, sku, category? }
 *
 * Erreurs :
 *   - id manquant → IllegalArgumentException (ligne reste à processed=false)
 *   - violation de contrainte JPA → exception métier (idem)
 */
@Component
public class ProductCreatedHandler implements InboxHandler {

    private static final Logger log = LoggerFactory.getLogger(ProductCreatedHandler.class);

    private final ProductRepository products;

    public ProductCreatedHandler(ProductRepository products) {
        this.products = products;
    }

    @Override
    public String type() {
        return "product.created";
    }

    @Override
    public void apply(UUID eventId, JsonNode payload) {
        String id = text(payload, "id");
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("product.created: missing 'id'");
        }

        // Idempotence : inclut les soft-deleted (sinon on tomberait en collision PK
        // sur la prochaine création d'un id "supprimé" puis re-créé en central).
        if (products.findByIdIncludingDeleted(id).isPresent()) {
            log.debug("[product.created] {} already exists locally — skip", id);
            return; // skip silencieux : la TX commit, ligne marquée processed=true
        }

        Product p = Product.builder()
                .id(id)
                .name(text(payload, "name"))
                .price(payload.path("price").asDouble(0))
                .stock(payload.path("stock").asInt(0))
                .storeId(text(payload, "storeId"))
                .sku(text(payload, "sku"))
                .category(payload.has("category") && !payload.get("category").isNull()
                        ? payload.get("category").asText()
                        : null)
                .createdAt(Instant.now())
                .build();

        // Si les contraintes NOT NULL côté entité (name, storeId, sku) sont violées,
        // le save throw → la TX rollback → ligne reste à processed=false (loggée).
        products.save(p);
    }

    private static String text(JsonNode node, String field) {
        JsonNode v = node.get(field);
        return (v == null || v.isNull()) ? null : v.asText();
    }
}
