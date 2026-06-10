package net.sailmc.gateway.session;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.ECDSASigner;
import com.nimbusds.jose.jwk.Curve;
import com.nimbusds.jose.jwk.ECKey;
import com.nimbusds.jose.jwk.gen.ECKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import net.sailmc.gateway.config.SailGatewayConfig;
import org.junit.jupiter.api.Test;

class SailSessionTokenVerifierTest {
    private static final Instant NOW = Instant.parse("2026-06-06T00:00:00Z");
    private static final UUID EXPECTED_UUID = UUID.fromString("00000000-0000-4000-8000-000000000001");
    private static final String EXPECTED_NAME = "example";
    private static final String SESSION_ID = "sess_local_0123456789abcdef";
    private static final String ACCOUNT_ID = "acct_local_0123456789abcdef";
    private static final ECKey DEV_KEY = new ECKey.Builder(
                    Curve.P_256,
                    new com.nimbusds.jose.util.Base64URL("0WamuH-EnCrBXIQwPZo2ZKfwNV9OW9EDkzr4YzscxcY"),
                    new com.nimbusds.jose.util.Base64URL("0wFxw0l_9Rziux_ZQboPeCkBi5oLibu_5GocXtVUURo"))
            .d(new com.nimbusds.jose.util.Base64URL("cgltruyV9L4GvyWUauOeVmkPew0k1SQSc6HhAdzPAYM"))
            .keyID("dev-es256-2026-06")
            .algorithm(JWSAlgorithm.ES256)
            .build();

    @Test
    void verifiesValidTokenForConfiguredIssuerAndPinnedKey() throws Exception {
        SailSessionTokenVerifier verifier = new SailSessionTokenVerifier(pinnedConfig(), fixedClock());
        String token = signToken("my-network", "dev-es256-2026-06", "minecraft_login", futureExpiry());

        VerifiedSailSession verified = verifier.verify(token, EXPECTED_NAME, EXPECTED_UUID);

        assertEquals(SESSION_ID, verified.sessionId());
        assertEquals(ACCOUNT_ID, verified.accountId());
        assertEquals(EXPECTED_NAME, verified.canonicalName());
        assertEquals(EXPECTED_UUID, verified.minecraftUuid());
        assertEquals("minecraft_login", verified.scope());
        assertEquals("my-network", verified.issuer());
        assertEquals("dev-es256-2026-06", verified.keyId());
    }

    @Test
    void acceptsTokenWhoseServerIdEqualsConfigServerId() throws Exception {
        SailSessionTokenVerifier verifier = new SailSessionTokenVerifier(pinnedConfig("local-survival"), fixedClock());
        String token = signTokenWithServerId(
                "my-network", "dev-es256-2026-06", "minecraft_login", futureExpiry(), "local-survival");

        VerifiedSailSession verified = verifier.verify(token, EXPECTED_NAME, EXPECTED_UUID);

        assertEquals("local-survival", verified.serverId());
    }

    @Test
    void acceptsTokenWhoseServerIdDiffersFromConfigServerIdSoOnlineRegistryPolicyCanDecideReuse() throws Exception {
        SailSessionTokenVerifier verifier = new SailSessionTokenVerifier(pinnedConfig("gateway-survival"), fixedClock());
        String token = signTokenWithServerId(
                "my-network", "dev-es256-2026-06", "minecraft_login", futureExpiry(), "registry-lobby");

        VerifiedSailSession verified = verifier.verify(token, EXPECTED_NAME, EXPECTED_UUID);

        assertEquals("registry-lobby", verified.serverId());
    }

    @Test
    void rejectsTokenMissingServerId() throws Exception {
        SailSessionTokenVerifier verifier = new SailSessionTokenVerifier(pinnedConfig(), fixedClock());
        String token = signTokenWithoutServerId("my-network", "dev-es256-2026-06", "minecraft_login", futureExpiry());

        assertThrows(SailSessionTokenVerifier.VerificationException.class, () ->
                verifier.verify(token, EXPECTED_NAME, EXPECTED_UUID));
    }

    @Test
    void exposesTokenServerIdOnVerifiedSailSession() throws Exception {
        SailSessionTokenVerifier verifier = new SailSessionTokenVerifier(pinnedConfig(), fixedClock());
        String token = signTokenWithServerId(
                "my-network", "dev-es256-2026-06", "minecraft_login", futureExpiry(), "event-hub");

        VerifiedSailSession verified = verifier.verify(token, EXPECTED_NAME, EXPECTED_UUID);

        assertEquals("event-hub", verified.serverId());
    }

    @Test
    void returnsMinimalSessionWhenPublicKeyPinningIsDisabled() throws Exception {
        SailSessionTokenVerifier verifier =
                new SailSessionTokenVerifier(unpinnedConfigWithServerId("gateway-survival"), fixedClock());

        VerifiedSailSession verified = verifier.verify("not-a-jwt", EXPECTED_NAME, EXPECTED_UUID);

        assertEquals("", verified.sessionId());
        assertEquals(EXPECTED_NAME, verified.canonicalName());
        assertEquals(EXPECTED_UUID, verified.minecraftUuid());
        assertEquals("minecraft_login", verified.scope());
        assertEquals("my-network", verified.issuer());
    }

