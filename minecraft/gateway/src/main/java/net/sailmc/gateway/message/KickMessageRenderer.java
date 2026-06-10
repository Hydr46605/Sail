package net.sailmc.gateway.message;

import net.sailmc.gateway.registry.AuthChallengeResponse;

public final class KickMessageRenderer {
    private KickMessageRenderer() {}

    public static String render(AuthChallengeResponse challenge) {
        return """
                Sail authentication required

                Open this OAuth link:
                %s

                Code: %s

                Rejoin after completing the browser login.
                """.formatted(challenge.authUrl(), challenge.code()).stripTrailing();
    }

    public static String registryUnavailable() {
        return """
                Sail authentication is unavailable right now.

                Try again in a few minutes or contact a server admin.
                """.stripTrailing();
    }

    public static String registryRejection(String message) {
        return """
                Sail authentication rejected

                %s
                """.formatted(message).stripTrailing();
    }

    public static String unsupportedLimboMode() {
        return """
                Sail limbo mode is not available in this build.

                Ask a server admin to use kick or hybrid login mode.
                """.stripTrailing();
    }
}
