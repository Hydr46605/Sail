package net.sailmc.companion.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.google.gson.Gson;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class SailPaperIdentityParserTest {
    private static final Gson GSON = new Gson();
    private static final UUID PLAYER_UUID = UUID.fromString("00000000-0000-4000-8000-000000000001");

    private final SailPaperIdentityParser parser = new SailPaperIdentityParser();

    @Test
    void parsesValidBridgePayloadAsVerified() throws Exception {
        SailIdentityParseResult result = parser.parse(PLAYER_UUID, encode(validPayload()));

        assertEquals(SailIdentityParseResult.State.VERIFIED, result.state());
        assertEquals("sail-local", result.identity().registryId());
        assertEquals("local-survival", result.identity().serverId());
        assertEquals("sess_local_0123456789abcdef", result.identity().sessionId());
        assertEquals("Example", result.identity().displayName());
        assertEquals("LOCAL_SOFT", result.identity().claimType());
        assertEquals("SAIL_LOCAL", result.identity().identityType());
    }

    @Test
    void absentPropertyIsUnverifiedBySail() {
        SailIdentityParseResult result = parser.parse(PLAYER_UUID, null);

        assertEquals(SailIdentityParseResult.State.UNVERIFIED_BY_SAIL, result.state());
        assertEquals("missing_property", result.reason());
    }

    @Test
    void malformedBase64IsRejected() {
        SailIdentityParseResult result = parser.parse(PLAYER_UUID, "%%%");

        assertEquals(SailIdentityParseResult.State.MALFORMED, result.state());
        assertEquals("invalid_base64", result.reason());
    }

    @Test
    void malformedJsonIsRejected() {
        String propertyValue = Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString("{not-json".getBytes(StandardCharsets.UTF_8));

        SailIdentityParseResult result = parser.parse(PLAYER_UUID, propertyValue);

        assertEquals(SailIdentityParseResult.State.MALFORMED, result.state());
        assertEquals("invalid_json", result.reason());
    }

    @Test
    void wrongSchemaIsRejected() throws Exception {
        Map<String, String> payload = validPayload();
        payload.put("schema", "other-schema");

        SailIdentityParseResult result = parser.parse(PLAYER_UUID, encode(payload));

        assertEquals(SailIdentityParseResult.State.MALFORMED, result.state());
        assertEquals("wrong_schema", result.reason());
    }

    @Test
    void uuidMismatchIsRejected() throws Exception {
        Map<String, String> payload = validPayload();
        payload.put("minecraft_uuid", "00000000-0000-4000-8000-000000000002");

        SailIdentityParseResult result = parser.parse(PLAYER_UUID, encode(payload));

        assertEquals(SailIdentityParseResult.State.MALFORMED, result.state());
        assertEquals("uuid_mismatch", result.reason());
    }

    @ParameterizedTest
    @ValueSource(strings = {
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
            "identity_type"
    })
    void missingRequiredFieldIsRejected(String field) throws Exception {
        Map<String, String> payload = validPayload();
        payload.remove(field);

        SailIdentityParseResult result = parser.parse(PLAYER_UUID, encode(payload));

        assertEquals(SailIdentityParseResult.State.MALFORMED, result.state());
        assertEquals("missing_required_field", result.reason());
    }

    @Test
    void rawSessionTokenIsRejected() throws Exception {
        Map<String, String> payload = validPayload();
        payload.put("session_token", "secret-token");

        SailIdentityParseResult result = parser.parse(PLAYER_UUID, encode(payload));

        assertEquals(SailIdentityParseResult.State.MALFORMED, result.state());
        assertEquals("forbidden_session_token", result.reason());
    }

    private static Map<String, String> validPayload() {
        Map<String, String> payload = new LinkedHashMap<>();
        payload.put("schema", "sail-paper-identity-v1");
        payload.put("registry_id", "sail-local");
        payload.put("server_id", "local-survival");
        payload.put("session_id", "sess_local_0123456789abcdef");
        payload.put("account_id", "acct_local_0123456789abcdef");
        payload.put("minecraft_identity_id", "mcid_local_0123456789abcdef");
        payload.put("name_claim_id", "claim_local_0123456789abcdef");
        payload.put("canonical_name", "example");
        payload.put("display_name", "Example");
        payload.put("minecraft_uuid", PLAYER_UUID.toString());
        payload.put("claim_type", "LOCAL_SOFT");
        payload.put("identity_type", "SAIL_LOCAL");
        payload.put("issuer", "my-network");
        payload.put("key_id", "dev-es256-2026-06");
        return payload;
    }

    private static String encode(Map<String, String> payload) {
        return Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(GSON.toJson(payload).getBytes(StandardCharsets.UTF_8));
    }
}
