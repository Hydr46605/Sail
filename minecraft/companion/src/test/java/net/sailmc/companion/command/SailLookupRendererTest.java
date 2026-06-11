package net.sailmc.companion.command;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import net.sailmc.companion.identity.SailPaperIdentity;
import net.sailmc.companion.identity.SailPlayerIdentityState;
import org.junit.jupiter.api.Test;

class SailLookupRendererTest {
    private static final UUID PLAYER_UUID = UUID.fromString("00000000-0000-4000-8000-000000000001");

    @Test
    void rendersVerifiedPlayerIdentityDetails() {
        List<String> lines = SailLookupRenderer.render(Optional.of(SailPlayerIdentityState.verified(
                PLAYER_UUID,
                "Example",
                identity())));

        String output = String.join("\n", lines);
        assertTrue(output.contains("Player: Example"));
        assertTrue(output.contains("UUID: " + PLAYER_UUID));
        assertTrue(output.contains("Sail state: verified"));
        assertTrue(output.contains("Registry: sail-local"));
        assertTrue(output.contains("Server: local-survival"));
        assertTrue(output.contains("Claim type: LOCAL_SOFT"));
        assertTrue(output.contains("Identity type: SAIL_LOCAL"));
        assertTrue(output.contains("Session: sess_local_0123456789abcdef"));
        assertTrue(output.contains("Boundary: backend-visible identity; gateway remains enforcement"));
        assertTrue(output.contains("Issuer: my-network"));
        assertTrue(output.contains("Key: dev-es256-2026-06"));
    }

    @Test
    void rendersUnverifiedPlayerState() {
        List<String> lines = SailLookupRenderer.render(Optional.of(SailPlayerIdentityState.unverified(
                PLAYER_UUID,
                "NoSail")));

        String output = String.join("\n", lines);
        assertTrue(output.contains("Player: NoSail"));
        assertTrue(output.contains("Sail state: unverified_by_sail"));
    }

    @Test
    void rendersMalformedPlayerReason() {
        List<String> lines = SailLookupRenderer.render(Optional.of(SailPlayerIdentityState.malformed(
                PLAYER_UUID,
                "Broken",
                "invalid_json")));

        String output = String.join("\n", lines);
        assertTrue(output.contains("Player: Broken"));
        assertTrue(output.contains("Sail state: malformed"));
        assertTrue(output.contains("Malformed reason: invalid_json"));
    }

    @Test
    void rendersMissingPlayer() {
        List<String> lines = SailLookupRenderer.render(Optional.empty());

        assertTrue(String.join("\n", lines).contains("Player is not tracked online."));
    }

    private static SailPaperIdentity identity() {
        return new SailPaperIdentity(
                "sail-paper-identity-v1",
                "sail-local",
                "local-survival",
                "sess_local_0123456789abcdef",
                "acct_local_0123456789abcdef",
                "mcid_local_0123456789abcdef",
                "claim_local_0123456789abcdef",
                "example",
                "Example",
                PLAYER_UUID.toString(),
                "LOCAL_SOFT",
                "SAIL_LOCAL",
                "my-network",
                "dev-es256-2026-06");
    }
}
