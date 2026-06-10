package net.sailmc.gateway.registry;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Optional;

public final class AuthChallengeStatusResponse {
    private final String protocolVersion;
    private final String challengeId;
    private final String status;
    private final String expiresAt;
    private final Optional<String> completedAt;
    private final Optional<CompletedIdentity> identity;

    public AuthChallengeStatusResponse(
            String protocolVersion,
            String challengeId,
            String status,
            String expiresAt,
            Optional<String> completedAt,
            Optional<CompletedIdentity> identity) {
        this.protocolVersion = protocolVersion;
        this.challengeId = challengeId;
        this.status = status;
        this.expiresAt = expiresAt;
        this.completedAt = completedAt;
        this.identity = identity;
    }

    @JsonCreator
    AuthChallengeStatusResponse(
            @JsonProperty("protocol_version") String protocolVersion,
            @JsonProperty("challenge_id") String challengeId,
            @JsonProperty("status") String status,
            @JsonProperty("expires_at") String expiresAt,
            @JsonProperty("completed_at") String completedAt,
            @JsonProperty("identity") CompletedIdentity identity) {
        this(
                protocolVersion,
                challengeId,
                status,
                expiresAt,
                Optional.ofNullable(completedAt),
                Optional.ofNullable(identity));
    }

    @JsonProperty("protocol_version")
    public String protocolVersion() {
        return protocolVersion;
    }

    @JsonProperty("challenge_id")
    public String challengeId() {
        return challengeId;
    }

    public String status() {
        return status;
    }

    @JsonProperty("expires_at")
    public String expiresAt() {
        return expiresAt;
    }

    public Optional<String> completedAt() {
        return completedAt;
    }

    public Optional<CompletedIdentity> identity() {
        return identity;
    }
}
