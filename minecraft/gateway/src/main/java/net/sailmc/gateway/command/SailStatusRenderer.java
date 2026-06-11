package net.sailmc.gateway.command;

public final class SailStatusRenderer {
    private SailStatusRenderer() {}

    public static String render(SailGatewayStatus status) {
        if (!status.initialized()) {
            return """
                    Sail Gateway: not initialized
                    Registry health: unknown
                    Last error: %s
                    """.formatted(nullToUnknown(status.lastError())).stripTrailing();
        }

        return """
                Sail Gateway: initialized
                Registry: %s (%s)
                Trust posture: %s
                Public key pinning: %s
                Trusted keys: %d
                Login mode: %s
                Backend target: %s
                Auth timeout: %ds
                Limbo poll interval: %ds
                LimboAPI: %s
                Waiting limbo players: %d
                Pending challenges: %d
                Active sessions: %d
                Registry health: %s
                """.formatted(
                status.registryId(),
                status.registryApiUrl(),
                status.trustPosture(),
                status.publicKeyPinning(),
                status.trustedKeyCount(),
                status.loginMode(),
                status.backendTargetServer(),
                status.authTimeoutSeconds(),
                status.limboPollIntervalSeconds(),
                limboApiStatus(status),
                status.waitingLimboPlayers(),
                status.pendingChallenges(),
                status.activeSessions(),
                status.registryHealth()).stripTrailing();
    }

    private static String nullToUnknown(String value) {
        return value == null || value.isBlank() ? "unknown" : value;
    }

    private static String limboApiStatus(SailGatewayStatus status) {
        if (!status.limboApiRequired()) {
            return "not required";
        }
        return status.limboApiAvailable() ? "required and available" : "required but unavailable";
    }
}
