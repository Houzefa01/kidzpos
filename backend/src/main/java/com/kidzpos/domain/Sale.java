package com.kidzpos.domain;

import com.fasterxml.jackson.annotation.JsonManagedReference;
import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Entity @Table(name = "sales",
    uniqueConstraints = @UniqueConstraint(name = "uk_sale_store_seq", columnNames = {"storeId", "seq"}))
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Sale {
    @Id private String id;
    @Column(nullable = false) private long seq;
    @Column(nullable = false) private String storeId;
    @Column(nullable = false) private String userId;
    @Column(nullable = false) private String userName;

    // B4 : LAZY + @EntityGraph sur les listings (cf SaleRepository) pour éviter le N+1.
    // open-in-view: false ⇒ les items sont chargés explicitement via le fetch plan.
    @OneToMany(mappedBy = "sale", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @JsonManagedReference
    @Builder.Default
    private List<SaleItem> items = new ArrayList<>();

    @Column(nullable = false) private double subtotal;
    @Column(nullable = false) private double tax;
    @Column(nullable = false) private double taxRate;
    @Column(nullable = false) private double discount;
    @Column(nullable = false) private double total;
    @Column(nullable = false) private Instant date;

    private String customerId;
    private String customerName;
    @Column(nullable = false) private int pointsEarned;
    @Column(nullable = false) private int pointsRedeemed;

    @Enumerated(EnumType.STRING) @Column(nullable = false) private PaymentMode paymentMode;
    private Double amountPaid;
    private Double change;
    private String refundedFrom;

    /** Devise affichée au client lors de la vente ("AR" ou "EUR").
     *  Les montants sont stockés en EUR ; ce champ sert au rendu reçu / historique. */
    @Column(nullable = false, length = 10) @Builder.Default private String currency = "AR";
}
