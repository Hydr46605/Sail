package net.sailmc.gateway.registry;

import com.fasterxml.jackson.annotation.JsonProperty;

public record AuthChallengeRequest(
        @JsonProperty("server_id") String serverId,
        String username,
        @JsonProperty("connection_id") String connectionId,
        String mode) {}
