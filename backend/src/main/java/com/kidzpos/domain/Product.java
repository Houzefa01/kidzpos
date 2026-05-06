package com.kidzpos.domain;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;

@Entity @Table(name = "products",
    uniqueConstraints = @UniqueConstraint(columnNames = {"storeId", "sku"}))
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
}
