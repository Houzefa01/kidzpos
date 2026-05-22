package com.kidzpos.sync;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kidzpos.domain.SyncInbox;
import com.kidzpos.repo.SyncInboxRepository;
import com.kidzpos.sync.SyncDtos.PullResponse;
import com.kidzpos.sync.SyncDtos.PushOperation;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;

/**
 * Pull des événements du serveur central vers la table locale {@code sync_inbox}.
 *
 * Pipeline d'un tick (best-effort, ne lance aucune exception au caller) :
 *  1. Cursor = max(createdAt) de sync_inbox (ou null si vide → cold start).
 *  2. GET {centralUrl}/api/sync/pull?since=...&limit=N
 *  3. Sur HTTP 2xx + JSON parsable :
 *     - pour chaque opération : insert si UUID non encore connu localement
 *     - les duplicates sont silencieusement ignorés (idempotence)
 *  4. Sur échec (réseau, timeout, 5xx, parse) : silencieux, retry au tick suivant.
 *
 * AUCUNE logique métier : on JOURNALISE dans sync_inbox avec processed=false.
 * Aucun controller métier ne lit cette table. Une future itération (HORS scope)
 * introduira un dispatcher qui appliquera les événements et basculera processed=true.
 *
 * Activation : @ConditionalOnProperty kidzpos.sync.pull.enabled=true.
 *              Sans cette propriété, le bean n'est PAS créé → ZÉRO impact runtime.
 */
@Service
@ConditionalOnProperty(prefix = "kidzpos.sync.pull", name = "enabled", havingValue = "true")
public class SyncPullService {

    private static final Logger log = LoggerFactory.getLogger(SyncPullService.class);

    private final SyncInboxRepository inbox;
    private final ObjectMapper mapper;
    private final NodeContext nodeContext;
    private final String centralUrl;
    private final String apiKey;
    private final int batchSize;
    private final Duration timeout;
    private final HttpClient http;

