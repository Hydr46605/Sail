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

    private static SailGatewayConfig configWithMode(SailGatewayConfig.UnauthenticatedAction action) {
        SailGatewayConfig defaults = SailGatewayConfig.defaults();
        return new SailGatewayConfig(
                defaults.trustPosture(),
                defaults.registry(),
                defaults.server(),
                new SailGatewayConfig.LoginFlow(
                        action,
                        defaults.loginFlow().authTimeout(),
                        defaults.loginFlow().allowRejoinAfterAuth(),
                        defaults.loginFlow().authUrlTemplate()),
                defaults.backend(),
                new SailGatewayConfig.Limbo(Duration.ofSeconds(2)));
    }
}
