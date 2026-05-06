package com.kidzpos.repo;

import com.kidzpos.domain.StockMovement;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface StockMovementRepository extends JpaRepository<StockMovement, Long> {
    List<StockMovement> findByStoreIdOrderByDateDesc(String storeId);
    List<StockMovement> findAllByOrderByDateDesc();
}