    @Test
    void unpinnedDevModeReturnsConfiguredServerIdInVerifiedSailSession() throws Exception {
        SailSessionTokenVerifier verifier =
                new SailSessionTokenVerifier(unpinnedConfigWithServerId("gateway-survival"), fixedClock());

        VerifiedSailSession verified = verifier.verify("not-a-jwt", EXPECTED_NAME, EXPECTED_UUID);

        assertEquals("gateway-survival", verified.serverId());
    }

    @Test
    void rejectsPinnedModeWithoutTrustedKeys() {
        SailSessionTokenVerifier verifier = new SailSessionTokenVerifier(pinnedConfig(List.of()), fixedClock());

        assertThrows(SailSessionTokenVerifier.VerificationException.class, () ->
                verifier.verify("not-a-jwt", EXPECTED_NAME, EXPECTED_UUID));
    }

    @Test
    void rejectsWrongIssuer() throws Exception {
        SailSessionTokenVerifier verifier = new SailSessionTokenVerifier(pinnedConfig(), fixedClock());
        String token = signToken("other-network", "dev-es256-2026-06", "minecraft_login", futureExpiry());

        assertThrows(SailSessionTokenVerifier.VerificationException.class, () ->
                verifier.verify(token, EXPECTED_NAME, EXPECTED_UUID));
    }

    @Test
    void rejectsUnknownKid() throws Exception {
        SailSessionTokenVerifier verifier = new SailSessionTokenVerifier(pinnedConfig(), fixedClock());
        String token = signToken("my-network", "unknown-key", "minecraft_login", futureExpiry());

        assertThrows(SailSessionTokenVerifier.VerificationException.class, () ->
                verifier.verify(token, EXPECTED_NAME, EXPECTED_UUID));
    }

    @Test
    void rejectsTokenSignedByAttackerKey() throws Exception {
        SailSessionTokenVerifier verifier = new SailSessionTokenVerifier(pinnedConfig(), fixedClock());
        String token = signTokenWithAttackerKey("my-network", "dev-es256-2026-06", "minecraft_login", futureExpiry());

        assertThrows(SailSessionTokenVerifier.VerificationException.class, () ->
                verifier.verify(token, EXPECTED_NAME, EXPECTED_UUID));
    }

    @Test
    void rejectsExpiredToken() throws Exception {
        SailSessionTokenVerifier verifier = new SailSessionTokenVerifier(pinnedConfig(), fixedClock());
        String token = signToken("my-network", "dev-es256-2026-06", "minecraft_login", pastExpiry());

        assertThrows(SailSessionTokenVerifier.VerificationException.class, () ->
                verifier.verify(token, EXPECTED_NAME, EXPECTED_UUID));
    }

    @Test
    void rejectsWrongProtocolVersion() throws Exception {
        SailSessionTokenVerifier verifier = new SailSessionTokenVerifier(pinnedConfig(), fixedClock());
        String token = signToken(
                "my-network",
                "dev-es256-2026-06",
                "minecraft_login",
                futureExpiry(),
                Map.of("protocol_version", "sail-protocol-v0"));

        assertThrows(SailSessionTokenVerifier.VerificationException.class, () ->
                verifier.verify(token, EXPECTED_NAME, EXPECTED_UUID));
    }

    @Test
    void rejectsWrongScope() throws Exception {
        SailSessionTokenVerifier verifier = new SailSessionTokenVerifier(pinnedConfig(), fixedClock());
        String token = signToken("my-network", "dev-es256-2026-06", "name_lookup", futureExpiry());

        assertThrows(SailSessionTokenVerifier.VerificationException.class, () ->
                verifier.verify(token, EXPECTED_NAME, EXPECTED_UUID));
    }

    @Test
    void rejectsNameMismatch() throws Exception {
        SailSessionTokenVerifier verifier = new SailSessionTokenVerifier(pinnedConfig(), fixedClock());
        String token = signToken("my-network", "dev-es256-2026-06", "minecraft_login", futureExpiry());

        assertThrows(SailSessionTokenVerifier.VerificationException.class, () ->
                verifier.verify(token, "other", EXPECTED_UUID));
    }

    @Test
    void rejectsUuidMismatch() throws Exception {
        SailSessionTokenVerifier verifier = new SailSessionTokenVerifier(pinnedConfig(), fixedClock());
        String token = signToken("my-network", "dev-es256-2026-06", "minecraft_login", futureExpiry());

        assertThrows(SailSessionTokenVerifier.VerificationException.class, () ->
                verifier.verify(token, EXPECTED_NAME, UUID.fromString("00000000-0000-4000-8000-000000000099")));
    }

