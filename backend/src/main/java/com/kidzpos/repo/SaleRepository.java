package com.kidzpos.repo;

import com.kidzpos.domain.Sale;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface SaleRepository extends JpaRepository<Sale, String> {
    /**
     * B4 : @EntityGraph charge les items dans la même requête (LEFT JOIN FETCH)
     *      pour éviter le N+1 lorsque Sale.items est en LAZY.
     */
    @EntityGraph(attributePaths = "items")
    List<Sale> findByStoreIdOrderByDateDesc(String storeId);

    @EntityGraph(attributePaths = "items")
    List<Sale> findAllByOrderByDateDesc();

    @EntityGraph(attributePaths = "items")
    Optional<Sale> findById(String id);

    @Query("SELECT MAX(s.seq) FROM Sale s WHERE s.storeId = :storeId")
    Optional<Long> findMaxSeqByStoreId(@Param("storeId") String storeId);

    /** I5 : détection rapide d'un refund existant pour bloquer le double-remboursement. */
    boolean existsByRefundedFrom(String saleId);

    /** Pagination optionnelle (P0.5). Garde la même requête entityGraph items. */
    @EntityGraph(attributePaths = "items")
    Page<Sale> findByStoreIdOrderByDateDesc(String storeId, Pageable pageable);

    @EntityGraph(attributePaths = "items")
    Page<Sale> findAllByOrderByDateDesc(Pageable pageable);
}
