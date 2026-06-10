package net.sailmc.gateway.login;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.ECDSASigner;
import com.nimbusds.jose.jwk.Curve;
import com.nimbusds.jose.jwk.ECKey;
import com.nimbusds.jose.util.Base64URL;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.io.IOException;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.Optional;
import java.util.UUID;
import net.sailmc.gateway.bridge.SailPaperIdentity;
import net.sailmc.gateway.config.SailGatewayConfig;
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
import org.junit.jupiter.api.Test;

class SailLoginDecisionServiceTest {
    private static final UUID LOCAL_UUID = UUID.fromString("00000000-0000-4000-8000-000000000001");
    private static final ECKey DEV_PRIVATE_KEY = new ECKey.Builder(
                    Curve.P_256,
                    new Base64URL("0WamuH-EnCrBXIQwPZo2ZKfwNV9OW9EDkzr4YzscxcY"),
                    new Base64URL("0wFxw0l_9Rziux_ZQboPeCkBi5oLibu_5GocXtVUURo"))
            .d(new Base64URL("cgltruyV9L4GvyWUauOeVmkPew0k1SQSc6HhAdzPAYM"))
            .keyID("dev-es256-2026-06")
            .algorithm(JWSAlgorithm.ES256)
            .build();

    @Test
    void createsKickChallengeForUnauthenticatedLocalLogin() throws Exception {
        SailGatewayConfig config = configWithServerId("gateway-survival");
        CapturingRegistryClient registry = new CapturingRegistryClient();
        SailLoginDecisionService service = new SailLoginDecisionService(config, registry);

        LoginDecision decision = service.decide("Example", "127.0.0.1:25565");

        assertEquals(LoginDecision.Action.KICK, decision.action());
        assertTrue(decision.message().contains("http://127.0.0.1:8787/auth/minecraft?code=ABCD-1234"));
        assertTrue(decision.message().contains("ABCD-1234"));
        assertEquals("gateway-survival", registry.request.serverId());
        assertEquals("Example", registry.request.username());
        assertEquals("kick", registry.request.mode());
    }

    @Test
    void requiresPremiumAuthForPremiumMinecraftName() throws Exception {
        SailGatewayConfig config = SailGatewayConfig.defaults();
        SailLoginDecisionService service = new SailLoginDecisionService(config, new RejectionRegistryClient());

        LoginDecision decision = service.decide("Notch", "127.0.0.1:25565");

        assertEquals("REQUIRE_PREMIUM_AUTH", decision.action().name());
        assertTrue(!decision.message().contains("code="));
    }

    @Test
    void acceptsCompletedChallengeOnRejoinWithLocalProfile() throws Exception {
        SailGatewayConfig config = SailGatewayConfig.defaults();
        CompletingRegistryClient registry = new CompletingRegistryClient();
        SailLoginDecisionService service = new SailLoginDecisionService(config, registry, acceptingVerifier());

        LoginDecision firstJoin = service.decide("Example", "127.0.0.1:25565");
        LoginDecision secondJoin = service.decide("Example", "127.0.0.1:25565");

        assertEquals(LoginDecision.Action.KICK, firstJoin.action());
        assertEquals(LoginDecision.Action.ACCEPT_LOCAL_PROFILE, secondJoin.action());
        LocalSessionProfile profile = secondJoin.localProfile().orElseThrow();
        assertEquals("example", profile.canonicalName());
        assertEquals("Example", profile.displayName());
        assertEquals(UUID.fromString("00000000-0000-4000-8000-000000000001"), profile.minecraftUuid());
        assertEquals("eyJhbGciOiJFUzI1NiJ9.payload.signature", profile.sessionToken());
        SailPaperIdentity paperIdentity = profile.paperIdentity();
        assertEquals(config.registry().registryId(), paperIdentity.registryId());
        assertEquals(config.server().serverId(), paperIdentity.serverId());
        assertEquals("sess_local_0123456789abcdef", paperIdentity.sessionId());
        assertEquals("acct_local_0123456789abcdef", paperIdentity.accountId());
        assertEquals("mcid_local_0123456789abcdef", paperIdentity.minecraftIdentityId());
        assertEquals("claim_local_0123456789abcdef", paperIdentity.nameClaimId());
        assertEquals("example", paperIdentity.canonicalName());
        assertEquals("Example", paperIdentity.displayName());
        assertEquals("00000000-0000-4000-8000-000000000001", paperIdentity.minecraftUuid());
        assertEquals("LOCAL_SOFT", paperIdentity.claimType());
        assertEquals("SAIL_LOCAL", paperIdentity.identityType());
        assertEquals("my-network", paperIdentity.issuer());
        assertEquals("dev-es256-2026-06", paperIdentity.keyId());
        assertEquals(1, registry.createdChallenges);
        assertEquals(1, registry.statusChecks);
        assertEquals(1, registry.sessionVerifications);
    }

