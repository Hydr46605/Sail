package net.sailmc.gateway.bridge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.velocitypowered.api.util.GameProfile;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

class SailPaperIdentityBridgeTest {
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    @Test
    void encodesUnsignedPaperIdentityProfileProperty() throws Exception {
        SailPaperIdentity identity = new SailPaperIdentity(
                "reg_local_0123456789abcdef",
                "gateway-survival",
                "sess_local_0123456789abcdef",
                "acct_local_0123456789abcdef",
                "mcid_local_0123456789abcdef",
                "claim_local_0123456789abcdef",
                "example",
                "Example",
                "00000000-0000-4000-8000-000000000001",
                "LOCAL_SOFT",
                "SAIL_LOCAL",
                "https://registry.sailmc.net",
                "sail-local-key-1");

        GameProfile.Property property = SailPaperIdentityBridge.property(identity);

        assertEquals("sail.identity.v1", SailPaperIdentityBridge.PROPERTY_NAME);
        assertEquals("sail.identity.v1", property.getName());
        assertEquals("", property.getSignature());
        assertEquals(SailPaperIdentityBridge.encode(identity), property.getValue());
        assertFalse(property.getValue().contains("="));

        byte[] jsonBytes = Base64.getUrlDecoder().decode(property.getValue());
        String json = new String(jsonBytes, StandardCharsets.UTF_8);
        Map<String, String> payload = OBJECT_MAPPER.readValue(json, new TypeReference<>() {});

        assertEquals(Set.of(
                "schema",
                "registry_id",
                "server_id",
                "session_id",
                "account_id",
                "minecraft_identity_id",
                "name_claim_id",
                "canonical_name",
                "display_name",
                "minecraft_uuid",
                "claim_type",
                "identity_type",
                "issuer",
                "key_id"), payload.keySet());
        assertEquals("sail-paper-identity-v1", payload.get("schema"));
        assertEquals("reg_local_0123456789abcdef", payload.get("registry_id"));
        assertEquals("gateway-survival", payload.get("server_id"));
        assertEquals("sess_local_0123456789abcdef", payload.get("session_id"));
        assertEquals("acct_local_0123456789abcdef", payload.get("account_id"));
        assertEquals("mcid_local_0123456789abcdef", payload.get("minecraft_identity_id"));
        assertEquals("claim_local_0123456789abcdef", payload.get("name_claim_id"));
        assertEquals("example", payload.get("canonical_name"));
        assertEquals("Example", payload.get("display_name"));
        assertEquals("00000000-0000-4000-8000-000000000001", payload.get("minecraft_uuid"));
        assertEquals("LOCAL_SOFT", payload.get("claim_type"));
        assertEquals("SAIL_LOCAL", payload.get("identity_type"));
        assertEquals("https://registry.sailmc.net", payload.get("issuer"));
        assertEquals("sail-local-key-1", payload.get("key_id"));
        assertFalse(payload.containsKey("sessionToken"));
        assertFalse(payload.containsKey("session_token"));
        assertFalse(payload.containsKey("providerSubject"));
        assertFalse(payload.containsKey("provider_subject"));
    }
}
