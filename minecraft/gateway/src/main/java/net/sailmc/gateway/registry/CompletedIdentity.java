package net.sailmc.gateway.registry;

import com.fasterxml.jackson.annotation.JsonProperty;

public record CompletedIdentity(
        @JsonProperty("account_id") String accountId,
        @JsonProperty("minecraft_identity_id") String minecraftIdentityId,
        @JsonProperty("name_claim_id") String nameClaimId,
        @JsonProperty("canonical_name") String canonicalName,
        @JsonProperty("display_name") String displayName,
        @JsonProperty("minecraft_uuid") String minecraftUuid,
        @JsonProperty("claim_type") String claimType,
        @JsonProperty("identity_type") String identityType,
        @JsonProperty("session_id") String sessionId,
        @JsonProperty("session_token") String sessionToken) {}
