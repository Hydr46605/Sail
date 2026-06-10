package net.sailmc.gateway.registry;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

public final class HttpSailRegistryClient implements SailRegistryClient {
    private static final String JSON_CONTENT_TYPE = "application/json";

    private final HttpClient httpClient;
    private final URI apiBaseUri;
    private final Duration requestTimeout;
    private final ObjectMapper objectMapper;

    public HttpSailRegistryClient(HttpClient httpClient, URI apiBaseUri, Duration requestTimeout) {
        this.httpClient = httpClient;
        this.apiBaseUri = apiBaseUri;
        this.requestTimeout = requestTimeout;
        this.objectMapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, true);
    }

    @Override
    public AuthChallengeResponse createAuthChallenge(AuthChallengeRequest request)
            throws IOException, InterruptedException {
        String body = objectMapper.writeValueAsString(request);
        HttpRequest httpRequest = HttpRequest.newBuilder(resolve("v1/minecraft/auth-challenges"))
                .timeout(requestTimeout)
                .header("Accept", JSON_CONTENT_TYPE)
                .header("Content-Type", JSON_CONTENT_TYPE)
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        HttpResponse<String> response = httpClient.send(httpRequest, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 201) {
            throw SailRegistryException.fromSailErrorJson(response.statusCode(), response.body());
        }
        return objectMapper.readValue(response.body(), AuthChallengeResponse.class);
    }

    @Override
    public AuthChallengeStatusResponse getAuthChallenge(String challengeId)
            throws IOException, InterruptedException {
        HttpRequest httpRequest = HttpRequest.newBuilder(resolve("v1/minecraft/auth-challenges/" + challengeId))
                .timeout(requestTimeout)
                .header("Accept", JSON_CONTENT_TYPE)
                .GET()
                .build();
        HttpResponse<String> response = httpClient.send(httpRequest, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            throw SailRegistryException.fromSailErrorJson(response.statusCode(), response.body());
        }
        return objectMapper.readValue(response.body(), AuthChallengeStatusResponse.class);
    }

    @Override
    public SessionVerificationResponse verifySession(String serverId, String sessionToken)
            throws IOException, InterruptedException {
        String body = objectMapper.writeValueAsString(new SessionVerificationRequest(serverId, sessionToken));
        HttpRequest httpRequest = HttpRequest.newBuilder(resolve("v1/minecraft/sessions/verify"))
                .timeout(requestTimeout)
                .header("Accept", JSON_CONTENT_TYPE)
                .header("Content-Type", JSON_CONTENT_TYPE)
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        HttpResponse<String> response = httpClient.send(httpRequest, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            throw SailRegistryException.fromSailErrorJson(response.statusCode(), response.body());
        }
        return objectMapper.readValue(response.body(), SessionVerificationResponse.class);
    }

    @Override
    public RegistryHealthResponse getHealth() throws IOException, InterruptedException {
        HttpRequest httpRequest = HttpRequest.newBuilder(resolve("health"))
                .timeout(requestTimeout)
                .header("Accept", JSON_CONTENT_TYPE)
                .GET()
                .build();
        HttpResponse<String> response = httpClient.send(httpRequest, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            throw SailRegistryException.fromSailErrorJson(response.statusCode(), response.body());
        }
        return objectMapper.readValue(response.body(), RegistryHealthResponse.class);
    }

    private URI resolve(String path) {
        String base = apiBaseUri.toString();
        if (!base.endsWith("/")) {
            base = base + "/";
        }
        return URI.create(base).resolve(path);
    }
}
