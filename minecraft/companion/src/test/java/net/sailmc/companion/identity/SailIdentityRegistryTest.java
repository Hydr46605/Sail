package net.sailmc.companion.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.UUID;
import org.junit.jupiter.api.Test;

class SailIdentityRegistryTest {
    private static final UUID PLAYER_UUID = UUID.fromString("00000000-0000-4000-8000-000000000001");

    @Test
    void tracksVerifiedUnverifiedAndMalformedCounts() {
        SailIdentityRegistry registry = new SailIdentityRegistry();

        registry.markVerified(PLAYER_UUID, "Example", identity());
        registry.markUnverified(UUID.fromString("00000000-0000-4000-8000-000000000002"), "NoSail");
        registry.markMalformed(UUID.fromString("00000000-0000-4000-8000-000000000003"), "Broken", "invalid_json");

        SailIdentityRegistry.Snapshot snapshot = registry.snapshot();
        assertEquals(1, snapshot.verifiedPlayers());
        assertEquals(1, snapshot.unverifiedPlayers());
        assertEquals(1, snapshot.malformedPlayers());
    }

    @Test
    void lookupByNameIsCaseInsensitiveForOnlinePlayers() {
        SailIdentityRegistry registry = new SailIdentityRegistry();
        registry.markVerified(PLAYER_UUID, "Example", identity());

        SailPlayerIdentityState state = registry.lookupByName("eXaMpLe").orElseThrow();

        assertEquals(PLAYER_UUID, state.playerUuid());
        assertEquals("Example", state.playerName());
        assertEquals(SailIdentityParseResult.State.VERIFIED, state.state());
    }

    @Test
    void removeClearsPlayerStateAndNameIndex() {
        SailIdentityRegistry registry = new SailIdentityRegistry();
        registry.markVerified(PLAYER_UUID, "Example", identity());

        registry.remove(PLAYER_UUID);

        assertTrue(registry.lookupByName("example").isEmpty());
        assertEquals(0, registry.snapshot().onlinePlayers());
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
