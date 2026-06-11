package net.sailmc.gateway.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class SailGatewayConfigTest {
    @TempDir
    Path tempDir;

    @Test
    void loadsDocumentedVelocityYamlShape() throws Exception {
        Path configPath = tempDir.resolve("config.yml");
        Files.writeString(
                configPath,
                """
                sail:
                  registry:
                    mode: self-hosted
                    api-url: "http://127.0.0.1:8787"
                    registry-id: "my-network"
                    public-key-pinning: false
                    trusted-keys:
                      - kid: "dev-es256-2026-06"
                        alg: "ES256"
                        crv: "P-256"
                        x: "0WamuH-EnCrBXIQwPZo2ZKfwNV9OW9EDkzr4YzscxcY"
                        y: "0wFxw0l_9Rziux_ZQboPeCkBi5oLibu_5GocXtVUURo"

                  server:
                    id: "local-survival"
                    display-name: "Local Survival"

                  login-flow:
                    unauthenticated-action: kick
                    auth-timeout-seconds: 90
                    allow-rejoin-after-auth: true
                    auth-url-template: "http://127.0.0.1:8787/auth/minecraft?code={code}"

                  backend:
                    require-modern-forwarding: true
                    fail-if-forwarding-secret-missing: true
                    target-server: "survival"

                  limbo:
                    poll-interval-seconds: 2
                """);

        SailGatewayConfig config = SailGatewayConfig.load(configPath);

        assertEquals("local-dev", config.trustPosture());
        assertEquals("self-hosted", config.registry().mode());
        assertEquals(URI.create("http://127.0.0.1:8787"), config.registry().apiUrl());
        assertEquals("my-network", config.registry().registryId());
        assertFalse(config.registry().publicKeyPinning());
        assertEquals(1, config.registry().trustedKeys().size());
        SailGatewayConfig.TrustedKey key = config.registry().trustedKeys().getFirst();
        assertEquals("dev-es256-2026-06", key.kid());
        assertEquals("ES256", key.alg());
        assertEquals("P-256", key.crv());
        assertEquals("0WamuH-EnCrBXIQwPZo2ZKfwNV9OW9EDkzr4YzscxcY", key.x());
        assertEquals("0wFxw0l_9Rziux_ZQboPeCkBi5oLibu_5GocXtVUURo", key.y());
        assertEquals("local-survival", config.server().serverId());
        assertEquals("Local Survival", config.server().displayName());
        assertEquals(SailGatewayConfig.UnauthenticatedAction.KICK, config.loginFlow().unauthenticatedAction());
        assertEquals(Duration.ofSeconds(90), config.loginFlow().authTimeout());
        assertTrue(config.loginFlow().allowRejoinAfterAuth());
        assertEquals(
                "http://127.0.0.1:8787/auth/minecraft?code={code}",
                config.loginFlow().authUrlTemplate());
        assertTrue(config.backend().requireModernForwarding());
        assertTrue(config.backend().failIfForwardingSecretMissing());
        assertEquals("survival", config.backend().targetServer());
        assertEquals(Duration.ofSeconds(2), config.limbo().pollInterval());
    }

    @Test
    void defaultsToLocalDevKickMode() {
        SailGatewayConfig config = SailGatewayConfig.defaults();

        assertEquals("local-dev", config.trustPosture());
        assertEquals("self-hosted", config.registry().mode());
        assertEquals(URI.create("http://127.0.0.1:8787"), config.registry().apiUrl());
        assertEquals("sail-local", config.registry().registryId());
        assertFalse(config.registry().publicKeyPinning());
        assertEquals(0, config.registry().trustedKeys().size());
        assertEquals(SailGatewayConfig.UnauthenticatedAction.KICK, config.loginFlow().unauthenticatedAction());
        assertEquals("local-survival", config.backend().targetServer());
        assertEquals(Duration.ofSeconds(2), config.limbo().pollInterval());
    }

    @Test
    void rejectsGlobalPostureWithoutPinnedKeys() throws Exception {
        Path configPath = tempDir.resolve("global-unpinned.yml");
        Files.writeString(
                configPath,
                """
                sail:
                  trust-posture: "global"
                  registry:
                    mode: "global"
                    api-url: "https://sail.creepers.sbs"
                    registry-id: "sail-global"
                    public-key-pinning: false
                    trusted-keys: []
                """);

        IllegalArgumentException error = org.junit.jupiter.api.Assertions.assertThrows(
                IllegalArgumentException.class,
                () -> SailGatewayConfig.load(configPath));
        assertTrue(error.getMessage().contains("global trust posture requires public-key-pinning"));
    }

    @Test
    void rejectsGlobalPostureWithPinningButNoTrustedKeys() throws Exception {
        Path configPath = tempDir.resolve("global-empty-keys.yml");
        Files.writeString(
                configPath,
                """
                sail:
                  trust-posture: "global"
                  registry:
                    mode: "global"
                    api-url: "https://sail.creepers.sbs"
                    registry-id: "sail-global"
                    public-key-pinning: true
                    trusted-keys: []
                """);

        IllegalArgumentException error = org.junit.jupiter.api.Assertions.assertThrows(
                IllegalArgumentException.class,
                () -> SailGatewayConfig.load(configPath));
        assertTrue(error.getMessage().contains("global trust posture requires public-key-pinning"));
    }

    @Test
    void rejectsGlobalPostureWithTrustedKeysButPinningDisabled() throws Exception {
        Path configPath = tempDir.resolve("global-unpinned-key.yml");
        Files.writeString(configPath, globalConfigYaml("global", false));

        IllegalArgumentException error = org.junit.jupiter.api.Assertions.assertThrows(
                IllegalArgumentException.class,
                () -> SailGatewayConfig.load(configPath));
        assertTrue(error.getMessage().contains("global trust posture requires public-key-pinning"));
    }

    @Test
    void normalizesGlobalPostureAndRequiresPinnedKeys() throws Exception {
        Path configPath = tempDir.resolve("global-pinned.yml");
        Files.writeString(configPath, globalConfigYaml(" Global ", true));

        SailGatewayConfig config = SailGatewayConfig.load(configPath);

        assertEquals("global", config.trustPosture());
        assertTrue(config.registry().publicKeyPinning());
        assertEquals(1, config.registry().trustedKeys().size());
        assertDevTrustedKey(config.registry().trustedKeys().getFirst());
    }

    @Test
    void rejectsUnsupportedTrustPosture() throws Exception {
        Path configPath = tempDir.resolve("unsupported-posture.yml");
        Files.writeString(configPath, globalConfigYaml("globla", true));

        IllegalArgumentException error = org.junit.jupiter.api.Assertions.assertThrows(
                IllegalArgumentException.class,
                () -> SailGatewayConfig.load(configPath));
        assertTrue(error.getMessage().contains("Unsupported trust-posture"));
    }

    @Test
    void rejectsRegistryApiUrlWithoutHttpScheme() throws Exception {
        Path configPath = tempDir.resolve("file-registry-url.yml");
        Files.writeString(
                configPath,
                """
                sail:
                  registry:
                    mode: "self-hosted"
                    api-url: "file:///tmp/sail-registry"
                    registry-id: "sail-local"
                """);

        IllegalArgumentException error = org.junit.jupiter.api.Assertions.assertThrows(
                IllegalArgumentException.class,
                () -> SailGatewayConfig.load(configPath));
        assertTrue(error.getMessage().contains("registry api-url must use http or https"));
    }

    @Test
    void rejectsBlankRegistryIdentity() throws Exception {
        Path configPath = tempDir.resolve("blank-registry-id.yml");
        Files.writeString(
                configPath,
                """
                sail:
                  registry:
                    mode: "self-hosted"
                    api-url: "http://127.0.0.1:8787"
                    registry-id: "   "
                """);

        IllegalArgumentException error = org.junit.jupiter.api.Assertions.assertThrows(
                IllegalArgumentException.class,
                () -> SailGatewayConfig.load(configPath));
        assertTrue(error.getMessage().contains("registry-id must not be blank"));
    }

    @Test
    void rejectsInvalidAuthTimeout() throws Exception {
        Path configPath = tempDir.resolve("invalid-timeout.yml");
        Files.writeString(
                configPath,
                """
                sail:
                  login-flow:
                    unauthenticated-action: kick
                    auth-timeout-seconds: 0
                    auth-url-template: "http://127.0.0.1:8787/auth/minecraft?code={code}"
                """);

        IllegalArgumentException error = org.junit.jupiter.api.Assertions.assertThrows(
                IllegalArgumentException.class,
                () -> SailGatewayConfig.load(configPath));
        assertTrue(error.getMessage().contains("auth-timeout-seconds must be positive"));
    }

    @Test
    void rejectsAuthUrlTemplateWithoutCodePlaceholder() throws Exception {
        Path configPath = tempDir.resolve("invalid-auth-url-template.yml");
        Files.writeString(
                configPath,
                """
                sail:
                  login-flow:
                    unauthenticated-action: kick
                    auth-timeout-seconds: 180
                    auth-url-template: "http://127.0.0.1:8787/auth/minecraft"
                """);

        IllegalArgumentException error = org.junit.jupiter.api.Assertions.assertThrows(
                IllegalArgumentException.class,
                () -> SailGatewayConfig.load(configPath));
        assertTrue(error.getMessage().contains("auth-url-template must contain {code}"));
    }

    @Test
    void rejectsExplicitBlankBackendTargetServer() throws Exception {
        Path configPath = tempDir.resolve("blank-backend-target.yml");
        Files.writeString(
                configPath,
                """
                sail:
                  backend:
                    require-modern-forwarding: true
                    fail-if-forwarding-secret-missing: true
                    target-server: "   "
                """);

        IllegalArgumentException error = org.junit.jupiter.api.Assertions.assertThrows(
                IllegalArgumentException.class,
                () -> SailGatewayConfig.load(configPath));
        assertTrue(error.getMessage().contains("target-server must not be blank"));
    }

    @Test
    void rejectsIncompleteTrustedKeyMaterial() throws Exception {
        Path configPath = tempDir.resolve("incomplete-trusted-key.yml");
        Files.writeString(
                configPath,
                """
                sail:
                  trust-posture: "global"
                  registry:
                    mode: "global"
                    api-url: "https://sail.creepers.sbs"
                    registry-id: "sail-global"
                    public-key-pinning: true
                    trusted-keys:
                      - kid: ""
                        alg: "ES256"
                        crv: "P-256"
                        x: "0WamuH-EnCrBXIQwPZo2ZKfwNV9OW9EDkzr4YzscxcY"
                        y: "0wFxw0l_9Rziux_ZQboPeCkBi5oLibu_5GocXtVUURo"
                """);

        IllegalArgumentException error = org.junit.jupiter.api.Assertions.assertThrows(
                IllegalArgumentException.class,
                () -> SailGatewayConfig.load(configPath));
        assertTrue(error.getMessage().contains("trusted key kid must not be blank"));
    }

    @Test
    void rejectsBlankTrustPostureWhenExplicitlyConfigured() throws Exception {
        Path configPath = tempDir.resolve("blank-posture.yml");
        Files.writeString(configPath, globalConfigYaml("   ", true));

        IllegalArgumentException error = org.junit.jupiter.api.Assertions.assertThrows(
                IllegalArgumentException.class,
                () -> SailGatewayConfig.load(configPath));
        assertTrue(error.getMessage().contains("Unsupported trust-posture"));
    }

    @Test
    void rejectsEmptyTrustPostureWhenExplicitlyConfigured() throws Exception {
        Path configPath = tempDir.resolve("empty-posture.yml");
        Files.writeString(
                configPath,
                """
                sail:
                  trust-posture:
                  registry:
                    mode: "global"
                    api-url: "https://sail.creepers.sbs"
                    registry-id: "sail-global"
                    public-key-pinning: true
                    trusted-keys:
                      - kid: "dev-es256-2026-06"
                        alg: "ES256"
                        crv: "P-256"
                        x: "0WamuH-EnCrBXIQwPZo2ZKfwNV9OW9EDkzr4YzscxcY"
                        y: "0wFxw0l_9Rziux_ZQboPeCkBi5oLibu_5GocXtVUURo"
                """);

        IllegalArgumentException error = org.junit.jupiter.api.Assertions.assertThrows(
                IllegalArgumentException.class,
                () -> SailGatewayConfig.load(configPath));
        assertTrue(error.getMessage().contains("Unsupported trust-posture"));
    }

    @Test
    void loadInheritsDefaultTrustedKeysWhenTrustedKeysAreMissing() throws Exception {
        Path configPath = tempDir.resolve("partial-config.yml");
        Files.writeString(
                configPath,
                """
                sail:
                  registry:
                    mode: self-hosted
                    api-url: "http://127.0.0.1:8787"
                    registry-id: "my-network"

                  server:
                    id: "local-survival"
                    display-name: "Local Survival"
                """);

        SailGatewayConfig config = SailGatewayConfig.load(configPath);

        assertFalse(config.registry().publicKeyPinning());
        assertEquals(0, config.registry().trustedKeys().size());
    }

    @Test
    void loadKeepsExplicitEmptyTrustedKeysUnderPinnedConfig() throws Exception {
        Path configPath = tempDir.resolve("empty-trusted-keys.yml");
        Files.writeString(
                configPath,
                """
                sail:
                  registry:
                    mode: self-hosted
                    api-url: "http://127.0.0.1:8787"
                    registry-id: "my-network"
                    public-key-pinning: true
                    trusted-keys: []
                """);

        SailGatewayConfig config = SailGatewayConfig.load(configPath);

        assertTrue(config.registry().publicKeyPinning());
        assertEquals(0, config.registry().trustedKeys().size());
    }

    @Test
    void defaultYamlIncludesConfiguredServerIdentity() throws Exception {
        Path configPath = tempDir.resolve("config.yml");
        SailGatewayConfig.writeDefault(configPath);

        String yaml = Files.readString(configPath);
        assertTrue(yaml.contains("  trust-posture: \"local-dev\"\n"));
        assertTrue(yaml.contains("    mode: \"self-hosted\"\n"));
        assertTrue(yaml.contains("    api-url: \"http://127.0.0.1:8787\"\n"));
        assertTrue(yaml.contains("    registry-id: \"sail-local\"\n"));
        assertTrue(yaml.contains("    public-key-pinning: false\n"));
        assertTrue(yaml.contains("    trusted-keys: []\n"));
        assertTrue(yaml.contains("  server:\n"));
        assertTrue(yaml.contains("    id: \"local-survival\"\n"));
        assertTrue(yaml.contains("    display-name: \"Local Survival\"\n"));
        assertTrue(yaml.contains("    auth-url-template: \"http://127.0.0.1:8787/auth/minecraft?code={code}\"\n"));
        assertTrue(yaml.contains("    target-server: \"local-survival\"\n"));
        assertTrue(yaml.contains("  limbo:\n"));
        assertTrue(yaml.contains("    poll-interval-seconds: 2\n"));

        SailGatewayConfig config = SailGatewayConfig.load(configPath);
        assertEquals("local-dev", config.trustPosture());
        assertEquals("self-hosted", config.registry().mode());
        assertEquals(URI.create("http://127.0.0.1:8787"), config.registry().apiUrl());
        assertEquals("sail-local", config.registry().registryId());
        assertFalse(config.registry().publicKeyPinning());
        assertEquals(0, config.registry().trustedKeys().size());
        assertEquals("local-survival", config.server().serverId());
        assertEquals("Local Survival", config.server().displayName());
        assertEquals("local-survival", config.backend().targetServer());
        assertEquals(Duration.ofSeconds(2), config.limbo().pollInterval());
    }

    private static void assertDevTrustedKey(SailGatewayConfig.TrustedKey key) {
        assertEquals("dev-es256-2026-06", key.kid());
        assertEquals("ES256", key.alg());
        assertEquals("P-256", key.crv());
        assertEquals("0WamuH-EnCrBXIQwPZo2ZKfwNV9OW9EDkzr4YzscxcY", key.x());
        assertEquals("0wFxw0l_9Rziux_ZQboPeCkBi5oLibu_5GocXtVUURo", key.y());
    }

    private static String globalConfigYaml(String trustPosture, boolean publicKeyPinning) {
        return """
                sail:
                  trust-posture: "%s"
                  registry:
                    mode: "global"
                    api-url: "https://sail.creepers.sbs"
                    registry-id: "sail-global"
                    public-key-pinning: %s
                    trusted-keys:
                      - kid: "dev-es256-2026-06"
                        alg: "ES256"
                        crv: "P-256"
                        x: "0WamuH-EnCrBXIQwPZo2ZKfwNV9OW9EDkzr4YzscxcY"
                        y: "0wFxw0l_9Rziux_ZQboPeCkBi5oLibu_5GocXtVUURo"
                """.formatted(trustPosture, publicKeyPinning);
    }
}
