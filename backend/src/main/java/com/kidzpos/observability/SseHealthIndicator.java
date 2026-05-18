package com.kidzpos.observability;

import com.kidzpos.events.EventBus;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;

/**
 * Healthcheck enrichi sur le bus SSE.
 *
 * Le {@link EventBus#startHeartbeat()} tick toutes les 30 s (cf @PostConstruct).
 * Si {@code lastBroadcastAt} n'a pas bougé depuis plus de {@link #DEFAULT_STALE_SECONDS}
 * c'est que le scheduler heartbeater est bloqué — situation critique côté ops :
 *   - tous les clients SSE vont déclencher leur "zombie detection" (90 s côté front)
 *     et reconnecter en cascade.
 *   - aucun event `change` n'est diffusé → les caisses ne voient plus les mutations
 *     des autres en temps réel (elles continuent à fonctionner via polling 30 s
 *     du backend watcher, mais l'UX temps réel est cassée).
 *
 * Exposé via /actuator/health → l'Alertmanager peut déclencher une alerte sur
 * `status: DOWN` (cf ops/prometheus/alerts.yml).
 *
 * Détails (subscribers + secondsSinceLastBroadcast) visibles uniquement quand
 * l'utilisateur est authentifié (management.endpoint.health.show-details =
 * when_authorized).
 */
@Component("sseBus")
public class SseHealthIndicator implements HealthIndicator {

    /** Au-delà de 2× la période du heartbeat (30 s), on considère que le bus est figé. */
    private static final long DEFAULT_STALE_SECONDS = 90;

    private final EventBus bus;
    private final long staleSeconds;

    public SseHealthIndicator(EventBus bus,
                              @Value("${kidzpos.health.sse-stale-seconds:90}") long staleSeconds) {
        this.bus = bus;
        this.staleSeconds = Math.max(60, staleSeconds);  // minimum 1 min pour éviter les faux positifs au boot
    }

    @Override
    public Health health() {
        long now = System.currentTimeMillis();
        long ageMs = Math.max(0, now - bus.lastBroadcastAt());
        long ageSeconds = ageMs / 1000;
        int subscribers = bus.subscribers();

        Health.Builder builder = ageSeconds <= staleSeconds ? Health.up() : Health.down();

        return builder
                .withDetail("subscribers", subscribers)
                .withDetail("lastBroadcastAt", Instant.ofEpochMilli(bus.lastBroadcastAt()).toString())
                .withDetail("secondsSinceLastBroadcast", ageSeconds)
                .withDetail("staleAfterSeconds", staleSeconds)
                .withDetail("heartbeatPeriodSeconds", Duration.ofSeconds(30).getSeconds())
                .build();
    }
}
