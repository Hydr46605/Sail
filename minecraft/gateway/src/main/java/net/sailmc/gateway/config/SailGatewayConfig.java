package net.sailmc.gateway.config;

import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.spongepowered.configurate.ConfigurationNode;
import org.spongepowered.configurate.yaml.YamlConfigurationLoader;

public record SailGatewayConfig(
        Registry registry,
        Server server,
        LoginFlow loginFlow,
        Backend backend) {
    private static final TrustedKey LOCAL_DEV_TRUSTED_KEY = new TrustedKey(
            "dev-es256-2026-06",
            "ES256",
            "P-256",
            "0WamuH-EnCrBXIQwPZo2ZKfwNV9OW9EDkzr4YzscxcY",
            "0wFxw0l_9Rziux_ZQboPeCkBi5oLibu_5GocXtVUURo");

    public SailGatewayConfig(Registry registry, LoginFlow loginFlow, Backend backend) {
        this(registry, defaultServer(), loginFlow, backend);
    }

    public static SailGatewayConfig defaults() {
        return new SailGatewayConfig(
                new Registry("self-hosted", URI.create("http://127.0.0.1:8787"), "my-network", true, defaultTrustedKeys()),
                defaultServer(),
                new LoginFlow(
                        UnauthenticatedAction.KICK,
                        Duration.ofSeconds(180),
                        true,
                        "http://127.0.0.1:8787/auth/minecraft?code={code}"),
                new Backend(true, true));
    }

    public static SailGatewayConfig load(Path path) throws IOException {
        ConfigurationNode sail = YamlConfigurationLoader.builder()
                .path(path)
                .build()
                .load()
                .node("sail");
        SailGatewayConfig defaults = defaults();
        return new SailGatewayConfig(
                loadRegistry(sail.node("registry"), defaults.registry()),
                loadServer(sail.node("server"), defaults.server()),
                loadLoginFlow(sail.node("login-flow"), defaults.loginFlow()),
                loadBackend(sail.node("backend"), defaults.backend()));
    }

    public static void writeDefault(Path path) throws IOException {
        if (path.getParent() != null) {
            Files.createDirectories(path.getParent());
        }
        Files.writeString(path, defaultYaml());
    }

    public static String defaultYaml() {
        SailGatewayConfig config = defaults();
        TrustedKey trustedKey = config.registry().trustedKeys().getFirst();
        return """
                sail:
                  registry:
                    mode: "%s"
                    api-url: "%s"
                    registry-id: "%s"
                    public-key-pinning: %s
                    trusted-keys:
                      - kid: "%s"
                        alg: "%s"
                        crv: "%s"
                        x: "%s"
                        y: "%s"

                  server:
                    id: "%s"
                    display-name: "%s"

                  login-flow:
                    unauthenticated-action: %s
                    auth-timeout-seconds: %d
                    allow-rejoin-after-auth: %s
                    auth-url-template: "%s"

                  backend:
                    require-modern-forwarding: %s
                    fail-if-forwarding-secret-missing: %s
                """.formatted(
                config.registry().mode(),
                config.registry().apiUrl(),
                config.registry().registryId(),
                config.registry().publicKeyPinning(),
                trustedKey.kid(),
                trustedKey.alg(),
                trustedKey.crv(),
                trustedKey.x(),
                trustedKey.y(),
                config.server().serverId(),
                config.server().displayName(),
                config.loginFlow().unauthenticatedAction().wireValue(),
                config.loginFlow().authTimeout().toSeconds(),
                config.loginFlow().allowRejoinAfterAuth(),
                config.loginFlow().authUrlTemplate(),
                config.backend().requireModernForwarding(),
                config.backend().failIfForwardingSecretMissing());
    }

    private static Server defaultServer() {
        return new Server("local-survival", "Local Survival");
    }

    private static List<TrustedKey> defaultTrustedKeys() {
        return List.of(LOCAL_DEV_TRUSTED_KEY);
    }

    private static Registry loadRegistry(ConfigurationNode node, Registry defaults) {
        return new Registry(
                node.node("mode").getString(defaults.mode()),
                URI.create(node.node("api-url").getString(defaults.apiUrl().toString())),
                node.node("registry-id").getString(defaults.registryId()),
                node.node("public-key-pinning").getBoolean(defaults.publicKeyPinning()),
                loadTrustedKeys(node, defaults.trustedKeys()));
    }

    private static List<TrustedKey> loadTrustedKeys(ConfigurationNode node, List<TrustedKey> defaults) {
        ConfigurationNode trustedKeysNode = node.node("trusted-keys");
        if (trustedKeysNode.virtual()) {
            return defaults;
        }
        List<TrustedKey> keys = new ArrayList<>();
        for (ConfigurationNode keyNode : trustedKeysNode.childrenList()) {
            keys.add(new TrustedKey(
                    keyNode.node("kid").getString(""),
                    keyNode.node("alg").getString("ES256"),
                    keyNode.node("crv").getString("P-256"),
                    keyNode.node("x").getString(""),
                    keyNode.node("y").getString("")));
        }
        return List.copyOf(keys);
    }

    private static Server loadServer(ConfigurationNode node, Server defaults) {
        return new Server(
                node.node("id").getString(defaults.serverId()),
                node.node("display-name").getString(defaults.displayName()));
    }

    private static LoginFlow loadLoginFlow(ConfigurationNode node, LoginFlow defaults) {
        return new LoginFlow(
                UnauthenticatedAction.fromWireValue(
                        node.node("unauthenticated-action").getString(defaults.unauthenticatedAction().wireValue())),
                Duration.ofSeconds(node.node("auth-timeout-seconds").getLong(defaults.authTimeout().toSeconds())),
                node.node("allow-rejoin-after-auth").getBoolean(defaults.allowRejoinAfterAuth()),
                node.node("auth-url-template").getString(defaults.authUrlTemplate()));
    }

    private static Backend loadBackend(ConfigurationNode node, Backend defaults) {
        return new Backend(
                node.node("require-modern-forwarding").getBoolean(defaults.requireModernForwarding()),
                node.node("fail-if-forwarding-secret-missing").getBoolean(defaults.failIfForwardingSecretMissing()));
    }

    public record Registry(
            String mode,
            URI apiUrl,
            String registryId,
            boolean publicKeyPinning,
            List<TrustedKey> trustedKeys) {}

    public record Server(String serverId, String displayName) {}

    public record TrustedKey(String kid, String alg, String crv, String x, String y) {}

    public record LoginFlow(
            UnauthenticatedAction unauthenticatedAction,
            Duration authTimeout,
            boolean allowRejoinAfterAuth,
            String authUrlTemplate) {}

    public record Backend(boolean requireModernForwarding, boolean failIfForwardingSecretMissing) {}

    public enum UnauthenticatedAction {
        LIMBO("limbo"),
        KICK("kick"),
        HYBRID("hybrid");

        private final String wireValue;

        UnauthenticatedAction(String wireValue) {
            this.wireValue = wireValue;
        }

        public String wireValue() {
            return wireValue;
        }

        public static UnauthenticatedAction fromWireValue(String value) {
            String normalized = value.toLowerCase(Locale.ROOT);
            for (UnauthenticatedAction action : values()) {
                if (action.wireValue.equals(normalized)) {
                    return action;
                }
            }
            throw new IllegalArgumentException("Unsupported unauthenticated-action: " + value);
        }
    }
}
