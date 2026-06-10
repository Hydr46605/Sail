package net.sailmc.companion.identity;

import com.destroystokyo.paper.profile.ProfileProperty;
import java.util.Optional;
import java.util.function.Supplier;
import java.util.logging.Logger;
import net.sailmc.companion.config.SailCompanionConfig;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

public final class SailIdentityListener implements Listener {
    private final SailIdentityRegistry registry;
    private final SailPaperIdentityParser parser;
    private final Supplier<SailCompanionConfig> config;
    private final Logger logger;

    public SailIdentityListener(
            SailIdentityRegistry registry,
            SailPaperIdentityParser parser,
            Supplier<SailCompanionConfig> config,
            Logger logger) {
        this.registry = registry;
        this.parser = parser;
        this.config = config;
        this.logger = logger;
    }

    @EventHandler
    public void onPlayerJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        SailIdentityParseResult result = parser.parse(
                player.getUniqueId(),
                sailIdentityPropertyValue(player).orElse(null));

        if (result.state() == SailIdentityParseResult.State.VERIFIED) {
            registry.markVerified(player.getUniqueId(), player.getName(), result.identity());
            return;
        }

        if (result.state() == SailIdentityParseResult.State.UNVERIFIED_BY_SAIL) {
            registry.markUnverified(player.getUniqueId(), player.getName());
            if (config.get().warnOnMissingIdentity()) {
                logger.warning("No Sail identity property received for " + player.getName() + ".");
            }
            return;
        }

        registry.markMalformed(player.getUniqueId(), player.getName(), result.reason());
        logger.warning("Malformed Sail identity property received for " + player.getName() + ": " + result.reason());
    }

    @EventHandler
    public void onPlayerQuit(PlayerQuitEvent event) {
        registry.remove(event.getPlayer().getUniqueId());
    }

    private static Optional<String> sailIdentityPropertyValue(Player player) {
        return player.getPlayerProfile().getProperties().stream()
                .filter(property -> SailPaperIdentityParser.PROPERTY_NAME.equals(property.getName()))
                .findFirst()
                .map(ProfileProperty::getValue);
    }
}
