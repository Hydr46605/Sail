package net.sailmc.companion.diagnostic;

import java.util.ArrayList;
import java.util.List;

public final class SailBackendDiagnostics {
    private SailBackendDiagnostics() {}

    public static List<String> render(
            boolean serverOnlineMode,
            int verifiedPlayers,
            int unverifiedPlayers,
            int malformedPlayers,
            boolean forwardingSecretFileDetected) {
        List<String> lines = new ArrayList<>();
        lines.add("Verified Sail identities: " + verifiedPlayers);
        lines.add("Unverified by Sail: " + unverifiedPlayers);
        lines.add("Malformed Sail identity: " + malformedPlayers);

        if (serverOnlineMode) {
            lines.add("Warning: Paper online-mode appears enabled; Sail expects a backend behind Velocity forwarding.");
        }
        if (unverifiedPlayers > 0) {
            lines.add("Warning: " + unverifiedPlayers + " online player(s) have no Sail identity.");
        }
        if (malformedPlayers > 0) {
            lines.add("Warning: " + malformedPlayers + " online player(s) have malformed Sail identity.");
        }

        lines.add("Forwarding secret file: " + (forwardingSecretFileDetected ? "detected" : "not detected"));
        lines.add("Firewall state: not proven by this plugin");
        return List.copyOf(lines);
    }
}
