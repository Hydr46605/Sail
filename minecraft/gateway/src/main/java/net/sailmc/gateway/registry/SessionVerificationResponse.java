package net.sailmc.gateway.registry;

import com.fasterxml.jackson.annotation.JsonProperty;

public record SessionVerificationResponse(
        @JsonProperty("protocol_version") String protocolVersion,
        @JsonProperty("session_id") String sessionId,
        String status,
        @JsonProperty("server_id") String serverId,
        @JsonProperty("issuer_server_id") String issuerServerId,
        @JsonProperty("session_reuse_policy") String sessionReusePolicy,
        @JsonProperty("canonical_name") String canonicalName,
        @JsonProperty("minecraft_uuid") String minecraftUuid) {}
