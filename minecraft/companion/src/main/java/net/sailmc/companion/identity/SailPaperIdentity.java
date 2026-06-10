package net.sailmc.companion.identity;

import com.fasterxml.jackson.annotation.JsonProperty;

public record SailPaperIdentity(
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
    public static final String SCHEMA = "sail-paper-identity-v1";
}
