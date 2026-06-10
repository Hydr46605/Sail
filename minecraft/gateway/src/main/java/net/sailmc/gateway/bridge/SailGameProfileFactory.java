package net.sailmc.gateway.bridge;

import com.velocitypowered.api.util.GameProfile;
import java.util.List;
import net.sailmc.gateway.login.LocalSessionProfile;

public final class SailGameProfileFactory {
    private SailGameProfileFactory() {}

    public static GameProfile fromLocalSession(LocalSessionProfile profile) {
        return new GameProfile(
                profile.minecraftUuid(),
                profile.displayName(),
                List.of(SailPaperIdentityBridge.property(profile.paperIdentity())));
    }
}
