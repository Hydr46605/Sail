package net.sailmc.gateway.login;

import java.util.Optional;

public record LoginDecision(Action action, String message, Optional<LocalSessionProfile> localProfile) {
    public enum Action {
        KICK,
        REQUIRE_PREMIUM_AUTH,
        ACCEPT_LOCAL_PROFILE
    }

    public static LoginDecision kick(String message) {
        return new LoginDecision(Action.KICK, message, Optional.empty());
    }

    public static LoginDecision acceptLocalProfile(LocalSessionProfile profile) {
        return new LoginDecision(Action.ACCEPT_LOCAL_PROFILE, "", Optional.of(profile));
    }

    public static LoginDecision requirePremiumAuth() {
        return new LoginDecision(Action.REQUIRE_PREMIUM_AUTH, "", Optional.empty());
    }
}
