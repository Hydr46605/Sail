package net.sailmc.companion.command;

import java.util.List;
import java.util.Locale;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;
import net.sailmc.companion.config.SailCompanionConfig;
import net.sailmc.companion.identity.SailIdentityRegistry;
import net.sailmc.companion.identity.SailPlayerIdentityState;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabExecutor;

public final class SailPaperCommand implements TabExecutor {
    private static final List<String> ROOT_COMMANDS = List.of("status", "lookup", "reload");

    private final SailIdentityRegistry registry;
    private final Supplier<SailCompanionConfig> config;
    private final BooleanSupplier serverOnlineMode;
    private final BooleanSupplier forwardingSecretFileDetected;
    private final Supplier<String> reload;

    public SailPaperCommand(
            SailIdentityRegistry registry,
            Supplier<SailCompanionConfig> config,
            BooleanSupplier serverOnlineMode,
            BooleanSupplier forwardingSecretFileDetected,
            Supplier<String> reload) {
        this.registry = registry;
        this.config = config;
        this.serverOnlineMode = serverOnlineMode;
        this.forwardingSecretFileDetected = forwardingSecretFileDetected;
        this.reload = reload;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!sender.hasPermission(config.get().commandPermission())) {
            sender.sendMessage("You do not have permission to use Sail Companion commands.");
            return true;
        }

        if (args.length == 0 || "status".equalsIgnoreCase(args[0])) {
            sendLines(sender, SailStatusRenderer.render(
                    true,
                    registry.snapshot(),
                    serverOnlineMode.getAsBoolean(),
                    forwardingSecretFileDetected.getAsBoolean()));
            return true;
        }

        if ("lookup".equalsIgnoreCase(args[0])) {
            if (args.length < 2 || args[1].isBlank()) {
                sender.sendMessage("Usage: /" + label + " lookup <player>");
                return true;
            }
            sendLines(sender, SailLookupRenderer.render(registry.lookupByName(args[1])));
            return true;
        }

        if ("reload".equalsIgnoreCase(args[0])) {
            sender.sendMessage(reload.get());
            return true;
        }

        sender.sendMessage("Usage: /" + label + " status|lookup <player>|reload");
        return true;
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        if (!sender.hasPermission(config.get().commandPermission())) {
            return List.of();
        }

        if (args.length == 1) {
            return matching(ROOT_COMMANDS, args[0]);
        }
        if (args.length == 2 && "lookup".equalsIgnoreCase(args[0])) {
            return matching(registry.snapshot().states().stream()
                    .map(SailPlayerIdentityState::playerName)
                    .sorted(String.CASE_INSENSITIVE_ORDER)
                    .toList(), args[1]);
        }
        return List.of();
    }

    private static void sendLines(CommandSender sender, List<String> lines) {
        for (String line : lines) {
            sender.sendMessage(line);
        }
    }

    private static List<String> matching(List<String> values, String prefix) {
        String normalizedPrefix = prefix.toLowerCase(Locale.ROOT);
        return values.stream()
                .filter(value -> value.toLowerCase(Locale.ROOT).startsWith(normalizedPrefix))
                .toList();
    }
}
