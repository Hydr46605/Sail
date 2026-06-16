package net.sailmc.companion.identity;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonSyntaxException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

public final class SailPaperIdentityParser {
    public static final String PROPERTY_NAME = "sail.identity.v1";

    private static final Gson GSON = new Gson();
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

        JsonObject root;
        try {
            root = GSON.fromJson(new String(jsonBytes, StandardCharsets.UTF_8), JsonObject.class);
        } catch (JsonSyntaxException error) {
            return SailIdentityParseResult.malformed("invalid_json");
        }

        if (root == null) {
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
            return SailIdentityParseResult.verified(GSON.fromJson(root, SailPaperIdentity.class));
        } catch (JsonSyntaxException error) {
            return SailIdentityParseResult.malformed("invalid_json");
        }
    }

    private static String text(JsonObject root, String field) {
        JsonElement value = root.get(field);
        if (value == null || value.isJsonNull() || !value.isJsonPrimitive()) {
            return "";
        }
        return value.getAsString();
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
