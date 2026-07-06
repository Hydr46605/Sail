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
        Limbo limbo,
        String registryFailurePolicy) {
    private static final URI LOCAL_REGISTRY_API_URL = URI.create("http://127.0.0.1:8787");
    private static final String LOCAL_REGISTRY_AUTH_URL = "http://127.0.0.1:8787/auth/minecraft?code={code}";
    private static final String LOCAL_REGISTRY_ID = "sail-local";

    public SailGatewayConfig(Registry registry, LoginFlow loginFlow, Backend backend) {
        this("local-dev", registry, defaultServer(), loginFlow, backend, defaultLimbo(), "fail_closed");
    }

    public SailGatewayConfig(Registry registry, Server server, LoginFlow loginFlow, Backend backend) {
        this("local-dev", registry, server, loginFlow, backend, defaultLimbo(), "fail_closed");
    }

    public SailGatewayConfig(
            String trustPosture,
            Registry registry,
            Server server,
            LoginFlow loginFlow,
            Backend backend) {
        this(trustPosture, registry, server, loginFlow, backend, defaultLimbo(), "fail_closed");
    }

    public SailGatewayConfig(
            String trustPosture,
            Registry registry,
            Server server,
            LoginFlow loginFlow,
            Backend backend,
            Limbo limbo) {
        this(trustPosture, registry, server, loginFlow, backend, limbo, "fail_closed");
    }

    public SailGatewayConfig {
        trustPosture = normalizeTrustPosture(trustPosture);
        registry = normalizeRegistry(registry);
        server = normalizeServer(server);
        loginFlow = normalizeLoginFlow(loginFlow);
        backend = normalizeBackend(backend, server.serverId());
        limbo = normalizeLimbo(limbo);
        registryFailurePolicy = normalizeRegistryFailurePolicy(registryFailurePolicy);
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
                new Registry("self-hosted", LOCAL_REGISTRY_API_URL, LOCAL_REGISTRY_ID, false, List.of(), ""),
                server,
                new LoginFlow(
                        UnauthenticatedAction.KICK,
                        Duration.ofSeconds(180),
                        true,
                        LOCAL_REGISTRY_AUTH_URL),
                defaultBackend(server),
                defaultLimbo(),
                "fail_closed");
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
                loadLimbo(sail.node("limbo"), defaults.limbo()),
                loadRegistryFailurePolicy(sail, defaults.registryFailurePolicy()));
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
                    api-key: "%s"

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

                  registry-failure-policy: "%s"
                """.formatted(
                config.trustPosture(),
                config.registry().mode(),
                config.registry().apiUrl(),
                config.registry().registryId(),
                config.registry().publicKeyPinning(),
                trustedKeysYaml(config.registry().trustedKeys()),
                config.registry().apiKey(),
                config.server().serverId(),
                config.server().displayName(),
                config.loginFlow().unauthenticatedAction().wireValue(),
                config.loginFlow().authTimeout().toSeconds(),
                config.loginFlow().allowRejoinAfterAuth(),
                config.loginFlow().authUrlTemplate(),
                config.backend().requireModernForwarding(),
                config.backend().failIfForwardingSecretMissing(),
                config.backend().targetServer(),
                config.limbo().pollInterval().toSeconds(),
                config.registryFailurePolicy());
    }

    private static Server defaultServer() {
        return new Server("local-survival", "Local Survival");
    }

    private static Registry defaultRegistry() {
        return new Registry("self-hosted", LOCAL_REGISTRY_API_URL, LOCAL_REGISTRY_ID, false, List.of(), "");
    }

    private static LoginFlow defaultLoginFlow() {
        return new LoginFlow(
                UnauthenticatedAction.KICK,
                Duration.ofSeconds(180),
                true,
                LOCAL_REGISTRY_AUTH_URL);
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

    private static Registry normalizeRegistry(Registry registry) {
        if (registry == null) {
            return defaultRegistry();
        }
        String mode = requireNonBlank(registry.mode(), "registry mode must not be blank");
        URI apiUrl = registry.apiUrl();
        if (apiUrl == null || apiUrl.getScheme() == null) {
            throw new IllegalArgumentException("registry api-url must use http or https");
        }
        String scheme = apiUrl.getScheme().toLowerCase(Locale.ROOT);
        if (!"http".equals(scheme) && !"https".equals(scheme)) {
            throw new IllegalArgumentException("registry api-url must use http or https");
        }
        String registryId = requireNonBlank(registry.registryId(), "registry-id must not be blank");
        List<TrustedKey> trustedKeys = registry.trustedKeys() == null
                ? List.of()
                : registry.trustedKeys().stream()
                        .map(SailGatewayConfig::normalizeTrustedKey)
                        .toList();
        String apiKey = registry.apiKey() == null ? "" : registry.apiKey().trim();
        return new Registry(mode, apiUrl, registryId, registry.publicKeyPinning(), trustedKeys, apiKey);
    }

    private static TrustedKey normalizeTrustedKey(TrustedKey key) {
        if (key == null) {
            throw new IllegalArgumentException("trusted key must not be null");
        }
        String kid = requireNonBlank(key.kid(), "trusted key kid must not be blank");
        String alg = requireNonBlank(key.alg(), "trusted key alg must not be blank");
        String crv = requireNonBlank(key.crv(), "trusted key crv must not be blank");
        String x = requireNonBlank(key.x(), "trusted key x must not be blank");
        String y = requireNonBlank(key.y(), "trusted key y must not be blank");
        if (!"ES256".equals(alg)) {
            throw new IllegalArgumentException("trusted key alg must be ES256");
        }
        if (!"P-256".equals(crv)) {
            throw new IllegalArgumentException("trusted key crv must be P-256");
        }
        return new TrustedKey(kid, alg, crv, x, y);
    }

    private static Server normalizeServer(Server server) {
        if (server == null) {
            return defaultServer();
        }
        return new Server(
                requireNonBlank(server.serverId(), "server id must not be blank"),
                requireNonBlank(server.displayName(), "server display-name must not be blank"));
    }

    private static LoginFlow normalizeLoginFlow(LoginFlow loginFlow) {
        if (loginFlow == null) {
            return defaultLoginFlow();
        }
        if (loginFlow.unauthenticatedAction() == null) {
            throw new IllegalArgumentException("unauthenticated-action must not be blank");
        }
        if (loginFlow.authTimeout() == null
                || loginFlow.authTimeout().isZero()
                || loginFlow.authTimeout().isNegative()) {
            throw new IllegalArgumentException("auth-timeout-seconds must be positive");
        }
        String authUrlTemplate = requireNonBlank(
                loginFlow.authUrlTemplate(),
                "auth-url-template must not be blank");
        if (!authUrlTemplate.contains("{code}")) {
            throw new IllegalArgumentException("auth-url-template must contain {code}");
        }
        return new LoginFlow(
                loginFlow.unauthenticatedAction(),
                loginFlow.authTimeout(),
                loginFlow.allowRejoinAfterAuth(),
                authUrlTemplate);
    }

    private static Registry loadRegistry(ConfigurationNode node, Registry defaults) {
        return new Registry(
                node.node("mode").getString(defaults.mode()),
                URI.create(node.node("api-url").getString(defaults.apiUrl().toString())),
                node.node("registry-id").getString(defaults.registryId()),
                node.node("public-key-pinning").getBoolean(defaults.publicKeyPinning()),
                loadTrustedKeys(node, defaults.trustedKeys()),
                node.node("api-key").getString(defaults.apiKey()));
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
        ConfigurationNode targetServerNode = node.node("target-server");
        String targetServer = defaults.targetServer();
        if (!targetServerNode.virtual()) {
            targetServer = targetServerNode.getString("");
            if (targetServer == null || targetServer.isBlank()) {
                throw new IllegalArgumentException("target-server must not be blank");
            }
        }
        return new Backend(
                node.node("require-modern-forwarding").getBoolean(defaults.requireModernForwarding()),
                node.node("fail-if-forwarding-secret-missing").getBoolean(defaults.failIfForwardingSecretMissing()),
                targetServer);
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

    private static String normalizeRegistryFailurePolicy(String value) {
        if (value == null) {
            return "fail_closed";
        }
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        if ("fail_closed".equals(normalized) || "fail_open".equals(normalized)) {
            return normalized;
        }
        throw new IllegalArgumentException("Unsupported registry-failure-policy: " + value);
    }

    private static String loadRegistryFailurePolicy(ConfigurationNode sail, String defaultValue) {
        return sail.node("registry-failure-policy").getString(defaultValue);
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

    private static String requireNonBlank(String value, String message) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(message);
        }
        return value.trim();
    }

    public record Registry(
            String mode,
            URI apiUrl,
            String registryId,
            boolean publicKeyPinning,
            List<TrustedKey> trustedKeys,
            String apiKey) {}

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
