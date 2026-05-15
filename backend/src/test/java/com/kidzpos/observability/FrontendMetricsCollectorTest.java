package com.kidzpos.observability;

import com.kidzpos.dto.Dtos.FrontendMetricsReq;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Tests unitaires : pas de Spring, pas de TestContainers. Vérifie l'agrégation
 * (sum across cashiers), l'éviction TTL 5 min, l'enregistrement des samples
 * dans le DistributionSummary, et la borne sanity-check sur les latencies.
 */
class FrontendMetricsCollectorTest {

    @Test
    void aggregatesAcrossCashiers() {
        SimpleMeterRegistry reg = new SimpleMeterRegistry();
        var c = new FrontendMetricsCollector(reg);

        c.record("u1", new FrontendMetricsReq(3, 1, List.of(100.0, 200.0)));
        c.record("u2", new FrontendMetricsReq(5, 0, List.of(50.0)));

        assertThat(reg.find("kidzpos.frontend.outbox_size").gauge().value()).isEqualTo(8.0);
        assertThat(reg.find("kidzpos.frontend.failed_replays").gauge().value()).isEqualTo(1.0);
        assertThat(reg.find("kidzpos.frontend.reporting_cashiers").gauge().value()).isEqualTo(2.0);

        var lat = reg.find("kidzpos.frontend.sync_latency_ms").summary();
        assertThat(lat.count()).isEqualTo(3);
        assertThat(lat.totalAmount()).isEqualTo(350.0);
    }

    @Test
    void reReportFromSameCashierOverwritesNotAccumulates() {
        SimpleMeterRegistry reg = new SimpleMeterRegistry();
        var c = new FrontendMetricsCollector(reg);

        c.record("u1", new FrontendMetricsReq(10, 2, List.of()));
        c.record("u1", new FrontendMetricsReq(3, 0, List.of()));  // queue vidée

        // Le gauge prend la VALEUR ACTUELLE (la plus récente), pas la somme.
        assertThat(reg.find("kidzpos.frontend.outbox_size").gauge().value()).isEqualTo(3.0);
        assertThat(reg.find("kidzpos.frontend.failed_replays").gauge().value()).isEqualTo(0.0);
        assertThat(reg.find("kidzpos.frontend.reporting_cashiers").gauge().value()).isEqualTo(1.0);
    }

    @Test
    void staleSnapshotsAreEvictedAfter5Min() {
        var mutableNow = new MutableClock(Instant.parse("2026-01-01T10:00:00Z"));
        SimpleMeterRegistry reg = new SimpleMeterRegistry();
        var c = new FrontendMetricsCollector(reg, mutableNow);

        // u1 reporte à 10:00 avec outbox=10
        c.record("u1", new FrontendMetricsReq(10, 0, List.of()));
        assertThat(reg.find("kidzpos.frontend.outbox_size").gauge().value()).isEqualTo(10.0);
        assertThat(reg.find("kidzpos.frontend.reporting_cashiers").gauge().value()).isEqualTo(1.0);

        // 6 min plus tard, u2 reporte (u1 n'a pas re-reporté → stale)
        mutableNow.advance(Duration.ofMinutes(6));
        c.record("u2", new FrontendMetricsReq(3, 0, List.of()));

        // u1 est évincé : seul u2 compte
        assertThat(reg.find("kidzpos.frontend.outbox_size").gauge().value()).isEqualTo(3.0);
        assertThat(reg.find("kidzpos.frontend.reporting_cashiers").gauge().value()).isEqualTo(1.0);
    }

    @Test
    void latencySamplesOutOfBoundsAreFiltered() {
        SimpleMeterRegistry reg = new SimpleMeterRegistry();
        var c = new FrontendMetricsCollector(reg);

        // 1h00 = 3 600 000 ms (borne incluse), 1h01 = au-delà → filtré
        c.record("u1", new FrontendMetricsReq(0, 0, List.of(100.0, 3_600_000.0, 3_700_000.0, -1.0)));

        var lat = reg.find("kidzpos.frontend.sync_latency_ms").summary();
        assertThat(lat.count()).isEqualTo(2);  // 100 et 3.6M acceptés
        assertThat(lat.totalAmount()).isEqualTo(3_600_100.0);
    }

    @Test
    void emptySamplesListIsAccepted() {
        SimpleMeterRegistry reg = new SimpleMeterRegistry();
        var c = new FrontendMetricsCollector(reg);

        c.record("u1", new FrontendMetricsReq(0, 0, List.of()));
        c.record("u2", new FrontendMetricsReq(0, 0, null));  // null tolérable

        assertThat(reg.find("kidzpos.frontend.sync_latency_ms").summary().count()).isEqualTo(0);
        assertThat(reg.find("kidzpos.frontend.reporting_cashiers").gauge().value()).isEqualTo(2.0);
    }

    @Test
    void blankUserIdIsIgnored() {
        SimpleMeterRegistry reg = new SimpleMeterRegistry();
        var c = new FrontendMetricsCollector(reg);

        c.record(null, new FrontendMetricsReq(99, 99, List.of(99.0)));
        c.record("", new FrontendMetricsReq(99, 99, List.of(99.0)));
        c.record("   ", new FrontendMetricsReq(99, 99, List.of(99.0)));

        assertThat(reg.find("kidzpos.frontend.reporting_cashiers").gauge().value()).isEqualTo(0.0);
        assertThat(reg.find("kidzpos.frontend.sync_latency_ms").summary().count()).isEqualTo(0);
    }

    // ── helper : Clock mutable pour tester le TTL ───────────────────────────

    private static final class MutableClock extends Clock {
        private Instant now;
        MutableClock(Instant start) { this.now = start; }
        void advance(Duration d) { this.now = this.now.plus(d); }
        @Override public java.time.ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(java.time.ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }
}