    @Test
    void acceptsCompletedChallengeWithDefaultSignedSessionProofAndOnlineVerification() throws Exception {
        SailGatewayConfig config = SailGatewayConfig.defaults();
        SignedCompletingRegistryClient registry = new SignedCompletingRegistryClient(signSessionToken());
        SailLoginDecisionService service = new SailLoginDecisionService(config, registry);

        LoginDecision firstJoin = service.decide("Example", "127.0.0.1:25565");
        LoginDecision secondJoin = service.decide("Example", "127.0.0.1:25565");

        assertEquals(LoginDecision.Action.KICK, firstJoin.action());
        assertEquals(LoginDecision.Action.ACCEPT_LOCAL_PROFILE, secondJoin.action());
        assertEquals("example", secondJoin.localProfile().orElseThrow().canonicalName());
        assertEquals(LOCAL_UUID, secondJoin.localProfile().orElseThrow().minecraftUuid());
        assertEquals(1, registry.sessionVerifications);
    }

    @Test
    void rejectsCompletedChallengeWhenRegistryVerificationResponseIsNull() throws Exception {
        SailGatewayConfig config = SailGatewayConfig.defaults();
        NullVerificationRegistryClient registry = new NullVerificationRegistryClient(signSessionToken());
        SailLoginDecisionService service = new SailLoginDecisionService(config, registry);

        LoginDecision firstJoin = service.decide("Example", "127.0.0.1:25565");
        LoginDecision secondJoin = service.decide("Example", "127.0.0.1:25565");

        assertEquals(LoginDecision.Action.KICK, firstJoin.action());
        assertEquals(LoginDecision.Action.KICK, secondJoin.action());
        assertTrue(secondJoin.message().contains("unavailable"));
        assertEquals(1, registry.sessionVerifications);
        assertEquals(0, service.activeSessionCount());
    }

    @Test
    void rejectsCompletedChallengeWhenRegistryVerificationServerIdMismatches() throws Exception {
        assertVerificationMismatchRejected(activeVerification(
                "sess_local_0123456789abcdef",
                "other-survival",
                "local-survival",
                "example",
                LOCAL_UUID.toString()));
    }

    @Test
    void rejectsCompletedChallengeWhenRegistryVerificationSessionIdMismatches() throws Exception {
        assertVerificationMismatchRejected(activeVerification(
                "sess_other_0123456789abcdef",
                "local-survival",
                "local-survival",
                "example",
                LOCAL_UUID.toString()));
    }

    @Test
    void rejectsCompletedChallengeWhenRegistryVerificationCanonicalNameMismatches() throws Exception {
        assertVerificationMismatchRejected(activeVerification(
                "sess_local_0123456789abcdef",
                "local-survival",
                "local-survival",
                "different",
                LOCAL_UUID.toString()));
    }

    @Test
    void rejectsCompletedChallengeWhenRegistryVerificationMinecraftUuidMismatches() throws Exception {
        assertVerificationMismatchRejected(activeVerification(
                "sess_local_0123456789abcdef",
                "local-survival",
                "local-survival",
                "example",
                "00000000-0000-4000-8000-000000000002"));
    }

    @Test
    void rejectsCompletedChallengeWhenRegistryVerificationIssuerServerIdMismatches() throws Exception {
        assertVerificationMismatchRejected(activeVerification(
                "sess_local_0123456789abcdef",
                "local-survival",
                "other-survival",
                "example",
                LOCAL_UUID.toString()));
    }

