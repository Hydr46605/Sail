package net.sailmc.gateway.limbo;

import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.plugin.PluginContainer;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.api.proxy.server.RegisteredServer;
import com.velocitypowered.api.scheduler.ScheduledTask;
import java.io.IOException;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import net.elytrium.limboapi.api.Limbo;
import net.elytrium.limboapi.api.LimboFactory;
import net.elytrium.limboapi.api.chunk.Dimension;
import net.elytrium.limboapi.api.chunk.VirtualWorld;
import net.elytrium.limboapi.api.event.LoginLimboRegisterEvent;
import net.elytrium.limboapi.api.material.Block;
import net.elytrium.limboapi.api.player.GameMode;
import net.kyori.adventure.text.Component;
import net.sailmc.gateway.bridge.SailGameProfileFactory;
import net.sailmc.gateway.config.SailGatewayConfig;
import net.sailmc.gateway.login.LocalSessionProfile;
import net.sailmc.gateway.login.LoginDecision;
import net.sailmc.gateway.login.SailLoginDecisionService;
import net.sailmc.gateway.message.KickMessageRenderer;
import org.slf4j.Logger;

public final class SailLimboApiController implements SailLimboController {
    private final ProxyServer proxyServer;
    private final Object plugin;
    private final Logger logger;
    private final SailGatewayConfig config;
    private final SailLoginDecisionService loginDecisionService;
    private final LimboFactory limboFactory;
    private final Map<UUID, ScheduledTask> pollingTasks = new ConcurrentHashMap<>();
    private final Limbo limbo;

    public static SailLimboApiController create(
            ProxyServer proxyServer,
            Object plugin,
            Logger logger,
            SailGatewayConfig config,
            SailLoginDecisionService loginDecisionService) {
        Object limboApiPlugin = proxyServer.getPluginManager()
                .getPlugin("limboapi")
                .flatMap(PluginContainer::getInstance)
                .orElseThrow(() -> new IllegalStateException("LimboAPI plugin is loaded without an instance"));
        if (!(limboApiPlugin instanceof LimboFactory factory)) {
            throw new IllegalStateException("LimboAPI plugin instance does not expose LimboFactory");
        }

        SailLimboApiController controller =
                new SailLimboApiController(proxyServer, plugin, logger, config, loginDecisionService, factory);
        proxyServer.getEventManager().register(plugin, controller);
        return controller;
    }

    private SailLimboApiController(
            ProxyServer proxyServer,
            Object plugin,
            Logger logger,
            SailGatewayConfig config,
            SailLoginDecisionService loginDecisionService,
            LimboFactory limboFactory) {
        this.proxyServer = proxyServer;
        this.plugin = plugin;
        this.logger = logger;
        this.config = config;
        this.loginDecisionService = loginDecisionService;
        this.limboFactory = limboFactory;
        this.limbo = createLimbo();
    }

    @Override
    public boolean available() {
        return true;
    }

    @Override
    public int waitingCount() {
        return pollingTasks.size();
    }

    @Override
    public void dispose() {
        proxyServer.getEventManager().unregisterListener(plugin, this);
        pollingTasks.values().forEach(ScheduledTask::cancel);
        pollingTasks.clear();
        limbo.dispose();
    }

    @Subscribe
    public void onLoginLimboRegister(LoginLimboRegisterEvent event) {
        if (!SailLimboRuntime.requiresLimboApi(config)) {
            return;
        }
        event.addOnJoinCallback(() -> routePlayer(event.getPlayer(), true));
    }

    private Limbo createLimbo() {
        VirtualWorld world = limboFactory.createVirtualWorld(Dimension.OVERWORLD, 0.5, 65.0, 0.5, 0.0F, 0.0F);
        world.fillSkyLight(15);
        world.fillBlockLight(15);
        for (int x = -2; x <= 2; x += 1) {
            for (int z = -2; z <= 2; z += 1) {
                world.setBlock(x, 64, z, limboFactory.createSimpleBlock(Block.GLASS));
            }
        }
        return limboFactory.createLimbo(world)
                .setName("Sail Limbo")
                .setReadTimeout((int) config.loginFlow().authTimeout().toMillis())
                .setWorldTime(6_000L)
                .setGameMode(GameMode.ADVENTURE)
                .setShouldRejoin(false)
                .setShouldRespawn(false)
                .setReducedDebugInfo(true)
                .setViewDistance(2)
                .setSimulationDistance(2);
    }

    private void routePlayer(Player player, boolean spawnWhenWaiting) {
        try {
            LoginDecision decision = loginDecisionService.decide(
                    player.getUsername(),
                    player.getRemoteAddress().toString());
            handleDecision(player, decision, spawnWhenWaiting);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            disconnect(player, KickMessageRenderer.registryUnavailable());
        } catch (IOException | RuntimeException error) {
            logger.warn("Sail limbo routing failed for {}", player.getUsername(), error);
            disconnect(player, KickMessageRenderer.registryUnavailable());
        }
    }

    private void handleDecision(Player player, LoginDecision decision, boolean spawnWhenWaiting) {
        if (decision.action() == LoginDecision.Action.WAIT_IN_LIMBO) {
            if (spawnWhenWaiting) {
                player.sendMessage(Component.text(decision.message()));
                limbo.spawnPlayer(player, new SailLimboSessionHandler(() -> stopPolling(player.getUniqueId())));
                startPolling(player);
            }
            return;
        }

        if (decision.action() == LoginDecision.Action.ACCEPT_LOCAL_PROFILE) {
            promoteAndConnect(player, decision.localProfile().orElseThrow());
            return;
        }

        if (decision.action() == LoginDecision.Action.REQUIRE_PREMIUM_AUTH) {
            disconnect(player, "This name requires the official Minecraft account. Reconnect with online-mode auth.");
            return;
        }

        disconnect(player, decision.message());
    }

    private void startPolling(Player player) {
        stopPolling(player.getUniqueId());
        ScheduledTask task = proxyServer.getScheduler()
                .buildTask(plugin, () -> poll(player))
                .delay(config.limbo().pollInterval())
                .repeat(config.limbo().pollInterval())
                .schedule();
        pollingTasks.put(player.getUniqueId(), task);
    }

    private void poll(Player player) {
        if (!player.isActive()) {
            stopPolling(player.getUniqueId());
            return;
        }
        routePlayer(player, false);
    }

    private void promoteAndConnect(Player player, LocalSessionProfile profile) {
        stopPolling(player.getUniqueId());
        player.setGameProfileProperties(SailGameProfileFactory.fromLocalSession(profile).getProperties());
        Optional<RegisteredServer> backend = proxyServer.getServer(config.backend().targetServer());
        if (backend.isEmpty()) {
            disconnect(player, "Sail backend server is not registered: " + config.backend().targetServer());
            return;
        }
        player.createConnectionRequest(backend.orElseThrow()).connect().whenComplete((result, error) -> {
            if (error != null) {
                logger.warn("Sail backend connection failed for {}", player.getUsername(), error);
                disconnect(player, KickMessageRenderer.registryUnavailable());
                return;
            }
            if (result == null || !result.isSuccessful()) {
                disconnect(player, "Sail backend connection failed. Try again later.");
            }
        });
    }

    private void disconnect(Player player, String message) {
        stopPolling(player.getUniqueId());
        player.disconnect(Component.text(message));
    }

    private void stopPolling(UUID playerId) {
        ScheduledTask task = pollingTasks.remove(playerId);
        if (task != null) {
            task.cancel();
        }
    }
}
