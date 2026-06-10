package net.sailmc.companion;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

final class SailCompanionPackagingTest {
    @Test
    void paperPluginMetadataDeclaresCompanionEntryPointAndAdminCommand() {
        String metadata = readRequiredResource("paper-plugin.yml");

        assertTrue(metadata.contains("name: SailCompanion"));
        assertTrue(metadata.contains("version: 0.1.0-SNAPSHOT"));
        assertTrue(metadata.contains("main: net.sailmc.companion.SailCompanionPlugin"));
        assertTrue(metadata.contains("api-version: \"1.21\""));
        assertTrue(metadata.contains("sailpaper:"));
        assertTrue(metadata.contains("- sailcompanion"));
        assertTrue(metadata.contains("sail.companion.admin:"));
        assertTrue(metadata.contains("default: op"));
    }

    @Test
    void defaultConfigContainsCompanionDiagnosticsOptions() {
        String config = readRequiredResource("config.yml");

        assertTrue(config.contains("""
                sail:
                  companion:
                    warn-on-missing-identity: true
                    warn-on-direct-join-risk: true
                    command-permission: "sail.companion.admin"
                """));
    }

    @Test
    void pluginEntrypointClassIsPackaged() {
        ClassLoader classLoader = SailCompanionPackagingTest.class.getClassLoader();
        URL resource = classLoader.getResource("net/sailmc/companion/SailCompanionPlugin.class");
        assertNotNull(resource, "SailCompanionPlugin.class should be present on the classpath");
    }

    private static String readRequiredResource(String name) {
        ClassLoader classLoader = SailCompanionPackagingTest.class.getClassLoader();
        URL resource = classLoader.getResource(name);
        assertNotNull(resource, () -> name + " should be present on the classpath");
        try {
            return new String(resource.openStream().readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException exception) {
            throw new UncheckedIOException("Failed to read " + name, exception);
        }
    }
}
