package net.sailmc.gateway.session;

import java.util.UUID;

public record VerifiedSailSession(
        String sessionId,
        String accountId,
        String canonicalName,
        UUID minecraftUuid,
        String serverId,
        String scope,
        String issuer,
        String keyId) {}
