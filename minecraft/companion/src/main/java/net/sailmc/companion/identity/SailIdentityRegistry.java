package net.sailmc.companion.identity;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public final class SailIdentityRegistry {
    private final Map<UUID, SailPlayerIdentityState> byUuid = new ConcurrentHashMap<>();
    private final Map<String, UUID> byName = new ConcurrentHashMap<>();

    public void markVerified(UUID playerUuid, String playerName, SailPaperIdentity identity) {
        put(SailPlayerIdentityState.verified(playerUuid, playerName, identity));
    }

    public void markUnverified(UUID playerUuid, String playerName) {
        put(SailPlayerIdentityState.unverified(playerUuid, playerName));
    }

    public void markMalformed(UUID playerUuid, String playerName, String reason) {
        put(SailPlayerIdentityState.malformed(playerUuid, playerName, reason));
    }

    public void remove(UUID playerUuid) {
        SailPlayerIdentityState previous = byUuid.remove(playerUuid);
        if (previous != null) {
            byName.remove(normalize(previous.playerName()), playerUuid);
        }
    }

    public void clear() {
        byUuid.clear();
        byName.clear();
    }

    public Optional<SailPlayerIdentityState> lookupByName(String playerName) {
        UUID playerUuid = byName.get(normalize(playerName));
        return playerUuid == null ? Optional.empty() : Optional.ofNullable(byUuid.get(playerUuid));
    }

    public Snapshot snapshot() {
        List<SailPlayerIdentityState> states = List.copyOf(new ArrayList<>(byUuid.values()));
        int verified = 0;
        int unverified = 0;
        int malformed = 0;
        for (SailPlayerIdentityState state : states) {
            if (state.state() == SailIdentityParseResult.State.VERIFIED) {
                verified += 1;
            } else if (state.state() == SailIdentityParseResult.State.UNVERIFIED_BY_SAIL) {
                unverified += 1;
            } else if (state.state() == SailIdentityParseResult.State.MALFORMED) {
                malformed += 1;
            }
        }
        return new Snapshot(states, states.size(), verified, unverified, malformed);
    }

    private void put(SailPlayerIdentityState state) {
        remove(state.playerUuid());
        byUuid.put(state.playerUuid(), state);
        byName.put(normalize(state.playerName()), state.playerUuid());
    }

    private static String normalize(String playerName) {
        return playerName.toLowerCase(Locale.ROOT);
    }

    public record Snapshot(
            List<SailPlayerIdentityState> states,
            int onlinePlayers,
            int verifiedPlayers,
            int unverifiedPlayers,
            int malformedPlayers) {}
}
