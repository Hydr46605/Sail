package net.sailmc.gateway.login;

import java.util.UUID;
import net.sailmc.gateway.bridge.SailPaperIdentity;
import net.sailmc.gateway.config.SailGatewayConfig;
import net.sailmc.gateway.registry.CompletedIdentity;
import net.sailmc.gateway.session.VerifiedSailSession;

public record LocalSessionProfile(
        String canonicalName,
        String displayName,
        UUID minecraftUuid,
        String sessionToken,
        SailPaperIdentity paperIdentity) {
    public static LocalSessionProfile fromIdentity(
            SailGatewayConfig config,
            CompletedIdentity identity,
            VerifiedSailSession verifiedSession) {
        SailPaperIdentity paperIdentity = new SailPaperIdentity(
                config.registry().registryId(),
                config.server().serverId(),
                verifiedSession.sessionId(),
                identity.accountId(),
                identity.minecraftIdentityId(),
                identity.nameClaimId(),
                identity.canonicalName(),
                identity.displayName(),
                identity.minecraftUuid(),
                identity.claimType(),
                identity.identityType(),
                verifiedSession.issuer(),
                verifiedSession.keyId());
        return new LocalSessionProfile(
                identity.canonicalName(),
                identity.displayName(),
                UUID.fromString(identity.minecraftUuid()),
                identity.sessionToken(),
                paperIdentity);
    }
}
