package com.kidzpos.config;

import com.kidzpos.domain.*;
import com.kidzpos.repo.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Component
public class DataInitializer implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(DataInitializer.class);

    private final UserRepository users;
    private final StoreRepository stores;
    private final SettingsRepository settings;
    private final PasswordEncoder encoder;

    public DataInitializer(UserRepository users, StoreRepository stores,
                           SettingsRepository settings, PasswordEncoder encoder) {
        this.users = users; this.stores = stores;
        this.settings = settings; this.encoder = encoder;
    }

    @Override
    public void run(String... args) {
        if (stores.count() == 0) {
            stores.save(Store.builder().id("s1").name("Magasin A").location("Centre-ville").build());
            stores.save(Store.builder().id("s2").name("Magasin B").location("Banlieue").build());
        }

        if (users.count() == 0) {
            String adminPwd = resolvePassword("KIDZPOS_ADMIN_PASSWORD", "admin@kidzpos.com");
            String sarahPwd = resolvePassword("KIDZPOS_SARAH_PASSWORD", "sarah@kidzpos.com");
            String karimPwd = resolvePassword("KIDZPOS_KARIM_PASSWORD", "karim@kidzpos.com");

            users.save(User.builder().id("u1").name("Admin Principal").email("admin@kidzpos.com")
                    .passwordHash(encoder.encode(adminPwd)).role(Role.ADMIN).active(true).build());
            users.save(User.builder().id("u2").name("Sarah (Magasin A)").email("sarah@kidzpos.com")
                    .passwordHash(encoder.encode(sarahPwd)).role(Role.EMPLOYEE).storeId("s1").active(true).build());
            users.save(User.builder().id("u3").name("Karim (Magasin B)").email("karim@kidzpos.com")
                    .passwordHash(encoder.encode(karimPwd)).role(Role.EMPLOYEE).storeId("s2").active(true).build());
        }

        if (settings.count() == 0) {
            settings.save(Settings.builder().id(1L)
                    .taxRate(20).maxDiscountPercent(10)
                    .pointsPerEuro(1).euroPerPoint(0.05)
                    .shopName("KidzPOS").currency("AR").build());
        }
    }

    /**
     * Reads a password from an environment variable. If absent, generates a random UUID
     * and writes it once to STDOUT (jamais dans les logs persistés — risque fuite).
     * L'opérateur DOIT le copier au démarrage et le changer après première connexion.
     */
    private String resolvePassword(String envVar, String userEmail) {
        String pwd = System.getenv(envVar);
        if (pwd == null || pwd.isBlank()) {
            pwd = UUID.randomUUID().toString();
            // M2 : on n'envoie PAS le password dans les logs (logback peut être archivé/expédié).
            // STDOUT direct → visible au démarrage interactif, pas dans les logs structurés.
            System.out.println("============================================================");
            System.out.println("⚠ INITIAL PASSWORD GENERATED for " + userEmail);
            System.out.println("  password = " + pwd);
            System.out.println("  → Set env var " + envVar + " to suppress this message.");
            System.out.println("  → Change this password after first login.");
            System.out.println("============================================================");
            log.warn("Env var {} not set. Initial password generated for {} (printed to STDOUT only).", envVar, userEmail);
        }
        return pwd;
    }
}
