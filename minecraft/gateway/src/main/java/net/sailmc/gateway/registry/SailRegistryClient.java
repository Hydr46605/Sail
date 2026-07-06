package net.sailmc.gateway.registry;

import java.io.IOException;

public interface SailRegistryClient {
    AuthChallengeResponse createAuthChallenge(AuthChallengeRequest request) throws IOException, InterruptedException;

    AuthChallengeStatusResponse getAuthChallenge(String challengeId) throws IOException, InterruptedException;

    default SessionVerificationResponse verifySession(String serverId, String sessionToken)
            throws IOException, InterruptedException {
        throw new UnsupportedOperationException("session verification is not implemented");
    }

    RegistryHealthResponse getHealth() throws IOException, InterruptedException;

    default void heartbeat(String serverId) throws IOException, InterruptedException {
        // No-op by default. Gateways with an API key should override this.
    }
}
