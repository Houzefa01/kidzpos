package com.kidzpos.events;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Bus d'événements SSE — diffuse les changements aux clients connectés.
 * - Broadcast asynchrone (ne bloque pas les threads Tomcat)
 * - Heartbeat toutes les 30s (détecte les connexions zombies)
 * - Timeout 10 min — le ping garde la connexion vivante
 * - Payload minimal : entité + action seulement (le client re-fetch)
 */
@Component
public class EventBus {

    private final Map<Long, SseEmitter> emitters = new ConcurrentHashMap<>();
    private final AtomicLong seq = new AtomicLong();

    private final ExecutorService broadcaster = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "sse-broadcaster");
        t.setDaemon(true);
        return t;
    });

    private final ScheduledExecutorService heartbeater = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "sse-heartbeat");
        t.setDaemon(true);
        return t;
    });

    public SseEmitter subscribe() {
        long id = seq.incrementAndGet();
        // Timeout 10min — le heartbeat de 30s garde la connexion active
        SseEmitter emitter = new SseEmitter(600_000L);
        emitters.put(id, emitter);
        emitter.onCompletion(() -> emitters.remove(id));
        emitter.onTimeout(() -> emitters.remove(id));
        emitter.onError(e -> emitters.remove(id));
        try {
            emitter.send(SseEmitter.event().name("hello").data(Map.of("ok", true)));
        } catch (IOException ignored) {}
        return emitter;
    }

    /**
     * Diffuse un signal de changement à tous les clients de façon asynchrone.
     * Payload minimal : le client re-fetch via /api/* pour obtenir les données.
     */
    public void publish(String entity, String action, Object ignored) {
        Map<String, Object> signal = Map.of("entity", entity, "action", action, "ts", System.currentTimeMillis());
        broadcaster.submit(() -> sendToAll("change", signal));
    }

    private void sendToAll(String eventName, Map<String, Object> data) {
        List<Long> stale = new ArrayList<>();
        for (var entry : new ArrayList<>(emitters.entrySet())) {
            try {
                entry.getValue().send(SseEmitter.event().name(eventName).data(data));
            } catch (IOException e) {
                stale.add(entry.getKey());
            } catch (IllegalStateException e) {
                // Emitter déjà fermé/complété
                stale.add(entry.getKey());
            }
        }
        stale.forEach(emitters::remove);
    }

    @PostConstruct
    public void startHeartbeat() {
        // Ping toutes les 30s — empêche le timeout réseau (proxy, NAT, mobile data)
        heartbeater.scheduleAtFixedRate(() -> {
            if (emitters.isEmpty()) return;
            Map<String, Object> ping = Map.of("ts", System.currentTimeMillis());
            sendToAll("ping", ping);
        }, 30, 30, TimeUnit.SECONDS);
    }

    @PreDestroy
    public void shutdown() {
        heartbeater.shutdown();
        broadcaster.shutdown();
        try {
            if (!heartbeater.awaitTermination(2, TimeUnit.SECONDS)) heartbeater.shutdownNow();
            if (!broadcaster.awaitTermination(5, TimeUnit.SECONDS)) broadcaster.shutdownNow();
        } catch (InterruptedException e) {
            heartbeater.shutdownNow();
            broadcaster.shutdownNow();
            Thread.currentThread().interrupt();
        }
        emitters.values().forEach(SseEmitter::complete);
        emitters.clear();
    }

    public int subscribers() { return emitters.size(); }
}
