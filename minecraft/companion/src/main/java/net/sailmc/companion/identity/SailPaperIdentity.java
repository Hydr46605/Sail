package net.sailmc.companion.identity;

import com.google.gson.annotations.SerializedName;

public record SailPaperIdentity(
        String schema,
        @SerializedName("registry_id") String registryId,
        @SerializedName("server_id") String serverId,
        @SerializedName("session_id") String sessionId,
        @SerializedName("account_id") String accountId,
        @SerializedName("minecraft_identity_id") String minecraftIdentityId,
        @SerializedName("name_claim_id") String nameClaimId,
        @SerializedName("canonical_name") String canonicalName,
        @SerializedName("display_name") String displayName,
        @SerializedName("minecraft_uuid") String minecraftUuid,
        @SerializedName("claim_type") String claimType,
        @SerializedName("identity_type") String identityType,
        String issuer,
        @SerializedName("key_id") String keyId) {
    public static final String SCHEMA = "sail-paper-identity-v1";
}
