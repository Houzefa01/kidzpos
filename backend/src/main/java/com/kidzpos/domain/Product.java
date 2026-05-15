package com.kidzpos.domain;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.SQLRestriction;

import java.time.Instant;

/**
 * @SQLRestriction filtre globalement les produits soft-deleted : tous les
 * findAll / findById / dérivés JPA ignorent les lignes avec deleted_at != null.
 * L'unique (store_id, sku) est porté par un index partiel V4 — voir migration.
 *
 * Pour les cas qui doivent voir aussi les supprimés (ex: refund d'une vente
 * d'un produit retiré), utiliser ProductRepository.findByIdIncludingDeleted.
 */
@Entity @Table(name = "products")
@SQLRestriction("deleted_at IS NULL")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Product {
    @Id private String id;
    @Column(nullable = false) private String name;
    @Column(nullable = false) private double price;
    @Column(nullable = false) private int stock;
    @Column(nullable = false) private String storeId;
    private String category;
    @Column(nullable = false) private String sku;
    @Column(nullable = false) private Instant createdAt;

    @Column(name = "deleted_at") private Instant deletedAt;

    /** Optimistic locking : Hibernate incrémente à chaque flush, lève
     *  ObjectOptimisticLockingFailureException si la valeur attendue diverge.
     *  Exposé en ETag sur GET, attendu en If-Match au PUT. */
    @jakarta.persistence.Version
    @Column(nullable = false)
    @Builder.Default
    private Integer version = 0;
}
