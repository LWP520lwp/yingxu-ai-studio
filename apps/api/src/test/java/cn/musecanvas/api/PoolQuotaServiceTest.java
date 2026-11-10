package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class PoolQuotaServiceTest {
    @Test void mapsActualUsageWithoutInventingPointsOrExposingPrivateAccountData() {
        var quota = PoolQuotaService.parse(Json.read("""
            [{"id":"private-id","label":"private-email","enabled":true,"cookies":"private-cookie",
              "quota":{"found":true,"weekly_used_pct":0,"weekly_reset":"11月12日","raw":"private settings",
                       "extra_left":"剩余 17 亿个词元","extra_used_pct":11,"checked_at":%d}},
             {"enabled":true,"quota":{"found":true,"weekly_used_pct":101}},
             {"enabled":false,"quota":{"found":true,"weekly_used_pct":50}}]
            """.formatted(Instant.now().getEpochSecond())));
        assertEquals(2, quota.accounts().size());
        var first = quota.accounts().getFirst();
        assertEquals("Muse 账号 1", first.label());
        assertNull(first.plan());
        assertEquals(0d, first.weeklyUsedPercent());
        assertEquals(100d, first.weeklyRemainingPercent());
        assertEquals("剩余 17 亿个词元", first.extraRemaining());
        assertEquals(11d, first.extraUsedPercent());
        assertFalse(first.stale());
        assertNull(quota.accounts().get(1).weeklyRemainingPercent());
        String json = Json.write(quota);
        assertFalse(json.contains("private"));
        assertFalse(json.contains("raw"));
        assertFalse(json.contains("cookies"));
    }

    @Test void unconfirmedOrHistoricalValuesStayUnknownOrMarkedStale() {
        var quota = PoolQuotaService.parse(Json.read("""
            [{"quota":{"found":false,"weekly_used_pct":0,"extra_used_pct":3,"extra_left":"1B tokens left"}},
             {"quota":{"found":true,"weekly_used_pct":100,"checked_at":1}},
             {"quota":{"found":true,"weekly_used_pct":"0","extra_left":"private-key-value"}}]
            """));
        assertEquals("stale", quota.status());
        var unknown = quota.accounts().getFirst();
        assertNull(unknown.weeklyUsedPercent());
        assertNull(unknown.weeklyRemainingPercent());
        assertNull(unknown.extraUsedPercent());
        assertNull(unknown.extraRemaining());
        assertEquals("unavailable", unknown.status());
        assertEquals(0d, quota.accounts().get(1).weeklyRemainingPercent());
        assertTrue(quota.accounts().get(1).stale());
        assertNull(quota.accounts().get(2).weeklyRemainingPercent());
        assertEquals("unsupported", PoolQuotaService.unsupported().status());
        assertTrue(PoolQuotaService.combine(List.of()).accounts().isEmpty());
    }

    @Test void getIsReadOnlyCacheIsCredentialScopedAndExplicitRefreshIsThrottled() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var statusReads = new AtomicInteger(); var quotaReads = new AtomicInteger();
        server.createContext("/admin/status", exchange -> {
            statusReads.incrementAndGet();
            boolean first = "Bearer credential-one".equals(exchange.getRequestHeaders().getFirst("Authorization"));
            respond(exchange, 200, """
                {"accounts":[{"id":"supplier-private-id","enabled":true,"quota":{"found":true,"weekly_used_pct":%d,"checked_at":%d,"raw":"private-settings"}}]}
                """.formatted(first ? quotaReads.get() : 80, Instant.now().getEpochSecond()));
        });
        server.createContext("/admin/accounts/supplier-private-id/quota", exchange -> {
            assertEquals("POST", exchange.getRequestMethod());
            assertEquals("Bearer credential-one", exchange.getRequestHeaders().getFirst("Authorization"));
            quotaReads.incrementAndGet(); respond(exchange, 200, "{\"found\":true}");
        });
        server.start();
        try {
            var provider = mock(MuseProvider.class);
            when(provider.baseUrl()).thenReturn("http://127.0.0.1:" + server.getAddress().getPort());
            var service = new PoolQuotaService(provider);
            var initial = service.snapshot("credential-one", false);
            assertSame(initial, service.snapshot("credential-one", false));
            assertEquals(1, statusReads.get()); assertEquals(0, quotaReads.get());
            assertEquals(80d, service.snapshot("credential-two", false).accounts().getFirst().weeklyUsedPercent());
            assertEquals(2, statusReads.get());
            var refreshed = service.snapshot("credential-one", true);
            assertEquals(1d, refreshed.accounts().getFirst().weeklyUsedPercent());
            assertEquals(1, quotaReads.get());
            assertSame(refreshed, service.snapshot("credential-one", true));
            assertEquals(1, quotaReads.get());
            assertFalse(Json.write(refreshed).contains("private"));
        } finally { server.stop(0); }
    }

    @Test void unsupportedOriginsAndMissingCredentialsNeverContactTheSupplier() {
        var provider = mock(MuseProvider.class);
        when(provider.baseUrl()).thenReturn("https://untrusted.example");
        var service = new PoolQuotaService(provider);
        assertEquals("unavailable", service.snapshot("credential", true).status());
        when(provider.baseUrl()).thenReturn("http://127.0.0.1:18610");
        assertEquals("unavailable", service.snapshot("", true).status());
        verify(provider, never()).apiKey();
    }

    @Test void ordinaryReadsReturnCachedQuotaWhileLiveRefreshIsInProgress() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var refreshStarted = new java.util.concurrent.CountDownLatch(1);
        var finishRefresh = new java.util.concurrent.CountDownLatch(1);
        server.createContext("/admin/status", exchange -> respond(exchange,200,
            "{\"accounts\":[{\"id\":\"one\",\"enabled\":true,\"quota\":{\"found\":true,\"weekly_used_pct\":30,\"checked_at\":"+Instant.now().getEpochSecond()+"}}]}"));
        server.createContext("/admin/accounts/one/quota", exchange -> {
            refreshStarted.countDown();
            try { finishRefresh.await(3, java.util.concurrent.TimeUnit.SECONDS); }
            catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
            respond(exchange,200,"{\"found\":true}");
        });
        server.start();
        try (var executor = java.util.concurrent.Executors.newSingleThreadExecutor()) {
            var provider = mock(MuseProvider.class);
            when(provider.baseUrl()).thenReturn("http://127.0.0.1:"+server.getAddress().getPort());
            var service = new PoolQuotaService(provider);
            var cached = service.snapshot("credential",false);
            var refreshing = executor.submit(() -> service.snapshot("credential",true));
            assertTrue(refreshStarted.await(3, java.util.concurrent.TimeUnit.SECONDS));
            assertTimeoutPreemptively(java.time.Duration.ofMillis(300),() -> assertSame(cached,service.snapshot("credential",false)));
            finishRefresh.countDown();
            assertEquals("available",refreshing.get(3,java.util.concurrent.TimeUnit.SECONDS).status());
        } finally { finishRefresh.countDown(); server.stop(0); }
    }

    @Test void quotaReadDoesNotFollowRedirectsOrReturnSupplierErrors() throws Exception {
        var target = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var redirect = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var leakedRequests = new AtomicInteger();
        target.createContext("/private", exchange -> { leakedRequests.incrementAndGet(); respond(exchange, 200, "{}"); });
        redirect.createContext("/admin/status", exchange -> {
            exchange.getResponseHeaders().set("Location", "http://127.0.0.1:" + target.getAddress().getPort() + "/private");
            respond(exchange, 302, "{\"error\":\"private-key\"}");
        });
        target.start(); redirect.start();
        try {
            var provider = mock(MuseProvider.class);
            when(provider.baseUrl()).thenReturn("http://127.0.0.1:" + redirect.getAddress().getPort());
            var result = new PoolQuotaService(provider).snapshot("credential", true);
            assertEquals("unavailable", result.status());
            assertEquals(0, leakedRequests.get());
            assertFalse(Json.write(result).contains("private"));
        } finally { target.stop(0); redirect.stop(0); }
    }

    private static void respond(HttpExchange exchange, int status, String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (var body = exchange.getResponseBody()) { body.write(bytes); }
    }
}
