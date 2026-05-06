package com.kidzpos.web;

import com.kidzpos.domain.Role;
import com.kidzpos.domain.User;
import com.kidzpos.dto.Dtos.*;
import com.kidzpos.repo.UserRepository;
import com.kidzpos.security.JwtService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final UserRepository users;
    private final PasswordEncoder encoder;
    private final JwtService jwt;

    public AuthController(UserRepository users, PasswordEncoder encoder, JwtService jwt) {
        this.users = users; this.encoder = encoder; this.jwt = jwt;
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@Valid @RequestBody LoginReq req) {
        var user = users.findByEmailIgnoreCase(req.email().trim()).orElse(null);
        if (user == null || !user.isActive() || !encoder.matches(req.password(), user.getPasswordHash())) {
            return ResponseEntity.status(401).body(java.util.Map.of("error", "Identifiants invalides"));
        }
        String token = jwt.generate(user.getId(), user.getEmail(), user.getRole().name(), user.getStoreId());
        return ResponseEntity.ok(new LoginRes(token, toRes(user)));
    }

    static UserRes toRes(User u) {
        return new UserRes(u.getId(), u.getName(), u.getEmail(), u.getRole().name(), u.getStoreId(), u.isActive());
    }
}
