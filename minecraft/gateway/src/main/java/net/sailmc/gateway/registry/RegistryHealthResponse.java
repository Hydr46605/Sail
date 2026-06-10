package net.sailmc.gateway.registry;

import com.fasterxml.jackson.annotation.JsonProperty;

public record RegistryHealthResponse(
        @JsonProperty("protocol_version") String protocolVersion,
        String service,
        String status) {}
