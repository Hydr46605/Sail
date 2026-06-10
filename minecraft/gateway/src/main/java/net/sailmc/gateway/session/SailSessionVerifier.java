package net.sailmc.gateway.session;

import java.util.UUID;

@FunctionalInterface
public interface SailSessionVerifier {
    VerifiedSailSession verify(String sessionToken, String expectedCanonicalName, UUID expectedMinecraftUuid)
            throws SailSessionTokenVerifier.VerificationException;
}
