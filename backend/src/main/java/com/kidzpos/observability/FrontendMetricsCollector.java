package com.kidzpos.observability;

import com.kidzpos.dto.Dtos.FrontendMetricsReq;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.DistributionSummary;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Stream;

/**
 * Agrège les métriques offline-first remontées par les caisses.
 *
 * Une caisse POST son snapshot toutes les 30s (cf metricsReporter.ts). On stocke
 * la dernière valeur PAR userId dans une map en mémoire. Les gauges Prometheus
 * exposent la SOMME (ou le count) sans label dynamique → cardinalité bornée.
 *
 * TTL 5 min sur lecture : si une caisse arrête de reporter, son snapshot est
 * ignoré au calcul (pas besoin de thread de cleanup — éviction opportuniste
 * à chaque record() + filtre à la lecture).
 *
 * Les samples de latency syncLatencyMs alimentent un DistributionSummary
 * (histogram Micrometer → buckets Prometheus le="…").
 */
@Service
public class FrontendMetricsCollector {

    private static final Logger log = LoggerFactory.getLogger(FrontendMetricsCollector.class);
    private static final Duration STALE_AFTER = Duration.ofMinutes(5);
    private static final double LATENCY_MAX_MS = 3_600_000; // sanity-check 1h

    private final Map<String, Snapshot> snapshots = new ConcurrentHashMap<>();
    private final DistributionSummary syncLatency;
    private final Counter replayBatchSize;
    private final Counter replayThrottleDelayMs;
    private final Counter replayBackoffRetries;
    private final Clock clock;

    public FrontendMetricsCollector(MeterRegistry registry) {
        this(registry, Clock.systemUTC());
    }

    /** Constructor exposé pour les tests : permet d'injecter un Clock fixed. */
    public FrontendMetricsCollector(MeterRegistry registry, Clock clock) {
        this.clock = clock;
        this.syncLatency = DistributionSummary.builder("kidzpos.frontend.sync_latency_ms")
                .description("Latence entre enqueue outbox et replay réussi (ms)")
                .baseUnit("milliseconds")
                .publishPercentiles(0.5, 0.95, 0.99)
                .register(registry);

        Gauge.builder("kidzpos.frontend.outbox_size", this, FrontendMetricsCollector::totalOutboxSize)
                .description("Somme des tailles d'outbox sur toutes les caisses actives")
                .register(registry);
        Gauge.builder("kidzpos.frontend.failed_replays", this, FrontendMetricsCollector::totalFailedReplays)
                .description("Somme des échecs 4xx persistés sur toutes les caisses actives")
                .register(registry);
        Gauge.builder("kidzpos.frontend.reporting_cashiers", this, FrontendMetricsCollector::activeCashierCount)
                .description("Nombre de caisses ayant reporté dans les " + STALE_AFTER.toMinutes() + " dernières minutes")
                .register(registry);

        // P4 — Counters cumulés (deltas envoyés par le client). Aucun label
        // dynamique : un time-series global pour toute la flotte.
        this.replayBatchSize = Counter.builder("kidzpos.frontend.replay_batch_size")
                .description("Nombre cumulé d'entrées outbox replay-traitées par batch (succès + 4xx)")
                .register(registry);
        this.replayThrottleDelayMs = Counter.builder("kidzpos.frontend.replay_throttle_delay_ms")
                .description("Cumul des ms d'attente du throttle client (anti-burst)")
                .baseUnit("milliseconds")
                .register(registry);
        this.replayBackoffRetries = Counter.builder("kidzpos.frontend.replay_backoff_retries")
                .description("Nombre de drains de l'outbox interrompus par 5xx/réseau (déclenchant un backoff)")
                .register(registry);
    }

    public void record(String userId, FrontendMetricsReq req) {
        if (userId == null || userId.isBlank()) return;
        Instant now = clock.instant();
        // Éviction opportuniste : nettoie les vieilles entrées avant d'ajouter
        Instant cutoff = now.minus(STALE_AFTER);
        snapshots.entrySet().removeIf(e -> e.getValue().ts().isBefore(cutoff));
        snapshots.put(userId, new Snapshot(req.outboxSize(), req.failedReplaysCount(), now));

        if (req.syncLatencyMs() != null) {
            for (Double v : req.syncLatencyMs()) {
                if (v != null && v >= 0 && v <= LATENCY_MAX_MS) {
                    syncLatency.record(v);
                }
            }
        }

        // P4 — Counters cumulés. Les champs sont optionnels (clients P3 → null).
        if (req.replayBatchSize() != null && req.replayBatchSize() > 0) {
            replayBatchSize.increment(req.replayBatchSize());
        }
        if (req.replayThrottleDelayMs() != null && req.replayThrottleDelayMs() > 0) {
            replayThrottleDelayMs.increment(req.replayThrottleDelayMs());
        }
        if (req.replayBackoffRetries() != null && req.replayBackoffRetries() > 0) {
            replayBackoffRetries.increment(req.replayBackoffRetries());
        }

        log.debug("Frontend metrics recorded: userId={} outbox={} failed={} samples={} batch={} throttleMs={} backoff={}",
                userId, req.outboxSize(), req.failedReplaysCount(),
                req.syncLatencyMs() == null ? 0 : req.syncLatencyMs().size(),
                req.replayBatchSize(), req.replayThrottleDelayMs(), req.replayBackoffRetries());
    }

    // ── Gauge suppliers ──────────────────────────────────────────────────────

    double totalOutboxSize() {
        return activeSnapshots().mapToInt(Snapshot::outboxSize).sum();
    }

    double totalFailedReplays() {
        return activeSnapshots().mapToInt(Snapshot::failedReplays).sum();
    }

    double activeCashierCount() {
        return activeSnapshots().count();
    }

    private Stream<Snapshot> activeSnapshots() {
        Instant cutoff = clock.instant().minus(STALE_AFTER);
        return snapshots.values().stream().filter(s -> s.ts().isAfter(cutoff));
    }

    private record Snapshot(int outboxSize, int failedReplays, Instant ts) {}
}
