package com.kidzpos.repo;

import com.kidzpos.domain.Sale;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface SaleRepository extends JpaRepository<Sale, String> {
    List<Sale> findByStoreIdOrderByDateDesc(String storeId);
    List<Sale> findAllByOrderByDateDesc();

    @Query("SELECT MAX(s.seq) FROM Sale s WHERE s.storeId = :storeId")
    Optional<Long> findMaxSeqByStoreId(@Param("storeId") String storeId);
}
