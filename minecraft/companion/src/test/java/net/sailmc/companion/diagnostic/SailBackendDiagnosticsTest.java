package net.sailmc.companion.diagnostic;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

class SailBackendDiagnosticsTest {
    @Test
    void rendersWarningsForBackendLocalRiskSignals() {
        List<String> lines = SailBackendDiagnostics.render(
                true,
                2,
                1,
                1,
                false);

        String output = String.join("\n", lines);
        assertTrue(output.contains("Warning: Paper online-mode appears enabled"));
        assertTrue(output.contains("Warning: 1 online player(s) have no Sail identity"));
        assertTrue(output.contains("Warning: 1 online player(s) have malformed Sail identity"));
        assertTrue(output.contains("Forwarding secret file: not detected"));
        assertTrue(output.contains("Firewall state: not proven by this plugin"));
        assertFalse(output.toLowerCase().contains("firewall is safe"));
    }

    @Test
    void stillDoesNotClaimFirewallSafetyWhenForwardingFileIsDetected() {
        List<String> lines = SailBackendDiagnostics.render(
                false,
                2,
                0,
                0,
                true);

        String output = String.join("\n", lines);
        assertTrue(output.contains("Forwarding secret file: detected"));
        assertTrue(output.contains("Firewall state: not proven by this plugin"));
        assertFalse(output.toLowerCase().contains("firewall is safe"));
    }
}
