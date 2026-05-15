package com.kidzpos.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
public class SecurityConfig {

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http, JwtAuthFilter jwtFilter,
                                           LoginRateLimitFilter loginRateLimitFilter,
                                           RefreshRateLimitFilter refreshRateLimitFilter) throws Exception {
        http
            .csrf(c -> c.disable())
            .cors(c -> {})
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(a -> a
                .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                .requestMatchers(
                    "/api/auth/**",
                    "/actuator/health",
                    // /actuator/prometheus est ouvert pour scraping. En prod : restreindre
                    // au CIDR du Prometheus via le reverse-proxy (Caddy/nginx).
                    "/actuator/prometheus",
                    "/api/events/stream"
                ).permitAll()
                // M4 : /api/exchange/refresh déclenche un appel HTTP sortant ⇒ exiger une auth
                // pour éviter qu'un client non autorisé sur le LAN ne spamme l'API externe.
                .requestMatchers(HttpMethod.POST, "/api/users/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.PUT, "/api/users/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.DELETE, "/api/users/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.PUT, "/api/settings/**").hasRole("ADMIN")
                // I3 : seules les actions destructrices/sensibles sont ADMIN-only.
                // Création produit/client : autorisée à tout authentifié (caissier).
                .requestMatchers(HttpMethod.DELETE, "/api/products/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.DELETE, "/api/customers/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.POST, "/api/stores/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.PUT, "/api/stores/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.DELETE, "/api/stores/**").hasRole("ADMIN")
                .anyRequest().authenticated()
            )
            // Les deux filtres sont placés avant le filtre canonique Spring Security
            // UsernamePasswordAuthenticationFilter (on ne peut pas référencer un filtre
            // custom comme cible). L'ordre relatif entre eux n'importe pas pour la
            // correction : rate-limit ne s'active que sur POST /api/auth/login (qui n'a
            // pas de header Authorization), et jwt ne s'active qu'avec un header.
            .addFilterBefore(loginRateLimitFilter, UsernamePasswordAuthenticationFilter.class)
            .addFilterBefore(refreshRateLimitFilter, UsernamePasswordAuthenticationFilter.class)
            .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }
}
