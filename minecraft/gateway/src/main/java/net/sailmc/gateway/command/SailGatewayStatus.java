package net.sailmc.gateway.command;

import java.net.URI;

public record SailGatewayStatus(
        boolean initialized,
        String registryId,
        URI registryApiUrl,
        String loginMode,
        int pendingChallenges,
        int activeSessions,
        String registryHealth,
        String lastError) {
    public static SailGatewayStatus uninitialized(String lastError) {
        return new SailGatewayStatus(
                false,
                "",
                URI.create("http://127.0.0.1"),
                "",
                0,
                0,
                "unknown",
                lastError);
    }
}
