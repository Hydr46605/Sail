package net.sailmc.gateway.registry;

import com.fasterxml.jackson.annotation.JsonProperty;

public record AuthChallengeResponse(
        @JsonProperty("protocol_version") String protocolVersion,
        @JsonProperty("challenge_id") String challengeId,
        String status,
        @JsonProperty("server_id") String serverId,
        @JsonProperty("requested_name") String requestedName,
        String mode,
        String code,
        @JsonProperty("auth_url") String authUrl,
        @JsonProperty("expires_at") String expiresAt) {}
