package com.kidzpos.dto;

import com.kidzpos.domain.PaymentMode;
import jakarta.validation.constraints.*;

import java.util.List;

public class Dtos {

    public record LoginReq(@NotBlank String email, @NotBlank String password) {}
    public record LoginRes(String token, UserRes user) {}
    public record UserRes(String id, String name, String email, String role, String storeId, boolean active) {}

    public record CreateUserReq(
            @NotBlank String name,
            @Email String email,
            @NotBlank @Size(min = 4) String password,
            @NotBlank String role,    // ADMIN | EMPLOYEE
            String storeId,
            Boolean active
    ) {}

    public record UpdateUserReq(String name, String email, String role, String storeId, Boolean active, String password) {}

    public record StoreReq(@NotBlank String id, @NotBlank String name, String location) {}

    public record ProductReq(
            String id,
            @NotBlank String name,
            @PositiveOrZero double price,
            @PositiveOrZero int stock,
            @NotBlank String storeId,
            String category,
            @NotBlank String sku
    ) {}

    public record CustomerReq(String id, String name, String phone, String email, Integer points) {}

    public record SaleItemReq(@NotBlank String productId, @Min(1) int quantity) {}

    public record CheckoutReq(
            @NotBlank String storeId,
            @NotEmpty List<SaleItemReq> items,
            @PositiveOrZero double discount,        // en € (montant absolu après calcul UI)
            @NotNull PaymentMode paymentMode,
            Double amountPaid,
            String customerId,
            @PositiveOrZero int pointsRedeemed
    ) {}

    public record RefundReq(@NotBlank String saleId) {}

    public record StockAdjustReq(
            @NotBlank String productId,
            int delta,                  // signé
            String reason
    ) {}

    public record TransferReq(
            @NotBlank String productId,
            @NotBlank String targetStoreId,
            @Min(1) int quantity
    ) {}

    public record SettingsReq(
            @PositiveOrZero double taxRate,
            @PositiveOrZero double maxDiscountPercent,
            @PositiveOrZero double pointsPerEuro,
            @PositiveOrZero double euroPerPoint,
            @NotBlank String shopName,
            String currency
    ) {}
}
