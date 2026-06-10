package net.sailmc.gateway.registry;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Optional;

public final class SailRegistryException extends RuntimeException {
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private final int statusCode;
    private final String responseBody;
    private final SailError error;

    public SailRegistryException(int statusCode, String responseBody) {
        this(statusCode, responseBody, null);
    }

    private SailRegistryException(int statusCode, String responseBody, SailError error) {
        super("Sail registry returned HTTP " + statusCode);
        this.statusCode = statusCode;
        this.responseBody = responseBody;
        this.error = error;
    }

    public static SailRegistryException fromSailErrorJson(int statusCode, String responseBody) {
        try {
            SailErrorEnvelope envelope = OBJECT_MAPPER.readValue(responseBody, SailErrorEnvelope.class);
            return new SailRegistryException(statusCode, responseBody, envelope.error());
        } catch (Exception ignored) {
            return new SailRegistryException(statusCode, responseBody);
        }
    }

    public int statusCode() {
        return statusCode;
    }

    public String responseBody() {
        return responseBody;
    }

    public Optional<String> errorCode() {
        return Optional.ofNullable(error).map(SailError::code);
    }

    public Optional<String> playerMessage() {
        if (error == null || !"player".equals(error.audience())) {
            return Optional.empty();
        }
        return Optional.of(error.message());
    }

    private record SailErrorEnvelope(
            @JsonProperty("protocol_version") String protocolVersion,
            SailError error) {}

    private record SailError(
            String code,
            String message,
            String audience,
            @JsonProperty("http_status") int httpStatus,
            boolean retryable,
            @JsonProperty("correlation_id") String correlationId) {}
}
