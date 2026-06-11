package net.sailmc.gateway.login;

import java.util.Optional;
import net.sailmc.gateway.registry.AuthChallengeResponse;

public record LoginDecision(
        Action action,
        String message,
        Optional<LocalSessionProfile> localProfile,
        Optional<AuthChallengeResponse> challenge) {
    public enum Action {
        KICK,
        REQUIRE_PREMIUM_AUTH,
        ACCEPT_LOCAL_PROFILE,
        WAIT_IN_LIMBO
    }

    public static LoginDecision kick(String message) {
        return new LoginDecision(Action.KICK, message, Optional.empty(), Optional.empty());
    }

    public static LoginDecision acceptLocalProfile(LocalSessionProfile profile) {
        return new LoginDecision(Action.ACCEPT_LOCAL_PROFILE, "", Optional.of(profile), Optional.empty());
    }

    public static LoginDecision requirePremiumAuth() {
        return new LoginDecision(Action.REQUIRE_PREMIUM_AUTH, "", Optional.empty(), Optional.empty());
    }

    public static LoginDecision waitInLimbo(AuthChallengeResponse challenge, String message) {
        return new LoginDecision(Action.WAIT_IN_LIMBO, message, Optional.empty(), Optional.of(challenge));
    }
}
