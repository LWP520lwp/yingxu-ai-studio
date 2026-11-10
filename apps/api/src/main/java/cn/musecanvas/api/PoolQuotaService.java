package cn.musecanvas.api;

import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

/** Reads quota only. Provider account identities, raw settings and credentials never leave this service. */
@Service
public class PoolQuotaService {
    public record AccountQuota(String label, String status, String plan, Double weeklyUsedPercent,
                               Double weeklyRemainingPercent, String weeklyReset, String extraRemaining,
                               Double extraUsedPercent, String checkedAt, boolean stale) {}
    public record Quota(String status, String message, String checkedAt, List<AccountQuota> accounts) {}
    private static final int MAX_BYTES = 1024 * 1024;
    private static final long CACHE_NANOS = Duration.ofSeconds(30).toNanos();
    private static final long STALE_SECONDS = 3600;
    private final MuseProvider provider;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3))
        .followRedirects(HttpClient.Redirect.NEVER).build();
    // Cache keys are one-way credential fingerprints, never API keys or account labels.
    private final LinkedHashMap<String, Cache> cache = new LinkedHashMap<>(16, .75f, true);
    private static final class Cache { volatile Quota value; volatile long expires; long lastRefresh; boolean refreshing; }

    public PoolQuotaService(MuseProvider provider) { this.provider = provider; }

    public Quota snapshot(String key, boolean refresh) {
        URI base = PoolSettings.loopbackBase(provider.baseUrl());
        if (base == null) return unavailable("当前服务未提供兼容的额度查询接口");
        if (key == null || key.isBlank()) return unavailable("服务凭据不可用，暂时无法读取额度");
        Cache entry;
        synchronized (cache) {
            entry = cache.computeIfAbsent(fingerprint(base.toString(), key), ignored -> new Cache());
            while (cache.size() > 128) cache.remove(cache.keySet().iterator().next());
        }
        synchronized (entry) {
            long now = System.nanoTime();
            if (entry.refreshing) return entry.value == null ? unavailable("额度正在查询中，请稍后刷新") : entry.value;
            if (entry.value != null && (!refresh && now < entry.expires || refresh && entry.lastRefresh != 0 && now - entry.lastRefresh < CACHE_NANOS))
                return entry.value;
            entry.refreshing = true;
            if (refresh) entry.lastRefresh = now;
        }
        Quota result = null;
        try {
            JsonNode data = read(base, "/admin/status", key, false);
            if (data == null || !data.path("accounts").isArray()) {
                result = unavailable("暂时无法读取服务额度，请检查服务凭据、登录及网络状态");
            } else {
                if (refresh) {
                    refreshAccounts(base, key, data.path("accounts"));
                    JsonNode updated = read(base, "/admin/status", key, false);
                    if (updated != null && updated.path("accounts").isArray()) data = updated;
                }
                result = parse(data.path("accounts"));
            }
            return result;
        } finally {
            synchronized (entry) {
                if (result != null) entry.value = result;
                entry.expires = System.nanoTime() + CACHE_NANOS;
                entry.refreshing = false;
            }
        }
    }

    private void refreshAccounts(URI base, String key, JsonNode rows) {
        var calls = new ArrayList<Callable<Void>>();
        for (JsonNode row : rows) {
            String id = row.path("id").asText("");
            if (!row.path("enabled").asBoolean() || !id.matches("[A-Za-z0-9_-]{1,100}")) continue;
            calls.add(() -> { read(base, "/admin/accounts/" + id + "/quota", key, true); return null; });
            if (calls.size() == 20) break;
        }
        // The supplier owns the browser/session checks; this only requests its supported quota operation.
        try (var executor = Executors.newFixedThreadPool(Math.min(3, Math.max(1, calls.size())))) {
            executor.invokeAll(calls, 55, java.util.concurrent.TimeUnit.SECONDS);
        } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
    }

    private JsonNode read(URI base, String path, String key, boolean refresh) {
        try {
            var builder = HttpRequest.newBuilder(URI.create(base + path)).timeout(Duration.ofSeconds(refresh ? 50 : 4))
                .header("Authorization", "Bearer " + key).header("Accept", "application/json");
            if (refresh) builder.POST(HttpRequest.BodyPublishers.noBody()); else builder.GET();
            var response = client.send(builder.build(), HttpResponse.BodyHandlers.ofInputStream());
            try (InputStream body = response.body()) {
                if (response.statusCode() != 200) return null;
                byte[] bytes = body.readNBytes(MAX_BYTES + 1);
                if (bytes.length > MAX_BYTES) return null;
                JsonNode value = Json.read(new String(bytes, StandardCharsets.UTF_8));
                return value != null && value.isObject() ? value : null;
            }
        } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); return null; }
        catch (Exception unavailable) { return null; } // Never forward supplier bodies, errors or account identifiers.
    }

    static Quota parse(JsonNode rows) {
        var accounts = new ArrayList<AccountQuota>();
        int index = 0;
        for (JsonNode row : rows) {
            if (row.has("enabled") && !row.path("enabled").asBoolean()) continue;
            JsonNode quota = row.path("quota");
            Double used = quota.path("found").asBoolean() ? percentage(quota.path("weekly_used_pct")) : null;
            String extra = quota.path("found").asBoolean() ? extraRemaining(quota.path("extra_left")) : null;
            String checkedAt = timestamp(quota.path("checked_at"));
            boolean stale = checkedAt == null || Instant.parse(checkedAt).isBefore(Instant.now().minusSeconds(STALE_SECONDS));
            boolean known = quota.path("found").asBoolean() && (used != null || extra != null);
            accounts.add(new AccountQuota("Muse 账号 " + (++index), !known ? "unavailable" : stale ? "stale" : "available",
                text(quota.path("plan"), 40), used, used == null ? null : Math.round((100 - used) * 1000) / 1000d,
                text(quota.path("weekly_reset"), 60), extra, quota.path("found").asBoolean() ? percentage(quota.path("extra_used_pct")) : null, checkedAt, stale));
            if (index == 100) break;
        }
        boolean anyKnown = accounts.stream().anyMatch(row -> !"unavailable".equals(row.status()));
        boolean stale = accounts.stream().anyMatch(AccountQuota::stale);
        String status = !anyKnown ? "unavailable" : stale ? "stale" : "available";
        String message = !anyKnown ? "服务尚未返回有效额度，请点击刷新额度"
            : stale ? "部分额度为历史查询结果，请刷新后查看；周额度按账号分别计算"
            : "已读取服务真实额度；周额度按账号分别计算，服务未提供可生成次数";
        return new Quota(status, message, Instant.now().toString(), List.copyOf(accounts));
    }

    public static Quota combine(List<Quota> quotas) {
        if (quotas.isEmpty()) return unavailable("当前没有可读取额度的共享服务");
        var rows = new ArrayList<AccountQuota>();
        for (Quota quota : quotas) for (AccountQuota row : quota.accounts()) rows.add(new AccountQuota("Muse 账号 " + (rows.size() + 1),
            row.status(), row.plan(), row.weeklyUsedPercent(), row.weeklyRemainingPercent(), row.weeklyReset(), row.extraRemaining(),
            row.extraUsedPercent(), row.checkedAt(), row.stale()));
        boolean known = rows.stream().anyMatch(row -> !"unavailable".equals(row.status()));
        boolean stale = rows.stream().anyMatch(AccountQuota::stale);
        return new Quota(!known ? "unavailable" : stale ? "stale" : "available", !known ? "共享服务尚未返回有效额度，请刷新额度"
            : stale ? "部分额度为历史查询结果，请刷新后查看" : "共享服务额度按账号分别显示", Instant.now().toString(), List.copyOf(rows));
    }

    static Quota unavailable(String message) { return new Quota("unavailable", message, Instant.now().toString(), List.of()); }
    static Quota unsupported() { return new Quota("unsupported", "此网页登录通道尚未提供额度读取接口", null, List.of()); }
    static String fingerprint(String base, String key) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest((base + "\n" + key).getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    private static Double percentage(JsonNode value) {
        if (!value.isNumber()) return null;
        double number = value.asDouble();
        return Double.isFinite(number) && number >= 0 && number <= 100 ? number : null;
    }
    private static String text(JsonNode value, int limit) {
        if (!value.isString()) return null;
        String result = value.asText().strip();
        return result.isBlank() || result.length() > limit || result.codePoints().anyMatch(Character::isISOControl)
            || result.indexOf('<') >= 0 || result.indexOf('>') >= 0 ? null : result;
    }
    private static String extraRemaining(JsonNode value) {
        String result = text(value, 80);
        return result != null && result.matches("(?is).*\\d.*") && result.matches("(?is).*(tokens?|credits?|词元|代币|积分).*")
            && !result.matches(".*[A-Za-z0-9_-]{24,}.*") ? result : null;
    }
    private static String timestamp(JsonNode value) {
        if (!value.isNumber()) return null;
        double seconds = value.asDouble();
        if (!Double.isFinite(seconds) || seconds <= 0 || seconds > Instant.now().getEpochSecond() + 300) return null;
        try { return Instant.ofEpochSecond((long) seconds).toString(); } catch (RuntimeException invalid) { return null; }
    }
}
