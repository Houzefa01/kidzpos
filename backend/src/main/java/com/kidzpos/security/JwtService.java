package com.kidzpos.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.Map;

@Component
public class JwtService {

    private final SecretKey key;
    private final long expirationMs;

    public JwtService(@Value("${kidzpos.jwt.secret}") String secret,
                      @Value("${kidzpos.jwt.expiration-hours:0}") long hours,
                      @Value("${kidzpos.auth.access-token-minutes:0}") long minutes) {
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        // Préfère access-token-minutes (P2). Fallback expiration-hours pour rétrocompat
        // avec d'anciens .env. Si rien → 15 min (recommandation P2).
        long ms = minutes > 0 ? minutes * 60_000L
                : hours > 0 ? hours * 3600_000L
                : 15 * 60_000L;
        this.expirationMs = ms;
    }

    public String generate(String userId, String email, String role, String storeId) {
        Date now = new Date();
        return Jwts.builder()
                .subject(userId)
                .claims(Map.of(
                        "email", email,
                        "role", role,
                        "storeId", storeId == null ? "" : storeId
                ))
                .issuedAt(now)
                .expiration(new Date(now.getTime() + expirationMs))
                .signWith(key)
                .compact();
    }

    public Claims parse(String token) {
        return Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
    }
}
