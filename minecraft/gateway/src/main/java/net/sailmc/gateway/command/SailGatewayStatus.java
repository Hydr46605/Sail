package net.sailmc.gateway.command;

import java.net.URI;

public record SailGatewayStatus(
        boolean initialized,
        String registryId,
        URI registryApiUrl,
        String trustPosture,
        boolean publicKeyPinning,
        int trustedKeyCount,
        String loginMode,
        String backendTargetServer,
        long authTimeoutSeconds,
        long limboPollIntervalSeconds,
        boolean limboApiRequired,
        boolean limboApiAvailable,
        int waitingLimboPlayers,
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
                false,
                0,
                "",
                "",
                0,
                0,
                false,
                false,
                0,
                0,
                0,
                "unknown",
                lastError);
    }
}
