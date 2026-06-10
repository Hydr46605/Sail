package net.sailmc.companion.command;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import net.sailmc.companion.identity.SailIdentityParseResult;
import net.sailmc.companion.identity.SailPaperIdentity;
import net.sailmc.companion.identity.SailPlayerIdentityState;

public final class SailLookupRenderer {
    private SailLookupRenderer() {}

    public static List<String> render(Optional<SailPlayerIdentityState> playerState) {
        if (playerState.isEmpty()) {
            return List.of("Player is not tracked online.");
        }

        SailPlayerIdentityState state = playerState.orElseThrow();
        List<String> lines = new ArrayList<>();
        lines.add("Player: " + state.playerName());
        lines.add("UUID: " + state.playerUuid());
        if (state.state() == SailIdentityParseResult.State.VERIFIED) {
            lines.add("Sail state: verified");
            addIdentity(lines, state.identity());
        } else if (state.state() == SailIdentityParseResult.State.UNVERIFIED_BY_SAIL) {
            lines.add("Sail state: unverified_by_sail");
        } else {
            lines.add("Sail state: malformed");
            lines.add("Malformed reason: " + state.malformedReason());
        }
        return List.copyOf(lines);
    }

    private static void addIdentity(List<String> lines, SailPaperIdentity identity) {
        lines.add("Registry: " + identity.registryId());
        lines.add("Server: " + identity.serverId());
        lines.add("Claim type: " + identity.claimType());
        lines.add("Identity type: " + identity.identityType());
        lines.add("Session: " + identity.sessionId());
        if (identity.issuer() != null && !identity.issuer().isBlank()) {
            lines.add("Issuer: " + identity.issuer());
        }
        if (identity.keyId() != null && !identity.keyId().isBlank()) {
            lines.add("Key: " + identity.keyId());
        }
    }
}
