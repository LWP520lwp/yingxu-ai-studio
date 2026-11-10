package cn.musecanvas.api;

import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

/** Authenticated loopback-only adapter for the separately managed browser worker. */
@Component
public final class BrowserWorkerClient {
    public record Status(String state, String message, boolean image, boolean video) {}
    public record Generated(byte[] bytes, String mimeType) {}
    public static final class WorkerException extends RuntimeException {
        private final boolean submissionUncertain;
        private final String code;
        WorkerException(String message, String code, boolean submissionUncertain) {
            super(message); this.code = code; this.submissionUncertain = submissionUncertain;
        }
        public boolean submissionUncertain() { return submissionUncertain; }
        public String code() { return code; }
    }

    private static final int STATUS_LIMIT = 1024 * 1024;
    private static final int GENERATED_LIMIT = (int)(AssetService.MAX_BYTES * 4 / 3 + 4096);
    private static final Set<String> STATES = Set.of("login_required", "ready", "verification_required", "unsupported", "error");
    private static final Set<String> PROVIDERS = Set.of("muse", "doubao");
    private final AppSettings settings;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2))
        .followRedirects(HttpClient.Redirect.NEVER).build();

    public BrowserWorkerClient(AppSettings settings) { this.settings = settings; }

    public boolean configured() { return endpoint() != null && !settings.browserWorkerToken().isBlank(); }
    public boolean interactiveLoginEnabled() { return settings.browserInteractiveLoginEnabled(); }

    public boolean available() {
        if (!configured()) return false;
        try {
            var response = send("/health", "GET", null, Duration.ofSeconds(3), STATUS_LIMIT, true);
            return response.statusCode() == 200;
        } catch (RuntimeException ex) { return false; }
    }

    public Status login(String id, String provider) {
        if (!PROVIDERS.contains(provider)) throw new IllegalArgumentException("Unsupported browser provider");
        var body = Map.<String, Object>of("provider", provider);
        // A cold context launch (30s) plus first navigation (45s) must complete
        // before the API declares a login failure. The account lease is 120s.
        var response = send("/accounts/" + accountId(id) + "/login", "POST", Json.write(body), Duration.ofSeconds(90), STATUS_LIMIT, false);
        return status(response, false);
    }

    public Status status(String id) {
        var response = send("/accounts/" + accountId(id) + "/status", "GET", null, Duration.ofSeconds(5), STATUS_LIMIT, false);
        return status(response, false);
    }

    public Status close(String id) {
        var response = send("/accounts/" + accountId(id) + "/close", "POST", "{}", Duration.ofSeconds(5), STATUS_LIMIT, false);
        if (response.statusCode() < 200 || response.statusCode() >= 300) throw workerError(response.statusCode(), parse(response.body()), false);
        return new Status("login_required", "本机浏览器窗口已关闭；重新点击登录可恢复会话", false, false);
    }

    public void deleteProfile(String id) {
        send("/accounts/" + accountId(id), "DELETE", null, Duration.ofSeconds(10), STATUS_LIMIT, false);
    }

    public Generated generate(String id, JobService.Request request, List<String> referenceImages) {
        var body = new LinkedHashMap<String, Object>();
        body.put("provider", providerFor(request.model())); body.put("kind", request.kind());
        body.put("prompt", request.prompt()); body.put("width", request.width()); body.put("height", request.height());
        body.put("duration", request.duration()); body.put("model", request.model());
        if (!referenceImages.isEmpty()) body.put("referenceImages", referenceImages);
        HttpResponse<byte[]> response;
        try {
            var builder = HttpRequest.newBuilder(uri("/accounts/" + accountId(id) + "/generate"))
                .timeout(Duration.ofSeconds(610)).header("Authorization", "Bearer " + settings.browserWorkerToken())
                .header("Accept", "application/json").header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(Json.write(body)));
            response = client.send(builder.build(), info -> new LimitedBodySubscriber(GENERATED_LIMIT));
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new WorkerException("浏览器生成请求中断，外部提交状态不确定；系统不会自动重复提交", "WORKER_INTERRUPTED", true);
        } catch (Exception ex) {
            throw new WorkerException("浏览器生成服务连接中断，外部提交状态不确定；系统不会自动重复提交", "WORKER_UNCERTAIN", true);
        }
        JsonNode json = parse(response.body());
        if (response.statusCode() < 200 || response.statusCode() >= 300) throw workerError(response.statusCode(), json, true);
        if (json == null) throw new WorkerException("浏览器生成响应无效，外部提交状态不确定；系统不会自动重复提交", "WORKER_INVALID_RESPONSE", true);
        String encoded = MuseClient.text(json, "base64"); String mime = MuseClient.text(json, "mimeType");
        if (encoded == null || mime == null || encoded.length() > GENERATED_LIMIT)
            throw new WorkerException("浏览器生成响应缺少有效媒体，外部提交状态不确定；系统不会自动重复提交", "WORKER_INVALID_RESPONSE", true);
        try {
            byte[] bytes = Base64.getDecoder().decode(encoded);
            if (bytes.length == 0 || bytes.length > AssetService.MAX_BYTES || !mime.startsWith(request.kind() + "/"))
                throw new IllegalArgumentException("invalid media");
            return new Generated(bytes, mime);
        } catch (IllegalArgumentException ex) {
            throw new WorkerException("浏览器生成响应媒体无效，外部提交状态不确定；系统不会自动重复提交", "WORKER_INVALID_MEDIA", true);
        }
    }

    private Status status(HttpResponse<byte[]> response, boolean uncertain) {
        if (response.statusCode() < 200 || response.statusCode() >= 300) throw workerError(response.statusCode(), parse(response.body()), uncertain);
        JsonNode json = parse(response.body());
        if (json == null) throw new WorkerException("浏览器执行器返回了无效状态", "WORKER_INVALID_RESPONSE", false);
        String state = MuseClient.text(json, "state");
        if (!STATES.contains(state)) state = "error";
        String message = MuseClient.text(json, "message");
        if (message != null && message.length() > 500) message = message.substring(0, 500);
        JsonNode caps = json.path("capabilities");
        return new Status(state, message, caps.path("image").asBoolean(false), caps.path("video").asBoolean(false));
    }

    private WorkerException workerError(int status, JsonNode json, boolean generating) {
        String code = MuseClient.text(json == null ? Json.read("{}") : json, "code");
        boolean hasDisposition = json != null && json.path("submissionUncertain").isBoolean();
        boolean uncertain = generating && (hasDisposition ? json.path("submissionUncertain").asBoolean()
            : status >= 500 || status == 408 || status == 504);
        String message = code == null ? "浏览器执行器请求失败（HTTP " + status + ")" : safeMessage(json.path("message").asString("浏览器执行器请求失败"));
        return new WorkerException(message, code == null ? "WORKER_HTTP_" + status : code, uncertain);
    }

    private static String safeMessage(String value) {
        String clean = value.replaceAll("[\\p{Cntrl}]", " ").strip();
        return clean.length() <= 500 ? clean : clean.substring(0, 500);
    }

    private HttpResponse<byte[]> send(String path, String method, String body, Duration timeout, int limit, boolean health) {
        if (!configured()) throw new WorkerException("浏览器执行器尚未配置", "WORKER_NOT_CONFIGURED", false);
        try {
            var builder = HttpRequest.newBuilder(uri(path)).timeout(timeout)
                .header("Authorization", "Bearer " + settings.browserWorkerToken()).header("Accept", "application/json");
            if (body != null) builder.header("Content-Type", "application/json");
            var request = body == null ? builder.method(method, HttpRequest.BodyPublishers.noBody()).build()
                : builder.method(method, HttpRequest.BodyPublishers.ofString(body)).build();
            return client.send(request, info -> new LimitedBodySubscriber(limit));
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt(); throw new WorkerException("浏览器执行器请求中断", "WORKER_INTERRUPTED", false);
        } catch (Exception ex) {
            throw new WorkerException("浏览器执行器暂不可用", "WORKER_UNAVAILABLE", false);
        }
    }

    private URI endpoint() {
        try {
            URI configured = URI.create(settings.browserWorkerUrl());
            String host = configured.getHost();
            if (!Set.of("http", "https").contains(configured.getScheme()) || host == null
                || !Set.of("127.0.0.1", "::1", "[::1]").contains(host.toLowerCase(java.util.Locale.ROOT))
                || configured.getUserInfo() != null || configured.getQuery() != null || configured.getFragment() != null
                || !(configured.getPath().isBlank() || configured.getPath().equals("/"))) return null;
            return URI.create(configured.toString().replaceAll("/+$", ""));
        } catch (RuntimeException ex) { return null; }
    }

    private URI uri(String path) {
        URI base = endpoint();
        if (base == null) throw new WorkerException("浏览器执行器地址必须是本机回环 HTTP(S) 服务", "WORKER_INVALID_URL", false);
        return URI.create(base + path);
    }

    private static String accountId(String id) {
        if (id == null || !id.matches("[0-9a-fA-F-]{36}")) throw new IllegalArgumentException("Invalid pool account id");
        return id;
    }

    private static String providerFor(String model) { return model.startsWith("doubao-") ? "doubao" : "muse"; }

    private static JsonNode parse(byte[] body) {
        try { return Json.read(new String(body, StandardCharsets.UTF_8)); }
        catch (RuntimeException ex) { return null; }
    }

    private static final class LimitedBodySubscriber implements HttpResponse.BodySubscriber<byte[]> {
        private final java.util.concurrent.CompletableFuture<byte[]> result = new java.util.concurrent.CompletableFuture<>();
        private final java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
        private final int limit;
        private java.util.concurrent.Flow.Subscription subscription;
        private LimitedBodySubscriber(int limit) { this.limit = limit; }
        @Override public java.util.concurrent.CompletionStage<byte[]> getBody() { return result; }
        @Override public void onSubscribe(java.util.concurrent.Flow.Subscription subscription) { this.subscription = subscription; subscription.request(1); }
        @Override public void onNext(List<java.nio.ByteBuffer> buffers) {
            try {
                for (var buffer : buffers) {
                    int size = buffer.remaining();
                    if ((long) output.size() + size > limit) throw new IllegalStateException("Worker response exceeds limit");
                    byte[] part = new byte[size]; buffer.get(part); output.writeBytes(part);
                }
                subscription.request(1);
            } catch (RuntimeException ex) { subscription.cancel(); result.completeExceptionally(ex); }
        }
        @Override public void onError(Throwable error) { result.completeExceptionally(error); }
        @Override public void onComplete() { result.complete(output.toByteArray()); }
    }
}
