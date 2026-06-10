package net.sailmc.companion.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

class SailCompanionConfigTest {
    @Test
    void readsDefaultCompanionSettings() {
        YamlConfiguration yaml = new YamlConfiguration();
        yaml.set("sail.companion.warn-on-missing-identity", true);
        yaml.set("sail.companion.warn-on-direct-join-risk", true);
        yaml.set("sail.companion.command-permission", "sail.companion.admin");

        SailCompanionConfig config = SailCompanionConfig.from(yaml);

        assertTrue(config.warnOnMissingIdentity());
        assertTrue(config.warnOnDirectJoinRisk());
        assertEquals("sail.companion.admin", config.commandPermission());
    }

    @Test
    void blankCommandPermissionFallsBackToDefault() {
        YamlConfiguration yaml = new YamlConfiguration();
        yaml.set("sail.companion.command-permission", " ");

        SailCompanionConfig config = SailCompanionConfig.from(yaml);

        assertEquals("sail.companion.admin", config.commandPermission());
    }
}
