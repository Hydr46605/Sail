package net.sailmc.gateway.message;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.URI;
import net.sailmc.gateway.registry.AuthChallengeResponse;
import org.junit.jupiter.api.Test;

class KickMessageRendererTest {
    @Test
    void rendersPlainOAuthOnlyInstructionsWithUrlAndCode() {
        AuthChallengeResponse challenge = new AuthChallengeResponse(
                "sail-protocol-v1",
                "ch_local_0123456789abcdef",
                "pending",
                "local-survival",
                "Example",
                "kick",
                "ABCD-1234",
                URI.create("http://127.0.0.1:8787/auth/minecraft?code=ABCD-1234").toString(),
                "2026-06-06T00:15:00Z");

        String message = KickMessageRenderer.render(challenge);

        assertTrue(message.contains("http://127.0.0.1:8787/auth/minecraft?code=ABCD-1234"));
        assertTrue(message.contains("ABCD-1234"));
        assertTrue(message.contains("OAuth"));
        assertFalse(message.toLowerCase().contains("password"));
    }

    @Test
    void rendersChallengeExpiredMessage() {
        String message = KickMessageRenderer.challengeExpired();

        assertTrue(message.contains("expired"));
        assertTrue(message.contains("Join again"));
    }
}