    @Test
    void rejectsUnsignedCompletedSessionProofWithDefaultVerifier() throws Exception {
        SailGatewayConfig config = SailGatewayConfig.defaults();
        CompletingRegistryClient registry = new CompletingRegistryClient();
        SailLoginDecisionService service = new SailLoginDecisionService(config, registry);

        LoginDecision firstJoin = service.decide("Example", "127.0.0.1:25565");
        LoginDecision secondJoin = service.decide("Example", "127.0.0.1:25565");

        assertEquals(LoginDecision.Action.KICK, firstJoin.action());
        assertEquals(LoginDecision.Action.KICK, secondJoin.action());
        assertTrue(secondJoin.message().contains("unavailable"));
        assertEquals(0, service.activeSessionCount());
        assertEquals(0, registry.sessionVerifications);
    }

    @Test
    void startsNewChallengeWhenCompletedStatusDoesNotIncludeSessionToken() throws Exception {
        SailGatewayConfig config = SailGatewayConfig.defaults();
        TokenlessCompletionRegistryClient registry = new TokenlessCompletionRegistryClient();
        SailLoginDecisionService service = new SailLoginDecisionService(config, registry);

        LoginDecision firstJoin = service.decide("Example", "127.0.0.1:25565");
        LoginDecision secondJoin = service.decide("Example", "127.0.0.1:25565");

        assertEquals(LoginDecision.Action.KICK, firstJoin.action());
        assertEquals(LoginDecision.Action.KICK, secondJoin.action());
        assertTrue(secondJoin.message().contains("http://127.0.0.1:8787/auth/minecraft?code=EFGH-5678"));
        assertEquals(2, registry.createdChallenges);
        assertEquals(1, registry.statusChecks);
        assertEquals(0, registry.sessionVerifications);
        assertEquals(0, service.activeSessionCount());
    }

    @Test
    void resumesAcceptedLocalSessionWithoutCreatingANewChallenge() throws Exception {
        SailGatewayConfig config = SailGatewayConfig.defaults();
        CompletingRegistryClient registry = new CompletingRegistryClient();
        SailLoginDecisionService service = new SailLoginDecisionService(config, registry, acceptingVerifier());

        LoginDecision firstJoin = service.decide("Example", "127.0.0.1:25565");
        LoginDecision secondJoin = service.decide("Example", "127.0.0.1:25565");
        LoginDecision thirdJoin = service.decide("Example", "127.0.0.1:25565");

        assertEquals(LoginDecision.Action.KICK, firstJoin.action());
        assertEquals(LoginDecision.Action.ACCEPT_LOCAL_PROFILE, secondJoin.action());
        assertEquals(LoginDecision.Action.ACCEPT_LOCAL_PROFILE, thirdJoin.action());
        assertEquals("example", thirdJoin.localProfile().orElseThrow().canonicalName());
        assertEquals(1, registry.createdChallenges);
        assertEquals(1, registry.statusChecks);
        assertEquals(2, registry.sessionVerifications);
    }

    @Test
    void failsClosedWhenRegistryCannotCreateChallenge() throws Exception {
        SailGatewayConfig config = SailGatewayConfig.defaults();
        SailLoginDecisionService service = new SailLoginDecisionService(config, new UnavailableRegistryClient());

        LoginDecision decision = service.decide("Example", "127.0.0.1:25565");

        assertEquals(LoginDecision.Action.KICK, decision.action());
        assertTrue(decision.message().contains("unavailable"));
        assertTrue(!decision.message().contains("code="));
    }

    @Test
    void rejectsCompletedChallengeWhenSessionWasRevoked() throws Exception {
        SailGatewayConfig config = SailGatewayConfig.defaults();
        RevokedSessionRegistryClient registry = new RevokedSessionRegistryClient();
        SailLoginDecisionService service = new SailLoginDecisionService(config, registry, acceptingVerifier());

        LoginDecision firstJoin = service.decide("Example", "127.0.0.1:25565");
        LoginDecision secondJoin = service.decide("Example", "127.0.0.1:25565");

        assertEquals(LoginDecision.Action.KICK, firstJoin.action());
        assertEquals(LoginDecision.Action.KICK, secondJoin.action());
        assertTrue(secondJoin.message().contains("revoked"));
        assertEquals(1, registry.sessionVerifications);
    }

