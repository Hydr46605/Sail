package net.sailmc.gateway.limbo;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import net.sailmc.gateway.config.SailGatewayConfig;
import org.junit.jupiter.api.Test;

class SailLimboRuntimeTest {
    @Test
    void doesNotRequireLimboApiForKickMode() {
        assertFalse(SailLimboRuntime.requiresLimboApi(SailGatewayConfig.defaults()));
    }

    @Test
    void requiresLimboApiForLimboAndHybridModes() {
        assertTrue(SailLimboRuntime.requiresLimboApi(configWithMode(SailGatewayConfig.UnauthenticatedAction.LIMBO)));
        assertTrue(SailLimboRuntime.requiresLimboApi(configWithMode(SailGatewayConfig.UnauthenticatedAction.HYBRID)));
    }

    @Test
    void failsClosedWhenLimboBackedModeDoesNotHaveLimboApi() {
        IllegalStateException error = assertThrows(
                IllegalStateException.class,
                () -> SailLimboRuntime.verifyRuntimeAvailable(
                        configWithMode(SailGatewayConfig.UnauthenticatedAction.LIMBO),
                        false));

        assertTrue(error.getMessage().contains("LimboAPI is required"));
    }

    @Test
    void acceptsLimboBackedModeWhenLimboApiIsAvailable() {
        SailLimboRuntime.verifyRuntimeAvailable(
                configWithMode(SailGatewayConfig.UnauthenticatedAction.HYBRID),
                true);
    }

    @Test
    void failsClosedWhenPollIntervalCannotRunBeforeAuthTimeout() {
        IllegalStateException error = assertThrows(
                IllegalStateException.class,
                () -> SailLimboRuntime.verifyRuntimeAvailable(
                        configWithModeAndTiming(
                                SailGatewayConfig.UnauthenticatedAction.LIMBO,
                                Duration.ofSeconds(2),
                                Duration.ofSeconds(2)),
                        true));

        assertTrue(error.getMessage().contains("limbo poll interval must be shorter than auth timeout"));
    }

    @Test
    void failsClosedWhenAuthTimeoutCannotBePassedToLimboApi() {
        IllegalStateException error = assertThrows(
                IllegalStateException.class,
                () -> SailLimboRuntime.verifyRuntimeAvailable(
                        configWithModeAndTiming(
                                SailGatewayConfig.UnauthenticatedAction.LIMBO,
                                Duration.ofDays(30),
                                Duration.ofSeconds(2)),
                        true));

        assertTrue(error.getMessage().contains("auth timeout is too large for LimboAPI"));
    }

    private static SailGatewayConfig configWithMode(SailGatewayConfig.UnauthenticatedAction action) {
        return configWithModeAndTiming(action, Duration.ofSeconds(180), Duration.ofSeconds(2));
    }

    private static SailGatewayConfig configWithModeAndTiming(
            SailGatewayConfig.UnauthenticatedAction action,
            Duration authTimeout,
            Duration pollInterval) {
        SailGatewayConfig defaults = SailGatewayConfig.defaults();
        return new SailGatewayConfig(
                defaults.trustPosture(),
                defaults.registry(),
                defaults.server(),
                new SailGatewayConfig.LoginFlow(
                        action,
                        authTimeout,
                        defaults.loginFlow().allowRejoinAfterAuth(),
                        defaults.loginFlow().authUrlTemplate()),
                defaults.backend(),
                new SailGatewayConfig.Limbo(pollInterval));
    }
}
