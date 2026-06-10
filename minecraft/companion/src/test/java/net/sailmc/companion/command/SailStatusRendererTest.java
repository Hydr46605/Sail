package net.sailmc.companion.command;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import net.sailmc.companion.identity.SailIdentityRegistry;
import org.junit.jupiter.api.Test;

class SailStatusRendererTest {
    @Test
    void rendersCompanionStatusCountsAndWarnings() {
        List<String> lines = SailStatusRenderer.render(
                true,
                new SailIdentityRegistry.Snapshot(List.of(), 4, 2, 1, 1),
                true,
                false);

        String output = String.join("\n", lines);
        assertTrue(output.contains("Sail Companion: initialized"));
        assertTrue(output.contains("Online tracked: 4"));
        assertTrue(output.contains("Verified: 2"));
        assertTrue(output.contains("Unverified by Sail: 1"));
        assertTrue(output.contains("Malformed Sail identity: 1"));
        assertTrue(output.contains("Warning: Paper online-mode appears enabled"));
        assertTrue(output.contains("Firewall state: not proven by this plugin"));
        assertFalse(output.toLowerCase().contains("firewall is safe"));
    }
}
