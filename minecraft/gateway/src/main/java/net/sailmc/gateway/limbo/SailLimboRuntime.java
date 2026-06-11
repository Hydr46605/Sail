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
        if (!requiresLimboApi(config)) {
            return;
        }
        if (!limboApiAvailable) {
            throw new IllegalStateException(
                    "LimboAPI is required when unauthenticated-action is "
                            + config.loginFlow().unauthenticatedAction().wireValue());
        }
        if (!config.limbo().pollInterval().minus(config.loginFlow().authTimeout()).isNegative()) {
            throw new IllegalStateException("limbo poll interval must be shorter than auth timeout");
        }
        readTimeoutMillis(config);
    }

    public static int readTimeoutMillis(SailGatewayConfig config) {
        long timeoutMillis = config.loginFlow().authTimeout().toMillis();
        if (timeoutMillis > Integer.MAX_VALUE) {
            throw new IllegalStateException("auth timeout is too large for LimboAPI");
        }
        return (int) timeoutMillis;
    }
}