    @Test
    void rejectsCompletedChallengeWhenLocalTokenVerificationFailsEvenIfOnlineSessionIsActive() throws Exception {
        SailGatewayConfig config = SailGatewayConfig.defaults();
        CompletingRegistryClient registry = new CompletingRegistryClient();
        SailLoginDecisionService service = new SailLoginDecisionService(
                config,
                registry,
                failingVerifier());

        LoginDecision firstJoin = service.decide("Example", "127.0.0.1:25565");
        LoginDecision secondJoin = service.decide("Example", "127.0.0.1:25565");

        assertEquals(LoginDecision.Action.KICK, firstJoin.action());
        assertEquals(LoginDecision.Action.KICK, secondJoin.action());
        assertEquals(0, service.activeSessionCount());
        assertEquals(0, registry.sessionVerifications);
    }

    @Test
    void rejectsCachedSessionWhenLocalTokenVerificationFailsBeforeOnlineVerifyCanOverrideIt() throws Exception {
        SailGatewayConfig config = SailGatewayConfig.defaults();
        CompletingRegistryClient registry = new CompletingRegistryClient();
        ToggleVerifier verifier = new ToggleVerifier();
        SailLoginDecisionService service = new SailLoginDecisionService(config, registry, verifier);

        assertEquals(LoginDecision.Action.KICK, service.decide("Example", "127.0.0.1:25565").action());
        assertEquals(LoginDecision.Action.ACCEPT_LOCAL_PROFILE, service.decide("Example", "127.0.0.1:25565").action());

        verifier.fail = true;
        LoginDecision thirdJoin = service.decide("Example", "127.0.0.1:25565");

        assertEquals(LoginDecision.Action.KICK, thirdJoin.action());
        assertEquals(1, registry.sessionVerifications);
        assertEquals(0, service.activeSessionCount());
    }

    @Test
    void stillRejectsValidLocalTokenWhenOnlineVerificationReportsRevoked() throws Exception {
        SailGatewayConfig config = SailGatewayConfig.defaults();
        RevokedSessionRegistryClient registry = new RevokedSessionRegistryClient();
        SailLoginDecisionService service = new SailLoginDecisionService(
                config,
                registry,
                acceptingVerifier());

        assertEquals(LoginDecision.Action.KICK, service.decide("Example", "127.0.0.1:25565").action());
        LoginDecision secondJoin = service.decide("Example", "127.0.0.1:25565");

        assertEquals(LoginDecision.Action.KICK, secondJoin.action());
        assertTrue(secondJoin.message().contains("revoked"));
        assertEquals(1, registry.sessionVerifications);
    }

    @Test
    void rejectsCachedLocalSessionWhenRegistryRevokesIt() throws Exception {
        SailGatewayConfig config = SailGatewayConfig.defaults();
        RevokedAfterFirstVerificationRegistryClient registry = new RevokedAfterFirstVerificationRegistryClient();
        SailLoginDecisionService service = new SailLoginDecisionService(config, registry, acceptingVerifier());

        LoginDecision firstJoin = service.decide("Example", "127.0.0.1:25565");
        LoginDecision secondJoin = service.decide("Example", "127.0.0.1:25565");
        LoginDecision thirdJoin = service.decide("Example", "127.0.0.1:25565");

        assertEquals(LoginDecision.Action.KICK, firstJoin.action());
        assertEquals(LoginDecision.Action.ACCEPT_LOCAL_PROFILE, secondJoin.action());
        assertEquals(LoginDecision.Action.KICK, thirdJoin.action());
        assertTrue(thirdJoin.message().contains("revoked"));
        assertEquals(2, registry.sessionVerifications);
    }

    private static final class RejectionRegistryClient implements SailRegistryClient {
        @Override
        public AuthChallengeResponse createAuthChallenge(AuthChallengeRequest request) {
            throw SailRegistryException.fromSailErrorJson(
                    409,
                    """
                    {
                      "protocol_version": "sail-protocol-v1",
                      "error": {
                        "code": "premium_name_required",
                        "message": "This name belongs to a Minecraft Java account. Join with the official account.",
                        "audience": "player",
                        "http_status": 409,
                        "retryable": false,
                        "correlation_id": "corr_local_0123456789abcdef"
                      }
                    }
                    """);
        }

        @Override
        public AuthChallengeStatusResponse getAuthChallenge(String challengeId) {
            throw new UnsupportedOperationException("status lookup not used in this test");
        }

        @Override
        public net.sailmc.gateway.registry.RegistryHealthResponse getHealth() {
            throw new UnsupportedOperationException("health lookup not used in this test");
        }
    }

