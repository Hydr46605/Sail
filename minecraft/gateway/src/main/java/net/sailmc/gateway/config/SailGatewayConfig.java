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
        String trustPosture,
        Registry registry,
        Server server,
        LoginFlow loginFlow,
        Backend backend,
        Limbo limbo) {
    private static final URI LOCAL_REGISTRY_API_URL = URI.create("http://127.0.0.1:8787");
    private static final String LOCAL_REGISTRY_AUTH_URL = "http://127.0.0.1:8787/auth/minecraft?code={code}";
    private static final String LOCAL_REGISTRY_ID = "sail-local";

    public SailGatewayConfig(Registry registry, LoginFlow loginFlow, Backend backend) {
        this("local-dev", registry, defaultServer(), loginFlow, backend, defaultLimbo());
    }

    public SailGatewayConfig(Registry registry, Server server, LoginFlow loginFlow, Backend backend) {
        this("local-dev", registry, server, loginFlow, backend, defaultLimbo());
    }

    public SailGatewayConfig(
            String trustPosture,
            Registry registry,
            Server server,
            LoginFlow loginFlow,
            Backend backend) {
        this(trustPosture, registry, server, loginFlow, backend, defaultLimbo());
    }

    public SailGatewayConfig {
        trustPosture = normalizeTrustPosture(trustPosture);
        server = server == null ? defaultServer() : server;
        backend = normalizeBackend(backend, server.serverId());
        limbo = normalizeLimbo(limbo);
        if ("global".equals(trustPosture)
                && (!registry.publicKeyPinning() || registry.trustedKeys().isEmpty())) {
            throw new IllegalArgumentException(
                    "global trust posture requires public-key-pinning and at least one trusted key");
        }
    }

    public static SailGatewayConfig defaults() {
        Server server = defaultServer();
        return new SailGatewayConfig(
                "local-dev",
                new Registry("self-hosted", LOCAL_REGISTRY_API_URL, LOCAL_REGISTRY_ID, false, List.of()),
                server,
                new LoginFlow(
                        UnauthenticatedAction.KICK,
                        Duration.ofSeconds(180),
                        true,
                        LOCAL_REGISTRY_AUTH_URL),
                defaultBackend(server),
                defaultLimbo());
    }

    public static SailGatewayConfig load(Path path) throws IOException {
        ConfigurationNode sail = YamlConfigurationLoader.builder()
                .path(path)
                .build()
                .load()
                .node("sail");
        SailGatewayConfig defaults = defaults();
        return new SailGatewayConfig(
                loadTrustPosture(path, sail, defaults.trustPosture()),
                loadRegistry(sail.node("registry"), defaults.registry()),
                loadServer(sail.node("server"), defaults.server()),
                loadLoginFlow(sail.node("login-flow"), defaults.loginFlow()),
                loadBackend(sail.node("backend"), defaults.backend()),
                loadLimbo(sail.node("limbo"), defaults.limbo()));
    }

    public static void writeDefault(Path path) throws IOException {
        if (path.getParent() != null) {
            Files.createDirectories(path.getParent());
        }
        Files.writeString(path, defaultYaml());
    }

    public static String defaultYaml() {
        SailGatewayConfig config = defaults();
        return """
                sail:
                  trust-posture: "%s"

                  registry:
                    mode: "%s"
                    api-url: "%s"
                    registry-id: "%s"
                    public-key-pinning: %s
                %s

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
                    target-server: "%s"

                  limbo:
                    poll-interval-seconds: %d
                """.formatted(
                config.trustPosture(),
                config.registry().mode(),
                config.registry().apiUrl(),
                config.registry().registryId(),
                config.registry().publicKeyPinning(),
                trustedKeysYaml(config.registry().trustedKeys()),
                config.server().serverId(),
                config.server().displayName(),
                config.loginFlow().unauthenticatedAction().wireValue(),
                config.loginFlow().authTimeout().toSeconds(),
                config.loginFlow().allowRejoinAfterAuth(),
                config.loginFlow().authUrlTemplate(),
                config.backend().requireModernForwarding(),
                config.backend().failIfForwardingSecretMissing(),
                config.backend().targetServer(),
                config.limbo().pollInterval().toSeconds());
    }

    private static Server defaultServer() {
        return new Server("local-survival", "Local Survival");
    }

    private static Backend defaultBackend(Server server) {
        return new Backend(true, true, server.serverId());
    }

    private static Limbo defaultLimbo() {
        return new Limbo(Duration.ofSeconds(2));
    }

    private static String loadTrustPosture(Path path, ConfigurationNode sail, String defaultValue) throws IOException {
        if (hasExplicitEmptyTrustPosture(path)) {
            return "";
        }
        return sail.node("trust-posture").getString(defaultValue);
    }

    private static boolean hasExplicitEmptyTrustPosture(Path path) throws IOException {
        for (String line : Files.readAllLines(path)) {
            String stripped = line.stripLeading();
            if (stripped.startsWith("#")) {
                continue;
            }
            int commentIndex = stripped.indexOf('#');
            String withoutComment = commentIndex >= 0 ? stripped.substring(0, commentIndex) : stripped;
            if (withoutComment.matches("trust-posture\\s*:\\s*")) {
                return true;
            }
        }
        return false;
    }

    private static String normalizeTrustPosture(String value) {
        if (value == null) {
            return "local-dev";
        }
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        if ("local-dev".equals(normalized) || "global".equals(normalized)) {
            return normalized;
        }
        throw new IllegalArgumentException("Unsupported trust-posture: " + value);
    }

    private static String trustedKeysYaml(List<TrustedKey> trustedKeys) {
        if (trustedKeys.isEmpty()) {
            return "    trusted-keys: []";
        }

        StringBuilder yaml = new StringBuilder("    trusted-keys:\n");
        for (TrustedKey trustedKey : trustedKeys) {
            yaml.append("""
                      - kid: "%s"
                        alg: "%s"
                        crv: "%s"
                        x: "%s"
                        y: "%s"
                """.formatted(
                    trustedKey.kid(),
                    trustedKey.alg(),
                    trustedKey.crv(),
                    trustedKey.x(),
                    trustedKey.y()));
        }
        return yaml.toString().stripTrailing();
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
                node.node("fail-if-forwarding-secret-missing").getBoolean(defaults.failIfForwardingSecretMissing()),
                node.node("target-server").getString(defaults.targetServer()));
    }

    private static Limbo loadLimbo(ConfigurationNode node, Limbo defaults) {
        return new Limbo(Duration.ofSeconds(
                node.node("poll-interval-seconds").getLong(defaults.pollInterval().toSeconds())));
    }

    private static Backend normalizeBackend(Backend backend, String fallbackTargetServer) {
        if (backend == null) {
            return new Backend(true, true, fallbackTargetServer);
        }
        String targetServer = backend.targetServer();
        if (targetServer == null || targetServer.isBlank()) {
            targetServer = fallbackTargetServer;
        }
        return new Backend(
                backend.requireModernForwarding(),
                backend.failIfForwardingSecretMissing(),
                targetServer.trim());
    }

    private static Limbo normalizeLimbo(Limbo limbo) {
        if (limbo == null) {
            return defaultLimbo();
        }
        if (limbo.pollInterval().isZero() || limbo.pollInterval().isNegative()) {
            throw new IllegalArgumentException("limbo poll interval must be positive");
        }
        return limbo;
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

    public record Backend(
            boolean requireModernForwarding,
            boolean failIfForwardingSecretMissing,
            String targetServer) {
        public Backend(boolean requireModernForwarding, boolean failIfForwardingSecretMissing) {
            this(requireModernForwarding, failIfForwardingSecretMissing, "");
        }
    }

    public record Limbo(Duration pollInterval) {}

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
