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
                "local-dev",
                false,
                0,
                "kick",
                "local-survival",
                false,
                false,
                0,
                2,
                1,
                "ok",
                null);

        String output = SailStatusRenderer.render(status);

        assertTrue(output.contains("Sail Gateway: initialized"));
        assertTrue(output.contains("Registry: my-network (http://127.0.0.1:8787)"));
        assertTrue(output.contains("Trust posture: local-dev"));
        assertTrue(output.contains("Public key pinning: false"));
        assertTrue(output.contains("Trusted keys: 0"));
        assertTrue(output.contains("Login mode: kick"));
        assertTrue(output.contains("Backend target: local-survival"));
        assertTrue(output.contains("LimboAPI: not required"));
        assertTrue(output.contains("Waiting limbo players: 0"));
        assertTrue(output.contains("Pending challenges: 2"));
        assertTrue(output.contains("Active sessions: 1"));
        assertTrue(output.contains("Registry health: ok"));
    }

    @Test
    void rendersLimboRuntimeStatusWhenRequired() {
        SailGatewayStatus status = new SailGatewayStatus(
                true,
                "my-network",
                URI.create("http://127.0.0.1:8787"),
                "local-dev",
                false,
                0,
                "limbo",
                "survival",
                true,
                true,
                3,
                4,
                1,
                "ok",
                null);

        String output = SailStatusRenderer.render(status);

        assertTrue(output.contains("Login mode: limbo"));
        assertTrue(output.contains("Backend target: survival"));
        assertTrue(output.contains("LimboAPI: required and available"));
        assertTrue(output.contains("Waiting limbo players: 3"));
    }

    @Test
    void rendersUninitializedGatewayStatusWithError() {
        SailGatewayStatus status = SailGatewayStatus.uninitialized("config.yml is invalid");

        String output = SailStatusRenderer.render(status);

        assertTrue(output.contains("Sail Gateway: not initialized"));
        assertTrue(output.contains("Last error: config.yml is invalid"));
    }
}
