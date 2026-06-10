package net.sailmc.gateway.registry;

import com.fasterxml.jackson.annotation.JsonProperty;

public record SessionVerificationRequest(
        @JsonProperty("server_id") String serverId,
        @JsonProperty("session_token") String sessionToken) {}
