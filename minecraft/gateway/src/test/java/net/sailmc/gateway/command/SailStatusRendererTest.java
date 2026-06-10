package net.sailmc.gateway.command;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.URI;
import org.junit.jupiter.api.Test;

class SailStatusRendererTest {
    @Test
    void rendersInitializedGatewayStatus() {
        SailGatewayStatus status = new SailGatewayStatus(
                true,
                "my-network",
                URI.create("http://127.0.0.1:8787"),
                "kick",
                2,
                1,
                "ok",
                null);

        String output = SailStatusRenderer.render(status);

        assertTrue(output.contains("Sail Gateway: initialized"));
        assertTrue(output.contains("Registry: my-network (http://127.0.0.1:8787)"));
        assertTrue(output.contains("Login mode: kick"));
        assertTrue(output.contains("Pending challenges: 2"));
        assertTrue(output.contains("Active sessions: 1"));
        assertTrue(output.contains("Registry health: ok"));
    }

    @Test
    void rendersUninitializedGatewayStatusWithError() {
        SailGatewayStatus status = SailGatewayStatus.uninitialized("config.yml is invalid");

        String output = SailStatusRenderer.render(status);

        assertTrue(output.contains("Sail Gateway: not initialized"));
        assertTrue(output.contains("Last error: config.yml is invalid"));
    }
}
