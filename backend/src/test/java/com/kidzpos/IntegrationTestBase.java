package com.kidzpos;

import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.test.context.ActiveProfiles;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

/**
 * Base pour les tests d'intégration : démarre un Postgres réel via TestContainers,
 * branche le DataSource Spring dessus via @ServiceConnection.
 *
 * Hibernate exécute Flyway sur le container fraîchement créé → schéma validé
 * de bout en bout.
 *
 * Le container est singleton (static) → partagé entre toutes les classes de test
 * de la JVM : évite le coût de démarrage par classe. Chaque test TRUNCATE
 * les tables qu'il touche.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
@ActiveProfiles("test")
public abstract class IntegrationTestBase {

    static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>(DockerImageName.parse("postgres:15-alpine"))
                .withDatabaseName("kidzpos_test")
                .withUsername("kidzpos")
                .withPassword("kidzpos")
                .withReuse(true);
        POSTGRES.start();
    }

    @TestConfiguration
    static class TestConfig {
        @Bean
        @ServiceConnection
        PostgreSQLContainer<?> postgresContainer() {
            return POSTGRES;
        }
    }
}
