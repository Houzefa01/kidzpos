package com.kidzpos.security;

import com.kidzpos.security.JwtAuthFilter.AuthPrincipal;
import org.springframework.http.ResponseEntity;

import java.util.Map;

/**
 * Garde l'accès cross-store : un EMPLOYEE ne peut agir que sur SON storeId.
 * ADMIN passe partout.
 *
 * Utilitaire statique pur (pas de dépendance Spring) — utilisable depuis
 * n'importe quel contrôleur.
 *
 * Pattern d'usage :
 *   var deny = StoreAccessGuard.denyIfCrossStore(me, req.storeId());
 *   if (deny != null) return deny;
 */
public final class StoreAccessGuard {

    private StoreAccessGuard() {}

    /** True si {@code me} peut opérer sur {@code targetStoreId}. */
    public static boolean canActOn(AuthPrincipal me, String targetStoreId) {
        if (me == null) return false;
        if ("ADMIN".equals(me.role())) return true;
        return targetStoreId != null && targetStoreId.equals(me.storeId());
    }

    /**
     * Retourne 403 si l'utilisateur n'a pas les droits sur ce store, sinon {@code null}.
     * Message neutre (ne révèle pas le storeId du caller pour éviter l'énumération).
     */
    public static ResponseEntity<?> denyIfCrossStore(AuthPrincipal me, String targetStoreId) {
        if (canActOn(me, targetStoreId)) return null;
        return ResponseEntity.status(403)
                .body(Map.of("error", "Accès refusé : magasin hors de votre périmètre"));
    }
}
