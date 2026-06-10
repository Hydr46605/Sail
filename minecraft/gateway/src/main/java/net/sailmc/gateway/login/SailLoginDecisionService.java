package net.sailmc.gateway.login;

import java.io.IOException;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import net.sailmc.gateway.config.SailGatewayConfig;
import net.sailmc.gateway.message.KickMessageRenderer;
import net.sailmc.gateway.registry.AuthChallengeRequest;
import net.sailmc.gateway.registry.AuthChallengeResponse;
import net.sailmc.gateway.registry.AuthChallengeStatusResponse;
import net.sailmc.gateway.registry.CompletedIdentity;
import net.sailmc.gateway.registry.SailRegistryClient;
import net.sailmc.gateway.registry.SailRegistryException;
import net.sailmc.gateway.registry.SessionVerificationResponse;
import net.sailmc.gateway.session.SailSessionTokenVerifier;
import net.sailmc.gateway.session.SailSessionVerifier;
import net.sailmc.gateway.session.VerifiedSailSession;

public final class SailLoginDecisionService {
    private final SailGatewayConfig config;
    private final SailRegistryClient registryClient;
    private final SailSessionVerifier sessionVerifier;
    private final Map<String, AuthChallengeResponse> pendingChallenges = new ConcurrentHashMap<>();
    private final Map<String, LocalSessionProfile> activeSessions = new ConcurrentHashMap<>();

    public SailLoginDecisionService(SailGatewayConfig config, SailRegistryClient registryClient) {
        this(config, registryClient, new SailSessionTokenVerifier(config));
    }

    public SailLoginDecisionService(
            SailGatewayConfig config,
            SailRegistryClient registryClient,
            SailSessionVerifier sessionVerifier) {
        this.config = config;
        this.registryClient = registryClient;
        this.sessionVerifier = sessionVerifier;
    }

    public int pendingChallengeCount() {
        return pendingChallenges.size();
    }

    public int activeSessionCount() {
        return activeSessions.size();
    }

    public LoginDecision decide(String username, String connectionId) throws IOException, InterruptedException {
        if (config.loginFlow().unauthenticatedAction() == SailGatewayConfig.UnauthenticatedAction.LIMBO) {
            return LoginDecision.kick(KickMessageRenderer.unsupportedLimboMode());
        }

        String canonicalName = username.toLowerCase(Locale.ROOT);
        LocalSessionProfile activeSession = activeSessions.get(canonicalName);
        if (activeSession != null) {
            LocalProofDecision localProofDecision = verifyLocalSessionProof(canonicalName, activeSession);
            if (localProofDecision.rejection() != null) {
                activeSessions.remove(canonicalName);
                return localProofDecision.rejection();
            }
            LoginDecision sessionDecision = verifyActiveSession(canonicalName, activeSession, localProofDecision.session());
            if (sessionDecision != null) {
                activeSessions.remove(canonicalName);
                return sessionDecision;
            }
            return LoginDecision.acceptLocalProfile(activeSession);
        }

        AuthChallengeResponse pendingChallenge = pendingChallenges.get(canonicalName);
        if (pendingChallenge != null) {
            LoginDecision resumeDecision = tryResumeCompletedChallenge(canonicalName, pendingChallenge);
            if (resumeDecision != null) {
                return resumeDecision;
            }
        }

        AuthChallengeResponse challenge;
        try {
            challenge = registryClient.createAuthChallenge(new AuthChallengeRequest(
                    config.server().serverId(),
                    username,
                    connectionId,
                    "kick"));
        } catch (SailRegistryException error) {
            if (error.errorCode().filter("premium_name_required"::equals).isPresent()) {
                return LoginDecision.requirePremiumAuth();
            }
            String message = error.playerMessage()
                    .map(KickMessageRenderer::registryRejection)
                    .orElseGet(KickMessageRenderer::registryUnavailable);
            return LoginDecision.kick(message);
        } catch (IOException error) {
            return LoginDecision.kick(KickMessageRenderer.registryUnavailable());
        }
        pendingChallenges.put(canonicalName, challenge);
        return LoginDecision.kick(KickMessageRenderer.render(challenge));
    }

