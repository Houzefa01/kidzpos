package com.kidzpos.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

import java.util.List;

@Configuration
public class CorsConfig {

    @Value("${kidzpos.cors.allowed-origins}")
    private String allowedOrigins;

    @Bean
    public CorsFilter corsFilter() {
        CorsConfiguration cfg = new CorsConfiguration();
        
        // Security: Never use "*" with allowCredentials=true
        // Always require explicit allowed origins in production
        if ("*".equals(allowedOrigins)) {
            cfg.addAllowedOriginPattern("*");
            cfg.setAllowCredentials(false);  // FIX: Set to false when using wildcard
        } else {
            for (String o : allowedOrigins.split(",")) {
                String origin = o.trim();
                if (origin.contains("*")) {
                    cfg.addAllowedOriginPattern(origin);
                } else {
                    cfg.addAllowedOrigin(origin);
                }
            }
            cfg.setAllowCredentials(true);  // OK: Only when using specific origins
        }
        
        cfg.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        cfg.setAllowedHeaders(List.of("*"));
        cfg.setMaxAge(3600L);
        
        UrlBasedCorsConfigurationSource src = new UrlBasedCorsConfigurationSource();
        src.registerCorsConfiguration("/**", cfg);
        return new CorsFilter(src);
    }
}