    private static final class UnavailableRegistryClient implements SailRegistryClient {
        @Override
        public AuthChallengeResponse createAuthChallenge(AuthChallengeRequest request) throws IOException {
            throw new IOException("registry offline");
        }

        @Override
        public AuthChallengeStatusResponse getAuthChallenge(String challengeId) {
            throw new UnsupportedOperationException("status lookup not used in this test");
        }

        @Override
        public net.sailmc.gateway.registry.RegistryHealthResponse getHealth() {
            throw new UnsupportedOperationException("health lookup not used in this test");
        }
    }

    private static final class CapturingRegistryClient implements SailRegistryClient {
        private AuthChallengeRequest request;

        @Override
        public AuthChallengeResponse createAuthChallenge(AuthChallengeRequest request) {
            this.request = request;
            return new AuthChallengeResponse(
                    "sail-protocol-v1",
                    "ch_local_0123456789abcdef",
                    "pending",
                    "local-survival",
                    "Example",
                    "kick",
                    "ABCD-1234",
                    URI.create("http://127.0.0.1:8787/auth/minecraft?code=ABCD-1234").toString(),
                    "2026-06-06T00:15:00Z");
        }

        @Override
        public AuthChallengeStatusResponse getAuthChallenge(String challengeId) {
            throw new UnsupportedOperationException("status lookup not used in this test");
        }

        @Override
        public net.sailmc.gateway.registry.RegistryHealthResponse getHealth() {
            throw new UnsupportedOperationException("health lookup not used in this test");
        }
    }

    private static final class TokenlessCompletionRegistryClient implements SailRegistryClient {
        private int createdChallenges;
        private int statusChecks;
        private int sessionVerifications;

        @Override
        public AuthChallengeResponse createAuthChallenge(AuthChallengeRequest request) {
            createdChallenges += 1;
            String code = createdChallenges == 1 ? "ABCD-1234" : "EFGH-5678";
            return new AuthChallengeResponse(
                    "sail-protocol-v1",
                    "ch_local_0123456789abcdef_" + createdChallenges,
                    "pending",
                    request.serverId(),
                    request.username(),
                    request.mode(),
                    code,
                    URI.create("http://127.0.0.1:8787/auth/minecraft?code=" + code).toString(),
                    "2026-06-06T00:15:00Z");
        }

        @Override
        public AuthChallengeStatusResponse getAuthChallenge(String challengeId) {
            statusChecks += 1;
            return new AuthChallengeStatusResponse(
                    "sail-protocol-v1",
                    challengeId,
                    "completed",
                    "2026-06-06T00:15:00Z",
                    Optional.of("2026-06-06T00:10:30Z"),
                    Optional.of(new CompletedIdentity(
                            "acct_local_0123456789abcdef",
                            "mcid_local_0123456789abcdef",
                            "claim_local_0123456789abcdef",
                            "example",
                            "Example",
                            "00000000-0000-4000-8000-000000000001",
                            "LOCAL_SOFT",
                            "SAIL_LOCAL",
                            "sess_local_0123456789abcdef",
                            null)));
        }

        @Override
        public net.sailmc.gateway.registry.RegistryHealthResponse getHealth() {
            throw new UnsupportedOperationException("health lookup not used in this test");
        }

        @Override
        public SessionVerificationResponse verifySession(String serverId, String sessionToken) {
            sessionVerifications += 1;
            throw new AssertionError("tokenless completed status must not be promoted to a local session");
        }
    }

    private static class CompletingRegistryClient implements SailRegistryClient {
        private int createdChallenges;
        private int statusChecks;
        protected int sessionVerifications;

        @Override
        public AuthChallengeResponse createAuthChallenge(AuthChallengeRequest request) {
            createdChallenges += 1;
            return new AuthChallengeResponse(
                    "sail-protocol-v1",
                    "ch_local_0123456789abcdef",
                    "pending",
                    request.serverId(),
                    request.username(),
                    request.mode(),
                    "ABCD-1234",
                    URI.create("http://127.0.0.1:8787/auth/minecraft?code=ABCD-1234").toString(),
                    "2026-06-06T00:15:00Z");
        }