    private LoginDecision tryResumeCompletedChallenge(String canonicalName, AuthChallengeResponse pendingChallenge)
            throws IOException, InterruptedException {
        AuthChallengeStatusResponse status;
        try {
            status = registryClient.getAuthChallenge(pendingChallenge.challengeId());
        } catch (SailRegistryException error) {
            pendingChallenges.remove(canonicalName);
            return LoginDecision.kick(KickMessageRenderer.registryUnavailable());
        } catch (IOException error) {
            pendingChallenges.remove(canonicalName);
            return LoginDecision.kick(KickMessageRenderer.registryUnavailable());
        }

        if ("completed".equals(status.status()) && status.identity().isPresent()) {
            CompletedIdentity identity = status.identity().orElseThrow();
            if (identity.sessionToken() == null || identity.sessionToken().isBlank()) {
                pendingChallenges.remove(canonicalName);
                return null;
            }

            UUID minecraftUuid = UUID.fromString(identity.minecraftUuid());
            if (identity.canonicalName().equals(canonicalName)) {
                LocalProofDecision localProofDecision = verifyLocalSessionProof(
                        canonicalName,
                        identity.sessionToken(),
                        identity.canonicalName(),
                        minecraftUuid);
                if (localProofDecision.rejection() != null) {
                    return localProofDecision.rejection();
                }
                LocalSessionProfile profile = LocalSessionProfile.fromIdentity(config, identity, localProofDecision.session());
                LoginDecision sessionDecision = verifyActiveSession(canonicalName, profile, localProofDecision.session());
                if (sessionDecision != null) {
                    return sessionDecision;
                }
                pendingChallenges.remove(canonicalName);
                activeSessions.put(canonicalName, profile);
                return LoginDecision.acceptLocalProfile(profile);
            }
            pendingChallenges.remove(canonicalName);
            return LoginDecision.kick(KickMessageRenderer.registryUnavailable());
        }

        if ("pending".equals(status.status())) {
            return LoginDecision.kick(KickMessageRenderer.render(pendingChallenge));
        }

        pendingChallenges.remove(canonicalName);
        return null;
    }

    private LocalProofDecision verifyLocalSessionProof(String canonicalName, LocalSessionProfile profile) {
        return verifyLocalSessionProof(
                canonicalName,
                profile.sessionToken(),
                profile.canonicalName(),
                profile.minecraftUuid());
    }

    private LocalProofDecision verifyLocalSessionProof(
            String canonicalName,
            String sessionToken,
            String expectedCanonicalName,
            UUID expectedMinecraftUuid) {
        try {
            VerifiedSailSession session =
                    sessionVerifier.verify(sessionToken, expectedCanonicalName, expectedMinecraftUuid);
            return new LocalProofDecision(session, null);
        } catch (SailSessionTokenVerifier.VerificationException error) {
            pendingChallenges.remove(canonicalName);
            return new LocalProofDecision(null, LoginDecision.kick(KickMessageRenderer.registryUnavailable()));
        }
    }

    private LoginDecision verifyActiveSession(
            String canonicalName,
            LocalSessionProfile profile,
            VerifiedSailSession verifiedSession)
            throws InterruptedException {
        SessionVerificationResponse verification;
        try {
            verification = registryClient.verifySession(config.server().serverId(), profile.sessionToken());
        } catch (SailRegistryException error) {
            pendingChallenges.remove(canonicalName);
            String message = error.playerMessage()
                    .map(KickMessageRenderer::registryRejection)
                    .orElseGet(KickMessageRenderer::registryUnavailable);
            return LoginDecision.kick(message);
        } catch (IOException error) {
            pendingChallenges.remove(canonicalName);
            return LoginDecision.kick(KickMessageRenderer.registryUnavailable());
        }

        if (!verificationMatchesLocalProof(verification, verifiedSession)) {
            pendingChallenges.remove(canonicalName);
            return LoginDecision.kick(KickMessageRenderer.registryUnavailable());
        }
        return null;
    }

    private boolean verificationMatchesLocalProof(
            SessionVerificationResponse verification,
            VerifiedSailSession verifiedSession) {
        return verification != null
                && "active".equals(verification.status())
                && config.server().serverId().equals(verification.serverId())
                && optionalExpectedMatches(verifiedSession.sessionId(), verification.sessionId())
                && verifiedSession.canonicalName().equals(verification.canonicalName())
                && verifiedSession.minecraftUuid().toString().equals(verification.minecraftUuid())
                && optionalPairMatches(verification.issuerServerId(), verifiedSession.serverId());
    }

    private static boolean optionalExpectedMatches(String expected, String actual) {
        return isBlank(expected) || expected.equals(actual);
    }

    private static boolean optionalPairMatches(String left, String right) {
        return isBlank(left) || isBlank(right) || left.equals(right);
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private record LocalProofDecision(VerifiedSailSession session, LoginDecision rejection) {}
}
