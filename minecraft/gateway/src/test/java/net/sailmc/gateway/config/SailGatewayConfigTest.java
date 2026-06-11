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
                """);

        SailGatewayConfig config = SailGatewayConfig.load(configPath);

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
    }

    @Test
    void defaultsToKickModeForSailGlobal() {
        SailGatewayConfig config = SailGatewayConfig.defaults();

        assertEquals("global", config.registry().mode());
        assertEquals(URI.create("https://api.sail.creepers.sbs"), config.registry().apiUrl());
        assertEquals("sail-global", config.registry().registryId());
        assertFalse(config.registry().publicKeyPinning());
        assertEquals(0, config.registry().trustedKeys().size());
        assertEquals("local-survival", config.server().serverId());
        assertEquals("Local Survival", config.server().displayName());
        assertEquals(SailGatewayConfig.UnauthenticatedAction.KICK, config.loginFlow().unauthenticatedAction());
        assertEquals(Duration.ofSeconds(180), config.loginFlow().authTimeout());
        assertEquals(
                "https://api.sail.creepers.sbs/auth/minecraft?code={code}",
                config.loginFlow().authUrlTemplate());
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
        assertTrue(yaml.contains("    mode: \"global\"\n"));
        assertTrue(yaml.contains("    api-url: \"https://api.sail.creepers.sbs\"\n"));
        assertTrue(yaml.contains("    registry-id: \"sail-global\"\n"));
        assertTrue(yaml.contains("    public-key-pinning: false\n"));
        assertTrue(yaml.contains("    trusted-keys: []\n"));
        assertTrue(yaml.contains("  server:\n"));
        assertTrue(yaml.contains("    id: \"local-survival\"\n"));
        assertTrue(yaml.contains("    display-name: \"Local Survival\"\n"));
        assertTrue(yaml.contains("    auth-url-template: \"https://api.sail.creepers.sbs/auth/minecraft?code={code}\"\n"));

        SailGatewayConfig config = SailGatewayConfig.load(configPath);
        assertEquals("global", config.registry().mode());
        assertEquals(URI.create("https://api.sail.creepers.sbs"), config.registry().apiUrl());
        assertEquals("sail-global", config.registry().registryId());
        assertFalse(config.registry().publicKeyPinning());
        assertEquals(0, config.registry().trustedKeys().size());
        assertEquals("local-survival", config.server().serverId());
        assertEquals("Local Survival", config.server().displayName());
    }

    private static void assertDevTrustedKey(SailGatewayConfig.TrustedKey key) {
        assertEquals("dev-es256-2026-06", key.kid());
        assertEquals("ES256", key.alg());
        assertEquals("P-256", key.crv());
        assertEquals("0WamuH-EnCrBXIQwPZo2ZKfwNV9OW9EDkzr4YzscxcY", key.x());
        assertEquals("0wFxw0l_9Rziux_ZQboPeCkBi5oLibu_5GocXtVUURo", key.y());
    }
}
