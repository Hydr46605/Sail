package net.sailmc.companion.identity;

import java.util.UUID;

public record SailPlayerIdentityState(
        UUID playerUuid,
        String playerName,
        SailIdentityParseResult.State state,
        SailPaperIdentity identity,
        String malformedReason) {
    public static SailPlayerIdentityState verified(UUID playerUuid, String playerName, SailPaperIdentity identity) {
        return new SailPlayerIdentityState(
                playerUuid,
                playerName,
                SailIdentityParseResult.State.VERIFIED,
                identity,
                "");
    }

    public static SailPlayerIdentityState unverified(UUID playerUuid, String playerName) {
        return new SailPlayerIdentityState(
                playerUuid,
                playerName,
                SailIdentityParseResult.State.UNVERIFIED_BY_SAIL,
                null,
                "");
    }

    public static SailPlayerIdentityState malformed(UUID playerUuid, String playerName, String reason) {
        return new SailPlayerIdentityState(
                playerUuid,
                playerName,
                SailIdentityParseResult.State.MALFORMED,
                null,
                reason);
    }
}
