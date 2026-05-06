package com.kidzpos.domain;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;

@Entity @Table(name = "stock_movements")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class StockMovement {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false) private String productId;
    @Column(nullable = false) private String storeId;
    @Enumerated(EnumType.STRING) @Column(nullable = false) private MovementType type;
    @Column(nullable = false) private int quantity;
    @Column(nullable = false) private Instant date;
    private String userId;
    private String reason;
    private String relatedSaleId;
    private String targetStoreId;
}
