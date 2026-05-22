package com.kidzpos.sync;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;

/**
 * Authentification server-to-server pour /api/sync/** via header X-Sync-Api-Key.
 *
 * Sémantique :
 *   - Si la clé serveur (kidzpos.sync.inbound.api-key) est vide → filtre désactivé
 *     (le seul accès reste ROLE_ADMIN via JWT, comme avant). Aucune régression.
 *   - Sinon, pour les requêtes sur /api/sync/** :
 *       * header présent + match (comparaison constante) → on pose une
 *         Authentication ROLE_ADMIN (compatible avec hasRole("ADMIN") existant)
 *       * header absent ou mismatch → on ne pose rien : la requête sera traitée
 *         comme un appel normal (et tombera sur hasRole("ADMIN") → 401/403).
 *
 * Cohabite avec JwtAuthFilter : on ne pose une auth API-KEY que si aucune
 * authentification JWT n'a été établie. Un admin peut donc continuer à
 * appeler avec son JWT, et un démon de sync utilise la clé.
 *
 * Comparaison en temps constant pour éviter les timing attacks (clé courte
 * mais bonne pratique).
 */
@Component
public class SyncApiKeyFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Sync-Api-Key";
    private static final String PATH_PREFIX = "/api/sync/";

    private static final Logger log = LoggerFactory.getLogger(SyncApiKeyFilter.class);

    private final String expectedKey;

    public SyncApiKeyFilter(@Value("${kidzpos.sync.inbound.api-key:}") String expectedKey) {
        this.expectedKey = expectedKey == null ? "" : expectedKey;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {

        // Hors scope : on ne fait rien, pas la peine d'imposer ce check à toutes les routes.
        String path = req.getRequestURI();
        if (path == null || !path.startsWith(PATH_PREFIX)) {
            chain.doFilter(req, res);
            return;
        }

        // Pas de clé configurée → l'authentification API-KEY est désactivée.
        // L'ancien chemin (ROLE_ADMIN via JWT) continue de fonctionner.
        if (expectedKey.isBlank()) {
            chain.doFilter(req, res);
            return;
        }

        // Déjà authentifié par JWT → on ne touche pas.
        var existing = SecurityContextHolder.getContext().getAuthentication();
        if (existing != null && existing.isAuthenticated()) {
            chain.doFilter(req, res);
            return;
        }

        String provided = req.getHeader(HEADER);
        if (provided != null && constantTimeEquals(provided, expectedKey)) {
            // Identité technique "sync-client", autorité ROLE_ADMIN pour passer la règle.
            var auth = new UsernamePasswordAuthenticationToken(
                    "sync-client",
                    null,
                    List.of(new SimpleGrantedAuthority("ROLE_ADMIN"))
            );
            SecurityContextHolder.getContext().setAuthentication(auth);
            log.debug("[sync] API-KEY accepted for {}", path);
        } else if (provided != null) {
            log.warn("[sync] API-KEY mismatch on {} (header present, value rejected)", path);
            // Pas de short-circuit : on laisse Spring Security rendre le 401/403 propre
            // (cohérent avec le reste des refus auth).
        }

        chain.doFilter(req, res);
    }

    /**
     * Comparaison en temps constant. MessageDigest.isEqual fait le job depuis Java 7.
     * Les deux strings doivent être encodées de la même façon pour que la longueur
     * soit représentative (ici UTF-8).
     */
    private static boolean constantTimeEquals(String a, String b) {
        byte[] ba = a.getBytes(StandardCharsets.UTF_8);
        byte[] bb = b.getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(ba, bb);
    }
}
