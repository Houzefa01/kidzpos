package com.kidzpos.security;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * Centralise le format du cookie refresh : nom, path, attributs sécurité, lifetime.
 *
 * Defaults pensés pour LAN (HTTP) :
 *   secure = false, sameSite = Lax, path = /api/auth
 *
 * En prod publique (HTTPS via reverse-proxy), exporter :
 *   KIDZPOS_AUTH_COOKIE_SECURE=true
 *   KIDZPOS_AUTH_COOKIE_SAME_SITE=Strict
 *
 * Cross-origin XHR (HTTPS uniquement) : SameSite=None + Secure=true.
 */
@Component
public class RefreshCookie {

    public static final String NAME = "kidzpos_rt";
    public static final String PATH = "/api/auth";

    private final boolean secure;
    private final String sameSite;
    private final long maxAgeSec;

    public RefreshCookie(
            @Value("${kidzpos.auth.cookie-secure:false}") boolean secure,
            @Value("${kidzpos.auth.cookie-same-site:Lax}") String sameSite,
            @Value("${kidzpos.auth.refresh-token-days:30}") long days) {
        this.secure = secure;
        this.sameSite = sameSite;
        this.maxAgeSec = Duration.ofDays(days).toSeconds();
    }

    public void set(HttpServletResponse res, String cleartext) {
        ResponseCookie cookie = ResponseCookie.from(NAME, cleartext)
                .httpOnly(true)
                .secure(secure)
                .sameSite(sameSite)
                .path(PATH)
                .maxAge(maxAgeSec)
                .build();
        res.addHeader("Set-Cookie", cookie.toString());
    }

    public void clear(HttpServletResponse res) {
        ResponseCookie cookie = ResponseCookie.from(NAME, "")
                .httpOnly(true)
                .secure(secure)
                .sameSite(sameSite)
                .path(PATH)
                .maxAge(0)
                .build();
        res.addHeader("Set-Cookie", cookie.toString());
    }

    public String read(HttpServletRequest req) {
        Cookie[] cookies = req.getCookies();
        if (cookies == null) return null;
        for (Cookie c : cookies) {
            if (NAME.equals(c.getName())) return c.getValue();
        }
        return null;
    }
}
