package net.sailmc.companion.identity;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

public final class SailPaperIdentityParser {
    public static final String PROPERTY_NAME = "sail.identity.v1";

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
    private static final List<String> REQUIRED_FIELDS = List.of(
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
            "identity_type");

    public SailIdentityParseResult parse(UUID joinedPlayerUuid, String propertyValue) {
        if (propertyValue == null || propertyValue.isBlank()) {
            return SailIdentityParseResult.unverified("missing_property");
        }

        byte[] jsonBytes;
        try {
            jsonBytes = Base64.getUrlDecoder().decode(propertyValue);
        } catch (IllegalArgumentException error) {
            return SailIdentityParseResult.malformed("invalid_base64");
        }

        JsonNode root;
        try {
            root = OBJECT_MAPPER.readTree(new String(jsonBytes, StandardCharsets.UTF_8));
        } catch (JsonProcessingException error) {
            return SailIdentityParseResult.malformed("invalid_json");
        }

        if (!root.isObject()) {
            return SailIdentityParseResult.malformed("invalid_json");
        }
        if (root.has("session_token")) {
            return SailIdentityParseResult.malformed("forbidden_session_token");
        }
        if (!SailPaperIdentity.SCHEMA.equals(text(root, "schema"))) {
            return SailIdentityParseResult.malformed("wrong_schema");
        }
        for (String field : REQUIRED_FIELDS) {
            if (isBlank(text(root, field))) {
                return SailIdentityParseResult.malformed("missing_required_field");
            }
        }

        String minecraftUuid = text(root, "minecraft_uuid");
        if (!joinedPlayerUuid.toString().equals(minecraftUuid)) {
            return SailIdentityParseResult.malformed("uuid_mismatch");
        }

        try {
            return SailIdentityParseResult.verified(OBJECT_MAPPER.treeToValue(root, SailPaperIdentity.class));
        } catch (IOException error) {
            return SailIdentityParseResult.malformed("invalid_json");
        }
    }

    private static String text(JsonNode root, String field) {
        JsonNode value = root.get(field);
        return value == null || value.isNull() ? "" : value.asText();
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
