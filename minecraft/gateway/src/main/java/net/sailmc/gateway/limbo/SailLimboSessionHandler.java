package net.sailmc.gateway.limbo;

import net.elytrium.limboapi.api.LimboSessionHandler;

final class SailLimboSessionHandler implements LimboSessionHandler {
    private final Runnable onDisconnect;

    SailLimboSessionHandler(Runnable onDisconnect) {
        this.onDisconnect = onDisconnect;
    }

    @Override
    public void onDisconnect() {
        onDisconnect.run();
    }
}
