package net.sailmc.gateway.command;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.velocitypowered.api.command.CommandSource;
import com.velocitypowered.api.command.SimpleCommand;
import com.velocitypowered.api.permission.Tristate;
import java.lang.reflect.Proxy;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class SailAdminCommandTest {
    @Test
    void statusCommandSendsCurrentGatewayStatus() {
        RecordingSource source = new RecordingSource(true);
        SailAdminCommand command = new SailAdminCommand(
                () -> new SailGatewayStatus(
                        true,
                        "my-network",
                        URI.create("http://127.0.0.1:8787"),
                        "local-dev",
                        false,
                        0,
                        "kick",
                        "local-survival",
                        180,
                        2,
                        false,
                        false,
                        0,
                        0,
                        0,
                        "ok",
                        "never",
                        null),
                () -> "Sail Gateway reloaded.");

        command.execute(new TestInvocation(source.proxy(), new String[] {"status"}));

        assertEquals(1, source.messages.size());
        assertTrue(source.messages.getFirst().contains("Sail Gateway: initialized"));
        assertTrue(source.messages.getFirst().contains("Registry health: ok"));
    }

    @Test
    void reloadCommandCallsReloadAction() {
        RecordingSource source = new RecordingSource(true);
        int[] reloads = {0};
        SailAdminCommand command = new SailAdminCommand(
                () -> SailGatewayStatus.uninitialized("not loaded"),
                () -> {
                    reloads[0] += 1;
                    return "Sail Gateway reloaded.";
                });

        command.execute(new TestInvocation(source.proxy(), new String[] {"reload"}));

        assertEquals(1, reloads[0]);
        assertEquals("Sail Gateway reloaded.", source.messages.getFirst());
    }

    @Test
    void suggestsKnownSubcommandsAndRequiresAdminPermission() {
        RecordingSource allowed = new RecordingSource(true);
        RecordingSource denied = new RecordingSource(false);
        SailAdminCommand command = new SailAdminCommand(
                () -> SailGatewayStatus.uninitialized("not loaded"),
                () -> "reloaded");

        assertEquals(List.of("status", "reload"), command.suggest(new TestInvocation(allowed.proxy(), new String[0])));
        assertTrue(command.hasPermission(new TestInvocation(allowed.proxy(), new String[0])));
        assertTrue(!command.hasPermission(new TestInvocation(denied.proxy(), new String[0])));
    }

    private record TestInvocation(CommandSource source, String[] arguments) implements SimpleCommand.Invocation {
        @Override
        public String alias() {
            return "sail";
        }
    }

    private static final class RecordingSource {
        private final boolean allowed;
        private final List<String> messages = new ArrayList<>();

        private RecordingSource(boolean allowed) {
            this.allowed = allowed;
        }

        private CommandSource proxy() {
            return (CommandSource) Proxy.newProxyInstance(
                    CommandSource.class.getClassLoader(),
                    new Class<?>[] {CommandSource.class},
                    (ignoredProxy, method, args) -> {
                        return switch (method.getName()) {
                            case "sendPlainMessage" -> {
                                messages.add((String) args[0]);
                                yield null;
                            }
                            case "hasPermission" -> allowed;
                            case "getPermissionValue" -> allowed ? Tristate.TRUE : Tristate.FALSE;
                            case "toString" -> "RecordingSource";
                            default -> defaultValue(method.getReturnType());
                        };
                    });
        }

        private static Object defaultValue(Class<?> returnType) {
            if (returnType == boolean.class) {
                return false;
            }
            if (returnType == int.class) {
                return 0;
            }
            if (returnType == void.class) {
                return null;
            }
            return null;
        }
    }
}
