package net.sailmc.gateway.session;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.ECDSAVerifier;
import com.nimbusds.jose.jwk.Curve;
import com.nimbusds.jose.jwk.ECKey;
import com.nimbusds.jose.util.Base64URL;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.text.ParseException;
import java.time.Clock;
import java.time.Instant;
import java.util.Date;
import java.util.Objects;
import java.util.UUID;
import net.sailmc.gateway.config.SailGatewayConfig;

public final class SailSessionTokenVerifier implements SailSessionVerifier {
    private static final String PROTOCOL_VERSION = "sail-protocol-v1";
    private static final String MINECRAFT_LOGIN_SCOPE = "minecraft_login";

    private final SailGatewayConfig config;
    private final Clock clock;

    public SailSessionTokenVerifier(SailGatewayConfig config) {
        this(config, Clock.systemUTC());
    }

    public SailSessionTokenVerifier(SailGatewayConfig config, Clock clock) {
        this.config = Objects.requireNonNull(config, "config");
        this.clock = Objects.requireNonNull(clock, "clock");
    }

    @Override
    public VerifiedSailSession verify(String token, String expectedCanonicalName, UUID expectedMinecraftUuid)
            throws VerificationException {
        Objects.requireNonNull(expectedCanonicalName, "expectedCanonicalName");
        Objects.requireNonNull(expectedMinecraftUuid, "expectedMinecraftUuid");

        if (!config.registry().publicKeyPinning()) {
            return new VerifiedSailSession(
                    "",
                    "",
                    expectedCanonicalName,
                    expectedMinecraftUuid,
                    config.server().serverId(),
                    MINECRAFT_LOGIN_SCOPE,
                    config.registry().registryId(),
                    "");
        }
        if (config.registry().trustedKeys().isEmpty()) {
            throw invalid("public key pinning is enabled without trusted keys");
        }

        SignedJWT jwt = parseSignedJwt(token);
        JWSHeader header = jwt.getHeader();
        if (!JWSAlgorithm.ES256.equals(header.getAlgorithm())) {
            throw invalid("session token must use ES256");
        }
        if (!JOSEObjectType.JWT.equals(header.getType())) {
            throw invalid("session token must be a JWT");
        }

        String keyId = header.getKeyID();
        if (keyId == null || keyId.isBlank()) {
            throw invalid("session token is missing kid");
        }
        SailGatewayConfig.TrustedKey trustedKey = trustedKey(keyId);
        if (trustedKey == null) {
            throw invalid("session token kid is not trusted");
        }
        verifySignature(jwt, trustedKey);

        JWTClaimsSet claims = claims(jwt);
        String issuer = claims.getIssuer();
        if (!config.registry().registryId().equals(issuer)) {
            throw invalid("session token issuer is not trusted");
        }
        Date expiresAt = claims.getExpirationTime();
        Instant now = clock.instant();
        if (expiresAt == null || !expiresAt.toInstant().isAfter(now)) {
            throw invalid("session token is expired");
        }
        if (!PROTOCOL_VERSION.equals(stringClaim(claims, "protocol_version"))) {
            throw invalid("session token protocol version is unsupported");
        }

        String scope = stringClaim(claims, "scope");
        if (!MINECRAFT_LOGIN_SCOPE.equals(scope)) {
            throw invalid("session token scope is invalid");
        }
        String canonicalName = stringClaim(claims, "canonical_name");
        if (!expectedCanonicalName.equals(canonicalName)) {
            throw invalid("session token canonical name does not match");
        }
        UUID minecraftUuid = uuidClaim(claims, "minecraft_uuid");
        if (!expectedMinecraftUuid.equals(minecraftUuid)) {
            throw invalid("session token Minecraft UUID does not match");
        }
        String serverId = stringClaim(claims, "server_id");

        return new VerifiedSailSession(
                stringClaim(claims, "session_id"),
                stringClaim(claims, "account_id"),
                canonicalName,
                minecraftUuid,
                serverId,
                scope,
                issuer,
                keyId);
    }

    private SignedJWT parseSignedJwt(String token) throws VerificationException {
        try {
            return SignedJWT.parse(token);
        } catch (ParseException e) {
            throw invalid("session token is not a signed JWT", e);
        }
    }

    private JWTClaimsSet claims(SignedJWT jwt) throws VerificationException {
        try {
            return jwt.getJWTClaimsSet();
        } catch (ParseException e) {
            throw invalid("session token claims are invalid", e);
        }
    }

    private SailGatewayConfig.TrustedKey trustedKey(String keyId) {
        for (SailGatewayConfig.TrustedKey trustedKey : config.registry().trustedKeys()) {
            if (keyId.equals(trustedKey.kid())) {
                return trustedKey;
            }
        }
        return null;
    }

    private void verifySignature(SignedJWT jwt, SailGatewayConfig.TrustedKey trustedKey) throws VerificationException {
        ECKey key = ecPublicKey(trustedKey);
        try {
            if (!jwt.verify(new ECDSAVerifier(key))) {
                throw invalid("session token signature is invalid");
            }
        } catch (JOSEException e) {
            throw invalid("session token signature could not be verified", e);
        }
    }

    private ECKey ecPublicKey(SailGatewayConfig.TrustedKey trustedKey) throws VerificationException {
        if (!"ES256".equals(trustedKey.alg()) || !"P-256".equals(trustedKey.crv())) {
            throw invalid("trusted key is not an ES256 P-256 key");
        }
        return new ECKey.Builder(
                        Curve.P_256,
                        new Base64URL(trustedKey.x()),
                        new Base64URL(trustedKey.y()))
                .keyID(trustedKey.kid())
                .algorithm(JWSAlgorithm.ES256)
                .build();
    }

    private String stringClaim(JWTClaimsSet claims, String name) throws VerificationException {
        try {
            String value = claims.getStringClaim(name);
            if (value == null || value.isBlank()) {
                throw invalid("session token claim is missing: " + name);
            }
            return value;
        } catch (ParseException e) {
            throw invalid("session token claim has invalid type: " + name, e);
        }
    }

    private UUID uuidClaim(JWTClaimsSet claims, String name) throws VerificationException {
        try {
            return UUID.fromString(stringClaim(claims, name));
        } catch (IllegalArgumentException e) {
            throw invalid("session token UUID claim is invalid: " + name, e);
        }
    }

    private VerificationException invalid(String message) {
        return new VerificationException(message);
    }

    private VerificationException invalid(String message, Throwable cause) {
        return new VerificationException(message, cause);
    }

    public static final class VerificationException extends Exception {
        public VerificationException(String message) {
            super(message);
        }

        public VerificationException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
