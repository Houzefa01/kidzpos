package com.kidzpos.domain;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;

@Entity @Table(name = "customers")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Customer {
    @Id private String id;
    private String name;
    private String phone;
    private String email;
    @Column(nullable = false) private int points;
    @Column(nullable = false) private double totalSpent;
    @Column(nullable = false) private int visits;
    @Column(nullable = false) private Instant createdAt;
}
