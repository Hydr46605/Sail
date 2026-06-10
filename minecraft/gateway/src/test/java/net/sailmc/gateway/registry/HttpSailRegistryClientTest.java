package net.sailmc.gateway.registry;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class HttpSailRegistryClientTest {
    private HttpServer server;

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void postsAuthChallengeRequestAndParsesCreatedResponse() throws Exception {
        AtomicReference<String> receivedBody = new AtomicReference<>();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/minecraft/auth-challenges", exchange -> {
            receivedBody.set(readBody(exchange));
            byte[] body = """
                    {
                      "protocol_version": "sail-protocol-v1",
                      "challenge_id": "ch_local_0123456789abcdef",
                      "status": "pending",
                      "server_id": "local-survival",
                      "requested_name": "Example",
                      "mode": "kick",
                      "code": "ABCD-1234",
                      "auth_url": "http://127.0.0.1:8787/auth/minecraft?code=ABCD-1234",
                      "expires_at": "2026-06-06T00:15:00Z"
                    }
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(201, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        URI baseUri = URI.create("http://127.0.0.1:" + server.getAddress().getPort());
        HttpSailRegistryClient client = new HttpSailRegistryClient(
                HttpClient.newHttpClient(),
                baseUri,
                Duration.ofSeconds(2));

        AuthChallengeResponse response = client.createAuthChallenge(new AuthChallengeRequest(
                "local-survival",
                "Example",
                "127.0.0.1:25565",
                "kick"));

        assertTrue(receivedBody.get().contains("\"server_id\":\"local-survival\""));
        assertTrue(receivedBody.get().contains("\"username\":\"Example\""));
        assertEquals("ch_local_0123456789abcdef", response.challengeId());
        assertEquals("ABCD-1234", response.code());
        assertEquals("http://127.0.0.1:8787/auth/minecraft?code=ABCD-1234", response.authUrl());
    }

    @Test
    void parsesSailErrorResponseWhenChallengeCreationIsRejected() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/minecraft/auth-challenges", exchange -> {
            byte[] body = """
                    {
                      "protocol_version": "sail-protocol-v1",
                      "error": {
                        "code": "premium_name_required",
                        "message": "This name belongs to a Minecraft Java account. Join with the official account.",
                        "audience": "player",
                        "http_status": 409,
                        "retryable": false,
                        "correlation_id": "corr_local_0123456789abcdef"
                      }
                    }
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(409, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        URI baseUri = URI.create("http://127.0.0.1:" + server.getAddress().getPort());
        HttpSailRegistryClient client = new HttpSailRegistryClient(
                HttpClient.newHttpClient(),
                baseUri,
                Duration.ofSeconds(2));

        SailRegistryException error = assertThrows(
                SailRegistryException.class,
                () -> client.createAuthChallenge(new AuthChallengeRequest(
                        "local-survival",
                        "Notch",
                        "127.0.0.1:25565",
                        "kick")));

        assertEquals(409, error.statusCode());
        assertEquals("premium_name_required", error.errorCode().orElseThrow());
        assertEquals(
                "This name belongs to a Minecraft Java account. Join with the official account.",
                error.playerMessage().orElseThrow());
    }

    @Test
    void fetchesCompletedAuthChallengeStatusWithLocalIdentity() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/minecraft/auth-challenges/ch_local_0123456789abcdef", exchange -> {
            byte[] body = """
                    {
                      "protocol_version": "sail-protocol-v1",
                      "challenge_id": "ch_local_0123456789abcdef",
                      "status": "completed",
                      "expires_at": "2026-06-06T00:15:00Z",
                      "completed_at": "2026-06-06T00:10:30Z",
                      "identity": {
                        "account_id": "acct_local_0123456789abcdef",
                        "minecraft_identity_id": "mcid_local_0123456789abcdef",
                        "name_claim_id": "claim_local_0123456789abcdef",
                        "canonical_name": "example",
                        "display_name": "Example",
                        "minecraft_uuid": "00000000-0000-4000-8000-000000000001",
                        "claim_type": "LOCAL_SOFT",
                        "identity_type": "SAIL_LOCAL",
                        "session_id": "sess_local_0123456789abcdef",
                        "session_token": "eyJhbGciOiJFUzI1NiJ9.payload.signature"
                      }
                    }
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        URI baseUri = URI.create("http://127.0.0.1:" + server.getAddress().getPort());
        HttpSailRegistryClient client = new HttpSailRegistryClient(
                HttpClient.newHttpClient(),
                baseUri,
                Duration.ofSeconds(2));

        AuthChallengeStatusResponse response = client.getAuthChallenge("ch_local_0123456789abcdef");

        assertEquals("completed", response.status());
        assertEquals("example", response.identity().orElseThrow().canonicalName());
        assertEquals("Example", response.identity().orElseThrow().displayName());
        assertEquals("00000000-0000-4000-8000-000000000001", response.identity().orElseThrow().minecraftUuid());
    }

    @Test
    void fetchesRegistryHealth() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/health", exchange -> {
            byte[] body = """
                    {
                      "protocol_version": "sail-protocol-v1",
                      "service": "sail-registry",
                      "status": "ok"
                    }
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        URI baseUri = URI.create("http://127.0.0.1:" + server.getAddress().getPort());
        HttpSailRegistryClient client = new HttpSailRegistryClient(
                HttpClient.newHttpClient(),
                baseUri,
                Duration.ofSeconds(2));

        RegistryHealthResponse response = client.getHealth();

        assertEquals("sail-registry", response.service());
        assertEquals("ok", response.status());
    }

    @Test
    void verifiesMinecraftSessionToken() throws Exception {
        AtomicReference<String> receivedBody = new AtomicReference<>();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/minecraft/sessions/verify", exchange -> {
            receivedBody.set(readBody(exchange));
            byte[] body = """
                    {
                      "protocol_version": "sail-protocol-v1",
                      "session_id": "sess_local_0123456789abcdef",
                      "status": "active",
                      "server_id": "local-survival",
                      "issuer_server_id": "local-survival",
                      "session_reuse_policy": "same_registry",
                      "canonical_name": "example",
                      "minecraft_uuid": "00000000-0000-4000-8000-000000000001"
                    }
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        URI baseUri = URI.create("http://127.0.0.1:" + server.getAddress().getPort());
        HttpSailRegistryClient client = new HttpSailRegistryClient(
                HttpClient.newHttpClient(),
                baseUri,
                Duration.ofSeconds(2));

        SessionVerificationResponse response = client.verifySession(
                "local-survival",
                "eyJhbGciOiJFUzI1NiJ9.payload.signature");

        assertEquals(
                "{\"server_id\":\"local-survival\",\"session_token\":\"eyJhbGciOiJFUzI1NiJ9.payload.signature\"}",
                receivedBody.get());
        assertEquals("sess_local_0123456789abcdef", response.sessionId());
        assertEquals("active", response.status());
        assertEquals("local-survival", response.serverId());
        assertEquals("local-survival", response.issuerServerId());
        assertEquals("same_registry", response.sessionReusePolicy());
        assertEquals("example", response.canonicalName());
    }

    private static String readBody(HttpExchange exchange) throws IOException {
        return new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
    }
}
