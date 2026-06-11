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
                false,
                true);

        String output = String.join("\n", lines);
        assertTrue(output.contains("Warning: Paper online-mode appears enabled"));
        assertTrue(output.contains("Warning: 1 online player(s) have no Sail identity"));
        assertTrue(output.contains("Warning: 1 online player(s) have malformed Sail identity"));
        assertTrue(output.contains("Forwarding secret file: not detected"));
        assertTrue(output.contains("Gateway mode: not proven by this plugin"));
        assertTrue(output.contains("Velocity /sail status"));
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
                true,
                true);

        String output = String.join("\n", lines);
        assertTrue(output.contains("Forwarding secret file: detected"));
        assertTrue(output.contains("Gateway mode: not proven by this plugin"));
        assertTrue(output.contains("Firewall state: not proven by this plugin"));
        assertFalse(output.toLowerCase().contains("firewall is safe"));
    }

    @Test
    void suppressesDirectJoinWarningsWhenConfiguredOff() {
        List<String> lines = SailBackendDiagnostics.render(
                true,
                2,
                1,
                1,
                false,
                false);

        String output = String.join("\n", lines);
        assertFalse(output.contains("Paper online-mode appears enabled"));
        assertFalse(output.contains("have no Sail identity"));
        assertFalse(output.contains("have malformed Sail identity"));
        assertTrue(output.contains("Forwarding secret file: not detected"));
        assertTrue(output.contains("Gateway mode: not proven by this plugin"));
        assertTrue(output.contains("Firewall state: not proven by this plugin"));
    }
}
