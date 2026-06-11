package net.sailmc.gateway.limbo;

import net.sailmc.gateway.config.SailGatewayConfig;

public final class SailLimboRuntime {
    private SailLimboRuntime() {}

    public static boolean requiresLimboApi(SailGatewayConfig config) {
        SailGatewayConfig.UnauthenticatedAction action = config.loginFlow().unauthenticatedAction();
        return action == SailGatewayConfig.UnauthenticatedAction.LIMBO
                || action == SailGatewayConfig.UnauthenticatedAction.HYBRID;
    }

    public static void verifyRuntimeAvailable(SailGatewayConfig config, boolean limboApiAvailable) {
        if (requiresLimboApi(config) && !limboApiAvailable) {
            throw new IllegalStateException(
                    "LimboAPI is required when unauthenticated-action is "
                            + config.loginFlow().unauthenticatedAction().wireValue());
        }
    }
}