    private static SailGatewayConfig pinnedConfig() {
        return pinnedConfig("local-survival");
    }

    private static SailGatewayConfig pinnedConfig(String serverId) {
        return pinnedConfig(serverId, List.of(new SailGatewayConfig.TrustedKey(
                "dev-es256-2026-06",
                "ES256",
                "P-256",
                "0WamuH-EnCrBXIQwPZo2ZKfwNV9OW9EDkzr4YzscxcY",
                "0wFxw0l_9Rziux_ZQboPeCkBi5oLibu_5GocXtVUURo")));
    }

    private static SailGatewayConfig pinnedConfig(List<SailGatewayConfig.TrustedKey> trustedKeys) {
        return pinnedConfig("local-survival", trustedKeys);
    }

    private static SailGatewayConfig pinnedConfig(String serverId, List<SailGatewayConfig.TrustedKey> trustedKeys) {
        SailGatewayConfig defaults = SailGatewayConfig.defaults();
        return new SailGatewayConfig(
                new SailGatewayConfig.Registry(
                        "self-hosted",
                        URI.create("http://127.0.0.1:8787"),
                        "my-network",
                        true,
                        trustedKeys),
                new SailGatewayConfig.Server(serverId, "Local Survival"),
                defaults.loginFlow(),
                defaults.backend());
    }

    private static SailGatewayConfig unpinnedConfigWithServerId(String serverId) {
        SailGatewayConfig defaults = SailGatewayConfig.defaults();
        return new SailGatewayConfig(
                new SailGatewayConfig.Registry(
                        "self-hosted",
                        URI.create("http://127.0.0.1:8787"),
                        "my-network",
                        false,
                        List.of()),
                new SailGatewayConfig.Server(serverId, "Gateway Survival"),
                defaults.loginFlow(),
                defaults.backend());
    }

    private static Clock fixedClock() {
        return Clock.fixed(NOW, ZoneOffset.UTC);
    }

    private static Date futureExpiry() {
        return Date.from(NOW.plusSeconds(60));
    }

    private static Date pastExpiry() {
        return Date.from(NOW.minusSeconds(60));
    }

    private static String signToken(String issuer, String kid, String scope, Date expiry) throws Exception {
        return signToken(issuer, kid, scope, expiry, Map.of());
    }

    private static String signToken(String issuer, String kid, String scope, Date expiry, Map<String, Object> overrides)
            throws Exception {
        return signTokenWithKey(DEV_KEY, issuer, kid, scope, expiry, overrides);
    }

    private static String signTokenWithServerId(String issuer, String kid, String scope, Date expiry, String serverId)
            throws Exception {
        return signToken(issuer, kid, scope, expiry, Map.of("server_id", serverId));
    }

    private static String signTokenWithoutServerId(String issuer, String kid, String scope, Date expiry)
            throws Exception {
        return signTokenWithKey(DEV_KEY, issuer, kid, scope, expiry, Map.of(), false);
    }

    private static String signTokenWithAttackerKey(String issuer, String kid, String scope, Date expiry)
            throws Exception {
        ECKey attackerKey = new ECKeyGenerator(Curve.P_256)
                .keyID(kid)
                .algorithm(JWSAlgorithm.ES256)
                .generate();
        return signTokenWithKey(attackerKey, issuer, kid, scope, expiry, Map.of());
    }

    private static String signTokenWithKey(ECKey key, String issuer, String kid, String scope, Date expiry,
            Map<String, Object> overrides) throws Exception {
        return signTokenWithKey(key, issuer, kid, scope, expiry, overrides, true);
    }

    private static String signTokenWithKey(ECKey key, String issuer, String kid, String scope, Date expiry,
            Map<String, Object> overrides, boolean includeServerId) throws Exception {
        JWTClaimsSet.Builder claims = new JWTClaimsSet.Builder()
                .issuer(issuer)
                .subject(ACCOUNT_ID)
                .issueTime(Date.from(NOW))
                .expirationTime(expiry)
                .claim("protocol_version", "sail-protocol-v1")
                .claim("session_id", SESSION_ID)
                .claim("account_id", ACCOUNT_ID)
                .claim("minecraft_identity_id", "mcid_local_0123456789abcdef")
                .claim("name_claim_id", "claim_local_0123456789abcdef")
                .claim("canonical_name", EXPECTED_NAME)
                .claim("minecraft_uuid", EXPECTED_UUID.toString())
                .claim("claim_type", "LOCAL_SOFT")
                .claim("identity_type", "SAIL_LOCAL")
                .claim("scope", scope)
                .claim("risk_level", "low");
        if (includeServerId) {
            claims.claim("server_id", "local-survival");
        }
        overrides.forEach(claims::claim);

        SignedJWT jwt = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.ES256)
                        .keyID(kid)
                        .type(JOSEObjectType.JWT)
                        .build(),
                claims.build());
        jwt.sign(new ECDSASigner(key));
        return jwt.serialize();
    }
}
