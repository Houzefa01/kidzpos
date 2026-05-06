package com.kidzpos.repo;

import com.kidzpos.domain.Product;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;
import java.util.Optional;

public interface ProductRepository extends JpaRepository<Product, String> {
    List<Product> findByStoreId(String storeId);
    Optional<Product> findByStoreIdAndSkuIgnoreCase(String storeId, String sku);

    /**
     * Décrémente le stock atomiquement uniquement si {@code stock >= qty}.
     * Retourne le nombre de lignes modifiées : 0 = stock insuffisant, 1 = OK.
     * Indispensable contre les checkouts concurrents (B6).
     */
    @Modifying
    @Query("UPDATE Product p SET p.stock = p.stock - :qty WHERE p.id = :id AND p.stock >= :qty")
    int decrementStockIfAvailable(@Param("id") String id, @Param("qty") int qty);
}
