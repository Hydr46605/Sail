package net.sailmc.companion.config;

import org.bukkit.configuration.ConfigurationSection;

public record SailCompanionConfig(
        boolean warnOnMissingIdentity,
        boolean warnOnDirectJoinRisk,
        String commandPermission) {
    public static final String DEFAULT_COMMAND_PERMISSION = "sail.companion.admin";

    public static SailCompanionConfig defaults() {
        return new SailCompanionConfig(true, true, DEFAULT_COMMAND_PERMISSION);
    }

    public static SailCompanionConfig from(ConfigurationSection config) {
        SailCompanionConfig defaults = defaults();
        String commandPermission = config.getString(
                "sail.companion.command-permission",
                defaults.commandPermission());
        if (commandPermission == null || commandPermission.isBlank()) {
            commandPermission = defaults.commandPermission();
        }
        return new SailCompanionConfig(
                config.getBoolean(
                        "sail.companion.warn-on-missing-identity",
                        defaults.warnOnMissingIdentity()),
                config.getBoolean(
                        "sail.companion.warn-on-direct-join-risk",
                        defaults.warnOnDirectJoinRisk()),
                commandPermission);
    }
}
