package net.sailmc.gateway;

import com.google.inject.Inject;
import com.velocitypowered.api.event.EventTask;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.connection.PreLoginEvent;
import com.velocitypowered.api.event.player.GameProfileRequestEvent;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.plugin.Plugin;
import com.velocitypowered.api.plugin.annotation.DataDirectory;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.api.proxy.InboundConnection;
import java.io.IOException;
import java.net.http.HttpClient;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import net.kyori.adventure.text.Component;
import net.sailmc.gateway.bridge.SailGameProfileFactory;
import net.sailmc.gateway.command.SailAdminCommand;
import net.sailmc.gateway.command.SailGatewayStatus;
import net.sailmc.gateway.config.SailGatewayConfig;
import net.sailmc.gateway.login.LocalSessionProfile;
import net.sailmc.gateway.login.LoginDecision;
import net.sailmc.gateway.login.SailLoginDecisionService;
import net.sailmc.gateway.message.KickMessageRenderer;
import net.sailmc.gateway.registry.HttpSailRegistryClient;
import net.sailmc.gateway.registry.RegistryHealthResponse;
import org.slf4j.Logger;

@Plugin(
        id = "sail-gateway",
        name = "Sail Gateway",
        version = "0.1.0-SNAPSHOT",
        description = "Proof-of-name authentication gateway for Velocity.",
        authors = {"BerylLabs"})
public final class SailGatewayPlugin {
    private final ProxyServer proxyServer;
    private final Logger logger;
    private final Path dataDirectory;
    private final Map<InboundConnection, LocalSessionProfile> acceptedProfiles = new ConcurrentHashMap<>();
    private volatile SailGatewayConfig config;
    private volatile HttpSailRegistryClient registryClient;
    private volatile SailLoginDecisionService loginDecisionService;
    private volatile String lastInitializationError;

    @Inject
    public SailGatewayPlugin(ProxyServer proxyServer, Logger logger, @DataDirectory Path dataDirectory) {
        this.proxyServer = proxyServer;
        this.logger = logger;
        this.dataDirectory = dataDirectory;
    }

    @Subscribe
    public void onProxyInitialize(ProxyInitializeEvent event) {
        registerCommands();
        String reloadMessage = reloadGateway();
        if (lastInitializationError == null) {
            logger.info(reloadMessage);
        } else {
            logger.error(reloadMessage);
        }
    }

    private void registerCommands() {
        var commandManager = proxyServer.getCommandManager();
        var metadata = commandManager.metaBuilder("sail")
                .aliases("sailgateway")
                .plugin(this)
                .build();
        commandManager.register(metadata, new SailAdminCommand(this::statusSnapshot, this::reloadGateway));
    }

    private String reloadGateway() {
        try {
            Files.createDirectories(dataDirectory);
            Path configPath = dataDirectory.resolve("config.yml");
            if (Files.notExists(configPath)) {
                SailGatewayConfig.writeDefault(configPath);
            }
            SailGatewayConfig loadedConfig = SailGatewayConfig.load(configPath);
            HttpSailRegistryClient registryClient = new HttpSailRegistryClient(
                    HttpClient.newHttpClient(),
                    loadedConfig.registry().apiUrl(),
                    loadedConfig.loginFlow().authTimeout());
            this.config = loadedConfig;
            this.registryClient = registryClient;
            this.loginDecisionService = new SailLoginDecisionService(loadedConfig, registryClient);
            this.lastInitializationError = null;
            return "Sail Gateway reloaded.";
        } catch (IOException | RuntimeException error) {
            this.config = null;
            this.registryClient = null;
            this.loginDecisionService = null;
            this.lastInitializationError = error.getMessage();
            logger.error("Sail Gateway failed to initialize", error);
            return "Sail Gateway reload failed: " + this.lastInitializationError;
        }
    }

    private SailGatewayStatus statusSnapshot() {
        SailGatewayConfig currentConfig = config;
        HttpSailRegistryClient currentRegistry = registryClient;
        SailLoginDecisionService currentLoginService = loginDecisionService;
        if (currentConfig == null || currentRegistry == null || currentLoginService == null) {
            return SailGatewayStatus.uninitialized(lastInitializationError);
        }

        String registryHealth = "unavailable";
        try {
            RegistryHealthResponse response = currentRegistry.getHealth();
            registryHealth = response.status();
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
        } catch (IOException | RuntimeException ignored) {
            registryHealth = "unavailable";
        }

        return new SailGatewayStatus(
                true,
                currentConfig.registry().registryId(),
                currentConfig.registry().apiUrl(),
                currentConfig.loginFlow().unauthenticatedAction().wireValue(),
                currentLoginService.pendingChallengeCount(),
                currentLoginService.activeSessionCount(),
                registryHealth,
                null);
    }

    @Subscribe
    public EventTask onPreLogin(PreLoginEvent event) {
        return EventTask.async(() -> handlePreLogin(event));
    }

    private void handlePreLogin(PreLoginEvent event) {
        SailLoginDecisionService service = loginDecisionService;
        if (service == null) {
            event.setResult(PreLoginEvent.PreLoginComponentResult.denied(
                    Component.text(KickMessageRenderer.registryUnavailable())));
            return;
        }

        try {
            LoginDecision decision = service.decide(
                    event.getUsername(),
                    event.getConnection().getRemoteAddress().toString());
            if (decision.action() == LoginDecision.Action.KICK) {
                event.setResult(PreLoginEvent.PreLoginComponentResult.denied(Component.text(decision.message())));
            } else if (decision.action() == LoginDecision.Action.REQUIRE_PREMIUM_AUTH) {
                event.setResult(PreLoginEvent.PreLoginComponentResult.forceOnlineMode());
            } else if (decision.action() == LoginDecision.Action.ACCEPT_LOCAL_PROFILE) {
                acceptedProfiles.put(event.getConnection(), decision.localProfile().orElseThrow());
                event.setResult(PreLoginEvent.PreLoginComponentResult.forceOfflineMode());
            }
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            event.setResult(PreLoginEvent.PreLoginComponentResult.denied(
                    Component.text(KickMessageRenderer.registryUnavailable())));
        } catch (IOException | RuntimeException error) {
            logger.warn("Sail registry challenge failed for {}", event.getUsername(), error);
            event.setResult(PreLoginEvent.PreLoginComponentResult.denied(
                    Component.text(KickMessageRenderer.registryUnavailable())));
        }
    }

    @Subscribe
    public void onGameProfileRequest(GameProfileRequestEvent event) {
        LocalSessionProfile profile = acceptedProfiles.remove(event.getConnection());
        if (profile == null) {
            return;
        }
        event.setGameProfile(SailGameProfileFactory.fromLocalSession(profile));
    }
}
