package net.sailmc.gateway.bridge;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.velocitypowered.api.util.GameProfile;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

public final class SailPaperIdentityBridge {
    public static final String PROPERTY_NAME = "sail.identity.v1";

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private SailPaperIdentityBridge() {}

    public static String encode(SailPaperIdentity identity) {
        try {
            byte[] json = OBJECT_MAPPER.writeValueAsString(new Payload(identity))
                    .getBytes(StandardCharsets.UTF_8);
            return Base64.getUrlEncoder().withoutPadding().encodeToString(json);
        } catch (IOException exception) {
            throw new IllegalStateException("Failed to encode Sail Paper identity payload", exception);
        }
    }

    public static GameProfile.Property property(SailPaperIdentity identity) {
        return new GameProfile.Property(PROPERTY_NAME, encode(identity), "");
    }

    private record Payload(
            String schema,
            @JsonProperty("registry_id") String registryId,
            @JsonProperty("server_id") String serverId,
            @JsonProperty("session_id") String sessionId,
            @JsonProperty("account_id") String accountId,
            @JsonProperty("minecraft_identity_id") String minecraftIdentityId,
            @JsonProperty("name_claim_id") String nameClaimId,
            @JsonProperty("canonical_name") String canonicalName,
            @JsonProperty("display_name") String displayName,
            @JsonProperty("minecraft_uuid") String minecraftUuid,
            @JsonProperty("claim_type") String claimType,
            @JsonProperty("identity_type") String identityType,
            String issuer,
            @JsonProperty("key_id") String keyId) {
        private Payload(SailPaperIdentity identity) {
            this(
                    SailPaperIdentity.SCHEMA,
                    identity.registryId(),
                    identity.serverId(),
                    identity.sessionId(),
                    identity.accountId(),
                    identity.minecraftIdentityId(),
                    identity.nameClaimId(),
                    identity.canonicalName(),
                    identity.displayName(),
                    identity.minecraftUuid(),
                    identity.claimType(),
                    identity.identityType(),
                    identity.issuer(),
                    identity.keyId());
        }
    }
}
