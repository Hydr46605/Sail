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
                Login mode: %s
                Pending challenges: %d
                Active sessions: %d
                Registry health: %s
                """.formatted(
                status.registryId(),
                status.registryApiUrl(),
                status.loginMode(),
                status.pendingChallenges(),
                status.activeSessions(),
                status.registryHealth()).stripTrailing();
    }

    private static String nullToUnknown(String value) {
        return value == null || value.isBlank() ? "unknown" : value;
    }
}