    public SyncPullService(SyncInboxRepository inbox,
                           ObjectMapper mapper,
                           NodeContext nodeContext,
                           @Value("${kidzpos.sync.pull.central-url:}") String centralUrl,
                           @Value("${kidzpos.sync.pull.api-key:}") String apiKey,
                           @Value("${kidzpos.sync.pull.batch-size:100}") int batchSize,
                           @Value("${kidzpos.sync.pull.timeout-ms:5000}") long timeoutMs) {
        this.inbox = inbox;
        this.mapper = mapper;
        this.nodeContext = nodeContext;
        this.centralUrl = centralUrl == null ? "" : centralUrl.replaceAll("/+$", "");
        this.apiKey = apiKey == null ? "" : apiKey;
        this.batchSize = Math.max(1, Math.min(batchSize, 500));
        this.timeout = Duration.ofMillis(Math.max(500, timeoutMs));
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(2))
                .build();
    }

    /** Vrai ssi la configuration est suffisante pour tenter un pull. */
    public boolean isConfigured() {
        return !centralUrl.isBlank() && !apiKey.isBlank();
    }

    /**
     * Tente un pull. Retourne le nombre d'événements effectivement INSÉRÉS
     * (hors duplicates). Retourne 0 sur tout échec ou si rien de neuf.
     *
     * Reentrant : safe à appeler en boucle bornée (cf {@link #pullAll(int)}).
     */
    public int pullOnce() {
        if (!isConfigured()) {
            log.debug("[sync-pull] not configured (centralUrl or apiKey missing) — skipping");
            return 0;
        }

        // 1) Cursor
        Instant since = inbox.findTopByOrderByCreatedAtDesc()
                .map(SyncInbox::getCreatedAt)
                .orElse(null);

        // 2) GET central
        // V22 — full mesh : on NE filtre PLUS par storeId au pull. Chaque nœud
        // reçoit TOUS les events de TOUS les magasins → permet à un admin de
        // voir l'activité globale depuis n'importe quel store. L'isolation
        // restante se fait au niveau API via enforceStoreScope (EMPLOYEE
        // contraint à son store, ADMIN voit tout).
        StringBuilder url = new StringBuilder(centralUrl).append("/api/sync/pull?limit=").append(batchSize);
        if (since != null) {
            url.append("&since=").append(URLEncoder.encode(since.toString(), StandardCharsets.UTF_8));
        }

        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(url.toString()))
                .timeout(timeout)
                .header("X-Sync-Api-Key", apiKey)
                .header("Accept", "application/json")
                .GET()
                .build();

        HttpResponse<String> res;
        try {
            res = http.send(req, HttpResponse.BodyHandlers.ofString());
        } catch (java.net.http.HttpConnectTimeoutException e) {
            log.info("[sync-pull] central unreachable (connect timeout) — will retry");
            return 0;
        } catch (java.net.http.HttpTimeoutException e) {
            log.info("[sync-pull] central timeout — will retry");
            return 0;
        } catch (java.io.IOException | InterruptedException e) {
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            log.info("[sync-pull] network error: {} — will retry", e.getMessage());
            return 0;
        }

        if (res.statusCode() / 100 != 2) {
            log.warn("[sync-pull] central returned HTTP {} — body={} — will retry",
                    res.statusCode(), abbreviate(res.body()));
            return 0;
        }

        PullResponse parsed;
        try {
            parsed = mapper.readValue(res.body(), PullResponse.class);
        } catch (Exception e) {
            log.warn("[sync-pull] central response unparseable: {} — will retry", e.getMessage());
            return 0;
        }

        if (parsed.operations() == null || parsed.operations().isEmpty()) {
            log.debug("[sync-pull] no new events (since={})", since);
            return 0;
        }

        // 3) Insertion idempotente
        int inserted = 0;
        int duplicates = 0;
        int errors = 0;
        for (PushOperation op : parsed.operations()) {
            if (op.id() == null) continue;
            if (inbox.existsById(op.id())) {
                duplicates++;
                continue;
            }
            try {
                inbox.save(SyncInbox.builder()
                        .id(op.id())
                        .type(op.type() == null ? "unknown" : op.type())
                        .payload(op.payload() == null ? "{}" : op.payload())
                        .createdAt(op.createdAt() == null ? Instant.now() : op.createdAt())
                        .processed(false)
                        // V18 : preserve l'origine magasin de l'event (peut être NULL pour
                        // les events legacy du central pré-V18). Le processor a un
                        // garde cross-store pour empêcher l'application si != nodeContext.
                        .storeId(op.storeId())
                        .build());
                inserted++;
            } catch (Exception e) {
                // Cas: contrainte unique violée si deux pulls concurrents inséraient
                // le même id. existsById l'évite déjà, mais en défense en profondeur
                // on swallow et on traite comme duplicate.
                errors++;
                log.debug("[sync-pull] insert failed for {} ({}): {}", op.id(), op.type(), e.getMessage());
            }
        }

        log.info("[sync-pull] received={} inserted={} duplicates={} errors={} hasMore={} since={}",
                parsed.operations().size(), inserted, duplicates, errors, parsed.hasMore(), since);
        return inserted;
    }

    /**
     * Drain : enchaîne jusqu'à `maxBatches` pulls tant que le central signale
     * qu'il y a plus de données ET qu'on a effectivement inséré quelque chose
     * au dernier tour. Borné pour ne pas monopoliser le scheduler.
     */
    public int pullAll(int maxBatches) {
        int total = 0;
        for (int i = 0; i < Math.max(1, maxBatches); i++) {
            int n = pullOnce();
            if (n == 0) break;
            total += n;
        }
        return total;
    }

    private static String abbreviate(String s) {
        if (s == null) return "";
        return s.length() > 200 ? s.substring(0, 200) + "…" : s;
    }
}
