package net.sailmc.gateway.bridge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.velocitypowered.api.util.GameProfile;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import net.sailmc.gateway.login.LocalSessionProfile;
import org.junit.jupiter.api.Test;

class SailGameProfileFactoryTest {
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    @Test
    void buildsForwardedGameProfileWithSailIdentityProperty() throws Exception {
        UUID minecraftUuid = UUID.fromString("00000000-0000-4000-8000-000000000001");
        SailPaperIdentity paperIdentity = new SailPaperIdentity(
                "sail-local",
                "local-survival",
                "sess_local_0123456789abcdef",
                "acct_local_0123456789abcdef",
                "mcid_local_0123456789abcdef",
                "claim_local_0123456789abcdef",
                "example",
                "Example",
                minecraftUuid.toString(),
                "LOCAL_SOFT",
                "SAIL_LOCAL",
                "my-network",
                "dev-es256-2026-06");
        LocalSessionProfile profile = new LocalSessionProfile(
                "example",
                "Example",
                minecraftUuid,
                "eyJhbGciOiJFUzI1NiJ9.payload.signature",
                paperIdentity);

        GameProfile gameProfile = SailGameProfileFactory.fromLocalSession(profile);

        assertEquals(minecraftUuid, gameProfile.getId());
        assertEquals("Example", gameProfile.getName());
        assertEquals(1, gameProfile.getProperties().size());
        GameProfile.Property property = gameProfile.getProperties().getFirst();
        assertEquals(SailPaperIdentityBridge.PROPERTY_NAME, property.getName());

        String json = new String(Base64.getUrlDecoder().decode(property.getValue()), StandardCharsets.UTF_8);
        Map<String, String> payload = OBJECT_MAPPER.readValue(json, new TypeReference<>() {});
        assertEquals(minecraftUuid.toString(), payload.get("minecraft_uuid"));
        assertFalse(payload.containsKey("session_token"));
    }
}
