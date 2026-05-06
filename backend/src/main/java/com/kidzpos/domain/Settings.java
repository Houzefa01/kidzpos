package com.kidzpos.domain;

import jakarta.persistence.*;
import lombok.*;

@Entity @Table(name = "settings")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Settings {
    @Id
    private Long id;          // toujours 1
    @Column(nullable = false) private double taxRate;
    @Column(nullable = false) private double maxDiscountPercent;
    @Column(nullable = false) private double pointsPerEuro;
    @Column(nullable = false) private double euroPerPoint;
    @Column(nullable = false) private String shopName;
    /** Devise par défaut affichée : "AR" (Ariary) ou "EUR" (Euro). */
    @Column(nullable = false) private String currency;
}
