package net.sailmc.companion.identity;

public record SailIdentityParseResult(State state, SailPaperIdentity identity, String reason) {
    public enum State {
        VERIFIED,
        UNVERIFIED_BY_SAIL,
        MALFORMED
    }

    public static SailIdentityParseResult verified(SailPaperIdentity identity) {
        return new SailIdentityParseResult(State.VERIFIED, identity, "");
    }

    public static SailIdentityParseResult unverified(String reason) {
        return new SailIdentityParseResult(State.UNVERIFIED_BY_SAIL, null, reason);
    }

    public static SailIdentityParseResult malformed(String reason) {
        return new SailIdentityParseResult(State.MALFORMED, null, reason);
    }
}
