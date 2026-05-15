package com.kidzpos.observability;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;

/**
 * Counters exposés via /actuator/prometheus pour suivre la santé métier :
 * - replays idempotents (combien de doubles fois rejouées sont absorbées)
 * - conflits optimistic locking
 * - rate-limit hits
 *
 * Pas de gauges custom ici ; HTTP latency et JVM metrics sont émis nativement
 * par Spring Boot Actuator (http.server.requests, jvm.*).
 */
@Component
public class BusinessMetrics {

    public final Counter stockIdempotentReplay;
    public final Counter saleIdempotentReplay;
    public final Counter saleSeqRetry;
    public final Counter optimisticLockConflict;
    public final Counter loginRateLimited;

    public BusinessMetrics(MeterRegistry registry) {
        this.stockIdempotentReplay = Counter.builder("kidzpos.stock.idempotent_replay")
                .description("Mouvements de stock court-circuités car clientMovementId déjà appliqué")
                .register(registry);
        this.saleIdempotentReplay = Counter.builder("kidzpos.sale.idempotent_replay")
                .description("Ventes court-circuitées car clientSaleId déjà appliqué")
                .register(registry);
        this.saleSeqRetry = Counter.builder("kidzpos.sale.seq_retry")
                .description("Retries sur collision uk_sale_store_seq")
                .register(registry);
        this.optimisticLockConflict = Counter.builder("kidzpos.optimistic_lock.conflict")
                .description("Edits rejetés à cause d'un @Version stale (HTTP 409)")
                .register(registry);
        this.loginRateLimited = Counter.builder("kidzpos.login.rate_limited")
                .description("Tentatives de login rejetées par LoginRateLimitFilter (HTTP 429)")
                .register(registry);
    }
}
