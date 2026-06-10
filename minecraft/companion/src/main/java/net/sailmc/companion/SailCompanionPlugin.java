package net.sailmc.companion;

import java.nio.file.Files;
import java.nio.file.Path;
import net.sailmc.companion.command.SailPaperCommand;
import net.sailmc.companion.config.SailCompanionConfig;
import net.sailmc.companion.identity.SailIdentityListener;
import net.sailmc.companion.identity.SailIdentityRegistry;
import net.sailmc.companion.identity.SailPaperIdentityParser;
import org.bukkit.command.PluginCommand;
import org.bukkit.plugin.java.JavaPlugin;

public final class SailCompanionPlugin extends JavaPlugin {
    private static final String COMMAND_NAME = "sailpaper";

    private final SailIdentityRegistry identityRegistry = new SailIdentityRegistry();
    private final SailPaperIdentityParser identityParser = new SailPaperIdentityParser();
    private volatile SailCompanionConfig companionConfig = SailCompanionConfig.defaults();

    @Override
    public void onEnable() {
        saveDefaultConfig();
        reloadRuntimeConfig();
        getServer().getPluginManager().registerEvents(new SailIdentityListener(
                identityRegistry,
                identityParser,
                () -> companionConfig,
                getLogger()), this);
        getLogger().info("SailCompanion is enabled in diagnostics-only mode.");
        registerSailPaperCommand();
    }

    @Override
    public void onDisable() {
        clearRuntimeState();
    }

    private void registerSailPaperCommand() {
        PluginCommand command = getCommand(COMMAND_NAME);
        if (command == null) {
            getLogger().warning("Command metadata for /" + COMMAND_NAME + " was not exposed; registration skipped.");
            return;
        }

        SailPaperCommand sailPaperCommand = new SailPaperCommand(
                identityRegistry,
                () -> companionConfig,
                () -> getServer().getOnlineMode(),
                this::forwardingSecretFileDetected,
                this::reloadRuntimeConfig);
        command.setExecutor(sailPaperCommand);
        command.setTabCompleter(sailPaperCommand);
    }

    public String reloadRuntimeConfig() {
        reloadConfig();
        companionConfig = SailCompanionConfig.from(getConfig());
        return "Sail Companion reloaded.";
    }

    public SailCompanionConfig companionConfig() {
        return companionConfig;
    }

    public SailIdentityRegistry identityRegistry() {
        return identityRegistry;
    }

    private void clearRuntimeState() {
        identityRegistry.clear();
    }

    private boolean forwardingSecretFileDetected() {
        Path pluginsDirectory = getDataFolder().toPath().getParent();
        if (pluginsDirectory == null || pluginsDirectory.getParent() == null) {
            return false;
        }
        Path serverRoot = pluginsDirectory.getParent();
        return Files.exists(serverRoot.resolve("forwarding.secret"))
                || Files.exists(serverRoot.resolve("velocity-forwarding.secret"))
                || Files.exists(serverRoot.resolve("config").resolve("paper-global.yml"));
    }
}
