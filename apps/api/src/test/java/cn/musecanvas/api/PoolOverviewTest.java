package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;

class PoolOverviewTest {
    private static PoolSettings settings(MockEnvironment env) { return new PoolSettings(new AppSettings(env), env); }

    @Test void defaultProductionIsDisabledAndNeverAllowsOrdinaryUsers() {
        var env = new MockEnvironment();
        env.setActiveProfiles("production");
        var settings = settings(env);
        var user = new UserService.User("owner-id", "Creator", "", "github");
        var auth = UsernamePasswordAuthenticationToken.authenticated(user, "", List.of(new SimpleGrantedAuthority("ROLE_USER")));
        assertFalse(settings.enabled());
        assertFalse(settings.mayRead(user, auth, "127.0.0.1"));
        env.setProperty("app.pool-overview-owner-ids", "owner-id");
        assertTrue(settings.mayRead(user, auth, "127.0.0.1"));
        assertTrue(settings.mayManage(user, auth, "127.0.0.1"));
        assertFalse(settings.mayRead(user, auth, "192.168.1.1"));
        assertFalse(settings.mayManage(user, auth, "192.168.1.1"));
        assertFalse(settings.mayRead(user, auth, null));
        env.setProperty("app.pool-overview-enabled", "true");
        assertTrue(settings.enabled());
    }

    @Test void developmentLocalAccessIsStillBoundToLoopbackAndCannotSurviveProductionProfile() {
        var env = new MockEnvironment();
        env.setActiveProfiles("dev");
        var settings = settings(env);
        var user = new UserService.User("local-id", "Creator", "", "local");
        var auth = UsernamePasswordAuthenticationToken.authenticated(user, "", List.of(new SimpleGrantedAuthority("ROLE_USER")));
        assertTrue(settings.enabled());
        assertTrue(settings.mayRead(user, auth, "::1"));
        assertTrue(settings.mayManage(user, auth, "::1"));
        assertFalse(settings.mayRead(user, auth, "10.0.0.2"));
        assertFalse(settings.mayRead(user, null, "127.0.0.1"));
        env.setActiveProfiles("dev", "prod");
        assertFalse(settings.enabled());
        assertFalse(settings.mayRead(user, auth, "127.0.0.1"));
    }

    @Test void overviewTargetsCannotBecomeArbitraryUrlsOrCredentialLinks() {
        assertEquals(URI.create("http://127.0.0.1:18610"), PoolSettings.loopbackBase("http://127.0.0.1:18610/"));
        assertNotNull(PoolSettings.loopbackBase("http://[::1]:18610"));
        for (String value : List.of("http://example.com", "http://localhost:18610", "http://127.0.0.1:18610/private",
            "http://user:password@127.0.0.1:18610", "http://127.0.0.1:18610?key=secret", "http://127.0.0.1:18610#key", "file:///private"))
            assertNull(PoolSettings.loopbackBase(value), value);
    }

    @Test void onlyWhitelistedAggregatesReachTheBrowserAndRepeatedReadsUseTheShortCache() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var requests = new AtomicInteger();
        server.createContext("/admin/status", exchange -> {
            requests.incrementAndGet();
            assertEquals("Bearer test-server-only-key", exchange.getRequestHeaders().getFirst("Authorization"));
            respond(exchange, """
                {"stats":{"total":4,"healthy":3},"browser_running":true,
                 "accounts":[{"id":"private-account-id","label":"private-phone-number","enabled":true,"ok":true,"essential_ok":true,"cookies_exp":"private-cookie"},
                             {"enabled":false,"ok":true},{"enabled":true,"ok":false},{"enabled":true,"ok":true,"expires_at":1}],
                 "tasks":[{"prompt":"private-user-prompt"}],"api_key":"private-upstream-key"}
                """);
        });
        server.createContext("/admin/doubao/status", exchange -> {
            requests.incrementAndGet();
            respond(exchange, "{\"accounts\":[{\"logged_in\":true,\"verify_pending\":true},{\"logged_in\":true,\"verify_pending\":false}],\"message\":\"private-note\"}");
        });
        server.start();
        try {
            var env = new MockEnvironment(); env.setActiveProfiles("dev");
            var provider = mock(MuseProvider.class);
            when(provider.apiKey()).thenReturn("test-server-only-key");
            when(provider.baseUrl()).thenReturn("http://127.0.0.1:" + server.getAddress().getPort());
            var service = new PoolService(settings(env), provider);
            var result = service.overview();
            assertEquals("connected", result.status());
            assertTrue(result.configured());
            assertEquals(new PoolService.Counts(4, 1), result.accounts());
            assertEquals(new PoolService.Counts(2, 1), result.doubao());
            assertEquals(Boolean.TRUE, result.browserRunning());
            String json = Json.write(result);
            assertFalse(json.contains("private-"));
            assertFalse(json.contains("test-server-only-key"));
            assertFalse(json.contains("cookies"));
            assertSame(result, service.overview());
            assertEquals(2, requests.get());
        } finally { server.stop(0); }
    }

    @Test void missingKeyUsesPublicReadinessAndLeavesAvailabilityUnknown() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/readyz", exchange -> {
            assertNull(exchange.getRequestHeaders().getFirst("Authorization"));
            respond(exchange, "{\"status\":\"ready\",\"accounts\":3,\"browser_running\":true}");
        });
        server.start();
        try {
            var env = new MockEnvironment(); env.setActiveProfiles("dev");
            var provider = mock(MuseProvider.class);
            when(provider.apiKey()).thenReturn("");
            when(provider.baseUrl()).thenReturn("http://127.0.0.1:" + server.getAddress().getPort());
            var result = new PoolService(settings(env), provider).overview();
            assertEquals("connected", result.status());
            assertFalse(result.configured());
            assertEquals(new PoolService.Counts(3, null), result.accounts());
            assertNull(result.doubao().available());
        } finally { server.stop(0); }
    }

    @Test void disabledOverviewNeverResolvesCredentialsOrContactsThePool() {
        var env = new MockEnvironment(); env.setActiveProfiles("production");
        var provider = mock(MuseProvider.class);
        var result = new PoolService(settings(env), provider).overview();
        assertEquals("disabled", result.status());
        assertNull(result.managementUrl());
        verifyNoInteractions(provider);
    }

    private static void respond(com.sun.net.httpserver.HttpExchange exchange, String json) throws java.io.IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, bytes.length);
        try (var stream = exchange.getResponseBody()) { stream.write(bytes); }
    }
}
