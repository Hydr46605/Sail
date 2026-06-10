package net.sailmc.gateway.command;

import com.velocitypowered.api.command.SimpleCommand;
import java.util.List;
import java.util.Locale;
import java.util.function.Supplier;

public final class SailAdminCommand implements SimpleCommand {
    public static final String PERMISSION = "sail.admin";

    private static final List<String> SUBCOMMANDS = List.of("status", "reload");

    private final Supplier<SailGatewayStatus> statusSupplier;
    private final Supplier<String> reloadAction;

    public SailAdminCommand(Supplier<SailGatewayStatus> statusSupplier, Supplier<String> reloadAction) {
        this.statusSupplier = statusSupplier;
        this.reloadAction = reloadAction;
    }

    @Override
    public void execute(Invocation invocation) {
        String[] args = invocation.arguments();
        String subcommand = args.length == 0 ? "status" : args[0].toLowerCase(Locale.ROOT);
        switch (subcommand) {
            case "status" -> invocation.source().sendPlainMessage(SailStatusRenderer.render(statusSupplier.get()));
            case "reload" -> invocation.source().sendPlainMessage(reloadAction.get());
            default -> invocation.source().sendPlainMessage("Usage: /sail status | /sail reload");
        }
    }

    @Override
    public List<String> suggest(Invocation invocation) {
        String[] args = invocation.arguments();
        if (args.length == 0) {
            return SUBCOMMANDS;
        }
        String prefix = args[0].toLowerCase(Locale.ROOT);
        return SUBCOMMANDS.stream()
                .filter(subcommand -> subcommand.startsWith(prefix))
                .toList();
    }

    @Override
    public boolean hasPermission(Invocation invocation) {
        return invocation.source().hasPermission(PERMISSION);
    }
}
