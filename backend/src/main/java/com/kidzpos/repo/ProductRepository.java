package com.kidzpos.repo;

import com.kidzpos.domain.Product;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface ProductRepository extends JpaRepository<Product, String> {
    List<Product> findByStoreId(String storeId);
    Optional<Product> findByStoreIdAndSkuIgnoreCase(String storeId, String sku);
}
