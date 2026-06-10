package net.sailmc.companion.command;

import java.util.ArrayList;
import java.util.List;
import net.sailmc.companion.diagnostic.SailBackendDiagnostics;
import net.sailmc.companion.identity.SailIdentityRegistry;

public final class SailStatusRenderer {
    private SailStatusRenderer() {}

    public static List<String> render(
            boolean initialized,
            SailIdentityRegistry.Snapshot snapshot,
            boolean serverOnlineMode,
            boolean forwardingSecretFileDetected) {
        List<String> lines = new ArrayList<>();
        lines.add("Sail Companion: " + (initialized ? "initialized" : "not initialized"));
        lines.add("Online tracked: " + snapshot.onlinePlayers());
        lines.add("Verified: " + snapshot.verifiedPlayers());
        lines.add("Unverified by Sail: " + snapshot.unverifiedPlayers());
        lines.add("Malformed Sail identity: " + snapshot.malformedPlayers());
        lines.addAll(SailBackendDiagnostics.render(
                serverOnlineMode,
                snapshot.verifiedPlayers(),
                snapshot.unverifiedPlayers(),
                snapshot.malformedPlayers(),
                forwardingSecretFileDetected));
        return List.copyOf(lines);
    }
}