        @Override
        public AuthChallengeStatusResponse getAuthChallenge(String challengeId) {
            statusChecks += 1;
            return new AuthChallengeStatusResponse(
                    "sail-protocol-v1",
                    challengeId,
                    "completed",
                    "2026-06-06T00:15:00Z",
                    Optional.of("2026-06-06T00:10:30Z"),
                    Optional.of(new CompletedIdentity(
                            "acct_local_0123456789abcdef",
                            "mcid_local_0123456789abcdef",
                            "claim_local_0123456789abcdef",
                            "example",
                            "Example",
                            "00000000-0000-4000-8000-000000000001",
                            "LOCAL_SOFT",
                            "SAIL_LOCAL",
                            "sess_local_0123456789abcdef",
                            "eyJhbGciOiJFUzI1NiJ9.payload.signature")));
        }

        @Override
        public net.sailmc.gateway.registry.RegistryHealthResponse getHealth() {
            throw new UnsupportedOperationException("health lookup not used in this test");
        }

        @Override
        public SessionVerificationResponse verifySession(String serverId, String sessionToken) {
            sessionVerifications += 1;
            return new SessionVerificationResponse(
                    "sail-protocol-v1",
                    "sess_local_0123456789abcdef",
                    "active",
                    serverId,
                    "local-survival",
                    "same_registry",
                    "example",
                    "00000000-0000-4000-8000-000000000001");
        }
    }

    private static final class SignedCompletingRegistryClient extends CompletingRegistryClient {
        private final String sessionToken;

        private SignedCompletingRegistryClient(String sessionToken) {
            this.sessionToken = sessionToken;
        }

        @Override
        public AuthChallengeStatusResponse getAuthChallenge(String challengeId) {
            return new AuthChallengeStatusResponse(
                    "sail-protocol-v1",
                    challengeId,
                    "completed",
                    "2026-06-06T00:15:00Z",
                    Optional.of("2026-06-06T00:10:30Z"),
                    Optional.of(new CompletedIdentity(
                            "acct_local_0123456789abcdef",
                            "mcid_local_0123456789abcdef",
                            "claim_local_0123456789abcdef",
                            "example",
                            "Example",
                            LOCAL_UUID.toString(),
                            "LOCAL_SOFT",
                            "SAIL_LOCAL",
                            "sess_local_0123456789abcdef",
                            sessionToken)));
        }
    }

    private static class CustomVerificationRegistryClient extends CompletingRegistryClient {
        private final String sessionToken;
        private final SessionVerificationResponse verification;

        private CustomVerificationRegistryClient(String sessionToken, SessionVerificationResponse verification) {
            this.sessionToken = sessionToken;
            this.verification = verification;
        }

        @Override
        public AuthChallengeStatusResponse getAuthChallenge(String challengeId) {
            return new AuthChallengeStatusResponse(
                    "sail-protocol-v1",
                    challengeId,
                    "completed",
                    "2026-06-06T00:15:00Z",
                    Optional.of("2026-06-06T00:10:30Z"),
                    Optional.of(new CompletedIdentity(
                            "acct_local_0123456789abcdef",
                            "mcid_local_0123456789abcdef",
                            "claim_local_0123456789abcdef",
                            "example",
                            "Example",
                            LOCAL_UUID.toString(),
                            "LOCAL_SOFT",
                            "SAIL_LOCAL",
                            "sess_local_0123456789abcdef",
                            sessionToken)));
        }

        @Override
        public SessionVerificationResponse verifySession(String serverId, String sessionToken) {
            sessionVerifications += 1;
            return verification;
        }
    }

    private static final class NullVerificationRegistryClient extends CustomVerificationRegistryClient {
        private NullVerificationRegistryClient(String sessionToken) {
            super(sessionToken, null);
        }
    }

    private static final class RevokedSessionRegistryClient extends CompletingRegistryClient {
        @Override
        public SessionVerificationResponse verifySession(String serverId, String sessionToken) {
            super.sessionVerifications += 1;
            throw revokedSessionException();
        }
    }

    private static final class RevokedAfterFirstVerificationRegistryClient extends CompletingRegistryClient {
        @Override
        public SessionVerificationResponse verifySession(String serverId, String sessionToken) {
            if (sessionVerifications == 0) {
                return super.verifySession(serverId, sessionToken);
            }
            sessionVerifications += 1;
            throw revokedSessionException();
        }
    }

