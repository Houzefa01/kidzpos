package com.kidzpos.security;

import com.kidzpos.domain.User;
import com.kidzpos.repo.UserRepository;
import io.jsonwebtoken.Claims;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.Optional;

@Component
public class JwtAuthFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(JwtAuthFilter.class);

    private final JwtService jwt;
    private final UserRepository users;

    public JwtAuthFilter(JwtService jwt, UserRepository users) {
        this.jwt = jwt;
        this.users = users;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        String header = req.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            try {
                Claims c = jwt.parse(header.substring(7));
                String userId = c.getSubject();
                Optional<User> u = users.findById(userId);
                if (u.isPresent() && u.get().isActive()) {
                    User user = u.get();
                    var auth = new UsernamePasswordAuthenticationToken(
                            new AuthPrincipal(user.getId(), user.getEmail(), user.getRole().name(), user.getStoreId()),
                            null,
                            List.of(new SimpleGrantedAuthority("ROLE_" + user.getRole().name()))
                    );
                    auth.setDetails(new WebAuthenticationDetailsSource().buildDetails(req));
                    SecurityContextHolder.getContext().setAuthentication(auth);
                }
            } catch (Exception ex) {
                // M1 : tracer le motif de rejet (token expiré, signature invalide, malformé...).
                // log.debug pour ne pas spammer la prod ; le client recevra 401 via .authenticated().
                log.debug("JWT rejeté: {}", ex.getMessage());
            }
        }
        chain.doFilter(req, res);
    }

    public record AuthPrincipal(String id, String email, String role, String storeId) {}
}
