package cn.musecanvas.api;

import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

@Service
public class PoolService {
    public record Counts(Integer total, Integer available) {}
    public record Overview(String status, boolean configured, Counts accounts, Counts doubao,
                           Boolean browserRunning, String managementUrl, String message, String checkedAt) {}
    private static final Counts UNKNOWN = new Counts(null, null);
    private static final int MAX_RESPONSE_BYTES = 1024 * 1024;
    private final PoolSettings settings;
    private final MuseProvider provider;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2))
        .followRedirects(HttpClient.Redirect.NEVER).build();
    private Overview cached;
    private long cachedUntil;

    public PoolService(PoolSettings settings, MuseProvider provider) {
        this.settings = settings;
        this.provider = provider;
    }

    public synchronized Overview overview() {
        if (!settings.enabled()) return result("disabled", false, UNKNOWN, UNKNOWN, null, null, "流量池概览尚未启用");
        if (cached != null && System.nanoTime() < cachedUntil) return cached;
        URI base = PoolSettings.loopbackBase(provider.baseUrl());
        if (base == null) return result("disabled", false, UNKNOWN, UNKNOWN, null, null, "流量池概览只支持本机回环服务");
        String managementUrl = base + "/admin";
        String key;
        try { key = provider.apiKey(); } catch (RuntimeException unavailable) { key = ""; }
        boolean configured = key != null && !key.isBlank();
        JsonNode status = configured ? read(base, "/admin/status", key) : null;
        Counts accounts = UNKNOWN;
        Counts doubao = UNKNOWN;
        Boolean browserRunning = null;
        boolean connected = false;
        boolean detailed = status != null && (status.path("stats").isObject() || status.path("accounts").isArray());
        if (detailed) {
            connected = true;
            accounts = museCounts(status);
            browserRunning = booleanValue(status.path("browser_running"));
            JsonNode doubaoStatus = read(base, "/admin/doubao/status", key);
            if (doubaoStatus != null) doubao = doubaoCounts(doubaoStatus);
        } else {
            JsonNode ready = read(base, "/readyz", "");
            if (ready != null && "ready".equals(ready.path("status").asText())) {
                connected = true;
                accounts = new Counts(count(ready.path("accounts")), null);
                browserRunning = booleanValue(ready.path("browser_running"));
            }
        }
        String message = !connected ? "暂时无法读取本机流量池状态，可打开管理页检查"
            : detailed ? "已读取流量池状态；可用数依据已启用且健康的会话，不代表生成配额或并发额度"
            : "流量池已连接，管理鉴权尚未就绪；可用账号数暂不可读取";
        cached = result(connected ? "connected" : "unavailable", configured, accounts, doubao, browserRunning, managementUrl, message);
        cachedUntil = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        return cached;
    }

    private JsonNode read(URI base, String path, String key) {
        try {
            var builder = HttpRequest.newBuilder(URI.create(base + path)).timeout(Duration.ofSeconds(3))
                .header("Accept", "application/json").GET();
            if (key != null && !key.isBlank()) builder.header("Authorization", "Bearer " + key);
            var response = client.send(builder.build(), HttpResponse.BodyHandlers.ofInputStream());
            try (InputStream body = response.body()) {
                if (response.statusCode() != 200) return null;
                byte[] bytes = body.readNBytes(MAX_RESPONSE_BYTES + 1);
                if (bytes.length > MAX_RESPONSE_BYTES) return null;
                JsonNode data = Json.read(new String(bytes, StandardCharsets.UTF_8));
                return data != null && data.isObject() ? data : null;
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return null;
        } catch (Exception unavailable) {
            // Upstream bodies may contain account details. Never log or relay them.
            return null;
        }
    }

    static Counts museCounts(JsonNode status) {
        JsonNode rows = status.path("accounts");
        Integer total = count(status.path("stats").path("total"));
        if (rows.isArray()) {
            if (total == null) total = rows.size();
            int available = 0;
            long now = Instant.now().getEpochSecond();
            for (JsonNode account : rows) {
                if (!account.path("enabled").isBoolean() || !account.path("ok").isBoolean()) return new Counts(total, null);
                boolean expired = account.path("expires_at").isNumber()
                    && account.path("expires_at").asDouble() > 0 && account.path("expires_at").asDouble() <= now;
                if (account.path("enabled").asBoolean() && account.path("ok").asBoolean()
                    && !Boolean.FALSE.equals(booleanValue(account.path("essential_ok"))) && !expired) available++;
            }
            return new Counts(total, available);
        }
        return new Counts(total, null);
    }

    static Counts doubaoCounts(JsonNode status) {
        JsonNode rows = status.path("accounts");
        if (!rows.isArray()) return UNKNOWN;
        int available = 0;
        for (JsonNode account : rows) {
            if (!account.path("logged_in").isBoolean()) return new Counts(rows.size(), null);
            if (account.path("logged_in").asBoolean() && !account.path("verify_pending").asBoolean()) available++;
        }
        return new Counts(rows.size(), available);
    }

    private static Integer count(JsonNode value) {
        return value.isIntegralNumber() && value.asLong() >= 0 && value.asLong() <= Integer.MAX_VALUE ? value.asInt() : null;
    }

    private static Boolean booleanValue(JsonNode value) { return value.isBoolean() ? value.asBoolean() : null; }

    private static Overview result(String status, boolean configured, Counts accounts, Counts doubao,
                                   Boolean browserRunning, String managementUrl, String message) {
        return new Overview(status, configured, accounts, doubao, browserRunning, managementUrl, message, Instant.now().toString());
    }
}