    private static SailRegistryException revokedSessionException() {
        return SailRegistryException.fromSailErrorJson(
                403,
                """
                {
                  "protocol_version": "sail-protocol-v1",
                  "error": {
                    "code": "session_revoked",
                    "message": "Your Sail session was revoked. Join again to authenticate.",
                    "audience": "player",
                    "http_status": 403,
                    "retryable": true,
                    "correlation_id": "corr_local_0123456789abcdef"
                  }
                }
                """);
    }

    private static void assertVerificationMismatchRejected(SessionVerificationResponse verification) throws Exception {
        SailGatewayConfig config = SailGatewayConfig.defaults();
        CustomVerificationRegistryClient registry =
                new CustomVerificationRegistryClient(signSessionToken(), verification);
        SailLoginDecisionService service = new SailLoginDecisionService(config, registry);

        LoginDecision firstJoin = service.decide("Example", "127.0.0.1:25565");
        LoginDecision secondJoin = service.decide("Example", "127.0.0.1:25565");

        assertEquals(LoginDecision.Action.KICK, firstJoin.action());
        assertEquals(LoginDecision.Action.KICK, secondJoin.action());
        assertTrue(secondJoin.message().contains("unavailable"));
        assertEquals(1, registry.sessionVerifications);
        assertEquals(0, service.activeSessionCount());
    }

    private static SessionVerificationResponse activeVerification(
            String sessionId,
            String serverId,
            String issuerServerId,
            String canonicalName,
            String minecraftUuid) {
        return new SessionVerificationResponse(
                "sail-protocol-v1",
                sessionId,
                "active",
                serverId,
                issuerServerId,
                "same_registry",
                canonicalName,
                minecraftUuid);
    }

    private static SailGatewayConfig configWithServerId(String serverId) {
        SailGatewayConfig defaults = SailGatewayConfig.defaults();
        return new SailGatewayConfig(
                defaults.registry(),
                new SailGatewayConfig.Server(serverId, "Gateway Survival"),
                defaults.loginFlow(),
                defaults.backend());
    }

    private static String signSessionToken() throws Exception {
        Instant now = Instant.now();
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .issuer("my-network")
                .subject("acct_local_0123456789abcdef")
                .issueTime(Date.from(now))
                .expirationTime(Date.from(now.plusSeconds(300)))
                .claim("protocol_version", "sail-protocol-v1")
                .claim("session_id", "sess_local_0123456789abcdef")
                .claim("account_id", "acct_local_0123456789abcdef")
                .claim("minecraft_identity_id", "mcid_local_0123456789abcdef")
                .claim("name_claim_id", "claim_local_0123456789abcdef")
                .claim("canonical_name", "example")
                .claim("minecraft_uuid", LOCAL_UUID.toString())
                .claim("claim_type", "LOCAL_SOFT")
                .claim("identity_type", "SAIL_LOCAL")
                .claim("scope", "minecraft_login")
                .claim("server_id", "local-survival")
                .claim("risk_level", "low")
                .build();
        SignedJWT jwt = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.ES256)
                        .keyID("dev-es256-2026-06")
                        .type(JOSEObjectType.JWT)
                        .build(),
                claims);
        jwt.sign(new ECDSASigner(DEV_PRIVATE_KEY));
        return jwt.serialize();
    }

    private static SailSessionVerifier acceptingVerifier() {
        return (sessionToken, expectedCanonicalName, expectedMinecraftUuid) -> new VerifiedSailSession(
                "sess_local_0123456789abcdef",
                "acct_local_0123456789abcdef",
                expectedCanonicalName,
                expectedMinecraftUuid,
                "local-survival",
                "minecraft_login",
                "my-network",
                "dev-es256-2026-06");
    }

    private static SailSessionVerifier failingVerifier() {
        return (sessionToken, expectedCanonicalName, expectedMinecraftUuid) -> {
            throw new SailSessionTokenVerifier.VerificationException("invalid local session token");
        };
    }

    private static final class ToggleVerifier implements SailSessionVerifier {
        private boolean fail;

        @Override
        public VerifiedSailSession verify(String sessionToken, String expectedCanonicalName, UUID expectedMinecraftUuid)
                throws SailSessionTokenVerifier.VerificationException {
            if (fail) {
                throw new SailSessionTokenVerifier.VerificationException("invalid local session token");
            }
            return acceptingVerifier().verify(sessionToken, expectedCanonicalName, expectedMinecraftUuid);
        }
    }
}
