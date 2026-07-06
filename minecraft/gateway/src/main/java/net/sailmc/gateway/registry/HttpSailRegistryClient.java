package net.sailmc.gateway.registry;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;

public final class HttpSailRegistryClient implements SailRegistryClient {
    private static final String JSON_CONTENT_TYPE = "application/json";

    private final HttpClient httpClient;
    private final URI apiBaseUri;
    private final Duration requestTimeout;
    private final ObjectMapper objectMapper;
    private final String apiKey;

    public HttpSailRegistryClient(HttpClient httpClient, URI apiBaseUri, Duration requestTimeout) {
        this(httpClient, apiBaseUri, requestTimeout, "");
    }

    public HttpSailRegistryClient(HttpClient httpClient, URI apiBaseUri, Duration requestTimeout, String apiKey) {
        this.httpClient = httpClient;
        this.apiBaseUri = apiBaseUri;
        this.requestTimeout = requestTimeout;
        this.objectMapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, true);
        this.apiKey = apiKey;
    }

    @Override
    public AuthChallengeResponse createAuthChallenge(AuthChallengeRequest request)
            throws IOException, InterruptedException {
        String body = objectMapper.writeValueAsString(request);
        HttpRequest.Builder builder = HttpRequest.newBuilder(resolve("v1/minecraft/auth-challenges"))
                .timeout(requestTimeout)
                .header("Accept", JSON_CONTENT_TYPE)
                .header("Content-Type", JSON_CONTENT_TYPE)
                .POST(HttpRequest.BodyPublishers.ofString(body));
        applyAuth(builder);
        HttpResponse<String> response = httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 201) {
            throw SailRegistryException.fromSailErrorJson(response.statusCode(), response.body());
        }
        return objectMapper.readValue(response.body(), AuthChallengeResponse.class);
    }

    @Override
    public AuthChallengeStatusResponse getAuthChallenge(String challengeId)
            throws IOException, InterruptedException {
        HttpRequest.Builder builder = HttpRequest.newBuilder(resolve("v1/minecraft/auth-challenges/" + challengeId))
                .timeout(requestTimeout)
                .header("Accept", JSON_CONTENT_TYPE)
                .GET();
        applyAuth(builder);
        HttpResponse<String> response = httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            throw SailRegistryException.fromSailErrorJson(response.statusCode(), response.body());
        }
        return objectMapper.readValue(response.body(), AuthChallengeStatusResponse.class);
    }

    @Override
    public SessionVerificationResponse verifySession(String serverId, String sessionToken)
            throws IOException, InterruptedException {
        String body = objectMapper.writeValueAsString(new SessionVerificationRequest(serverId, sessionToken));
        HttpRequest.Builder builder = HttpRequest.newBuilder(resolve("v1/minecraft/sessions/verify"))
                .timeout(requestTimeout)
                .header("Accept", JSON_CONTENT_TYPE)
                .header("Content-Type", JSON_CONTENT_TYPE)
                .POST(HttpRequest.BodyPublishers.ofString(body));
        applyAuth(builder);
        HttpResponse<String> response = httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            throw SailRegistryException.fromSailErrorJson(response.statusCode(), response.body());
        }
        return objectMapper.readValue(response.body(), SessionVerificationResponse.class);
    }

    @Override
    public RegistryHealthResponse getHealth() throws IOException, InterruptedException {
        HttpRequest.Builder builder = HttpRequest.newBuilder(resolve("health"))
                .timeout(requestTimeout)
                .header("Accept", JSON_CONTENT_TYPE)
                .GET();
        applyAuth(builder);
        HttpResponse<String> response = httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            throw SailRegistryException.fromSailErrorJson(response.statusCode(), response.body());
        }
        return objectMapper.readValue(response.body(), RegistryHealthResponse.class);
    }

    @Override
    public void heartbeat(String serverId) throws IOException, InterruptedException {
        if (apiKey == null || apiKey.isBlank()) {
            return;
        }
        String body = objectMapper.writeValueAsString(Map.of("server_id", serverId));
        HttpRequest.Builder builder = HttpRequest.newBuilder(resolve("v1/servers/heartbeat"))
                .timeout(requestTimeout)
                .header("Accept", JSON_CONTENT_TYPE)
                .header("Content-Type", JSON_CONTENT_TYPE)
                .POST(HttpRequest.BodyPublishers.ofString(body));
        applyAuth(builder);
        HttpResponse<String> response = httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            throw SailRegistryException.fromSailErrorJson(response.statusCode(), response.body());
        }
    }

    private HttpRequest.Builder applyAuth(HttpRequest.Builder builder) {
        if (apiKey != null && !apiKey.isBlank()) {
            builder.header("Authorization", "Bearer " + apiKey);
        }
        return builder;
    }

    private URI resolve(String path) {
        String base = apiBaseUri.toString();
        if (!base.endsWith("/")) {
            base = base + "/";
        }
        return URI.create(base).resolve(path);
    }
}
