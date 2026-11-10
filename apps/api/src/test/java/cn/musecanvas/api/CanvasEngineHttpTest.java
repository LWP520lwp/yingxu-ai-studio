package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.JsonNode;

/** Real HTTP, MySQL and Redis; no provider calls and no existing project changes. */
@SpringBootTest(classes=WorkbenchApplication.class, webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties={"server.port=0", "app.scheduler-enabled=false", "app.muse-api-key=", "app.frontend-url=http://localhost:5178", "spring.session.redis.namespace=workbench:canvas-engine-http-test"})
@ActiveProfiles("dev")
@EnabledIfEnvironmentVariable(named="DB_PASSWORD", matches=".+")
class CanvasEngineHttpTest {
    private static final String LEGACY = "{\"schemaVersion\":1,\"nodes\":[],\"edges\":[],\"legacyExtension\":{\"keep\":true}}";
    @Autowired Environment environment;
    @Autowired JdbcTemplate jdbc;
    @Autowired WorkbenchStore store;
    @Autowired RedisSupport redis;
    private final List<String> projectIds = new ArrayList<>();
    private HttpClient client;
    private String owner;
    private String otherOwner;
    private String projectId;

    @BeforeEach void setup() throws Exception {
        client = HttpClient.newBuilder().cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL)).build();
        var login = send("POST", "/api/auth/local", "{}");
        assertEquals(200, login.statusCode(), login.body());
        owner = Json.read(login.body()).path("id").asString();
        var created = send("POST", "/api/projects", "{\"title\":\"canvas engine test\",\"document\":" + LEGACY + "}");
        assertEquals(201, created.statusCode(), created.body());
        projectId = Json.read(created.body()).path("id").asString();
        projectIds.add(projectId);
    }

    @AfterEach void cleanup() throws Exception {
        for (String id : projectIds) {
            jdbc.update("DELETE FROM project_revision WHERE project_id=?", id);
            jdbc.update("DELETE FROM project WHERE id=?", id);
        }
        if (otherOwner != null) { redis.evictProjects(otherOwner); jdbc.update("DELETE FROM app_user WHERE id=?", otherOwner); }
        if (owner != null) redis.evictProjects(owner);
        if (client != null) send("POST", "/api/auth/logout", "{}");
    }

    @Test void nativeSnapshotsRoundTripUnknownFieldsAndDoNotOverwriteTheLegacyDocument() throws Exception {
        var empty = send("GET", route(), null);
        assertEquals(200, empty.statusCode(), empty.body());
        assertEquals(0, Json.read(empty.body()).path("revision").asLong());
        assertTrue(Json.read(empty.body()).path("document").isNull());
        assertEquals("no-store", empty.headers().firstValue("Cache-Control").orElseThrow());
        JsonNode document = nativeDocument("original");
        var saved = put(0, document);
        assertEquals(200, saved.statusCode(), saved.body());
        assertEquals(1, Json.read(saved.body()).path("revision").asLong());
        assertEquals(document, Json.read(saved.body()).path("document"));
        assertEquals(document, Json.read(send("GET", route(), null).body()).path("document"));
        var legacy = Json.read(send("GET", "/api/projects/" + projectId, null).body());
        assertEquals(1, legacy.path("revision").asLong());
        assertEquals(Json.read(LEGACY), legacy.path("document"));
        store.saveProject(owner, projectId, 1, "legacy changed", Json.read("{\"legacy\":2}"));
        assertEquals(1, Json.read(send("GET", route(), null).body()).path("revision").asLong());
        var updated = put(1, nativeDocument("updated"));
        assertEquals(200, updated.statusCode(), updated.body());
        assertEquals(2, Json.read(updated.body()).path("revision").asLong());
        assertEquals(2L, jdbc.queryForObject("SELECT revision FROM project_canvas_engine WHERE project_id=?", Long.class, projectId).longValue());
        assertEquals(2, ((Number) store.project(owner, projectId).get("revision")).longValue());
        assertEquals(Json.read("{\"legacy\":2}"), store.project(owner, projectId).get("document"));
    }

    @Test void concurrentFirstSavesHaveExactlyOneWinnerAndStaleEditsCannotOverwrite() throws Exception {
        try (var executor = Executors.newFixedThreadPool(2)) {
            List<Callable<HttpResponse<String>>> calls = List.of(() -> put(0, nativeDocument("one")), () -> put(0, nativeDocument("two")));
            var results = executor.invokeAll(calls);
            var codes = List.of(results.get(0).get().statusCode(), results.get(1).get().statusCode());
            assertTrue(codes.contains(200), codes.toString());
            assertTrue(codes.contains(409), codes.toString());
        }
        var before = Json.read(send("GET", route(), null).body());
        var stale = put(0, nativeDocument("stale"));
        assertEquals(409, stale.statusCode(), stale.body());
        assertEquals("CANVAS_ENGINE_REVISION_CONFLICT", Json.read(stale.body()).path("code").asString());
        assertEquals(1, Json.read(stale.body()).path("currentRevision").asLong());
        assertEquals(before.path("document"), Json.read(send("GET", route(), null).body()).path("document"));
    }

    @Test void projectOwnershipSessionsAndMutationHeadersAreEnforced() throws Exception {
        otherOwner = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO app_user(id,provider,external_id,display_name) VALUES(?,'test',?,'other owner')", otherOwner, otherOwner);
        String otherProject = (String) store.createProject(otherOwner, "private", Json.read("{}")).get("id");
        projectIds.add(otherProject);
        assertEquals(404, send("GET", "/api/projects/" + otherProject + "/canvas-engine", null).statusCode());
        assertEquals(404, send("PUT", "/api/projects/" + otherProject + "/canvas-engine", payload(0, nativeDocument("denied"))).statusCode());
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM project_canvas_engine WHERE project_id=?", Integer.class, otherProject));
        var anonymous = HttpClient.newHttpClient();
        assertEquals(401, anonymous.send(HttpRequest.newBuilder(URI.create(base() + route())).GET().build(), HttpResponse.BodyHandlers.ofString()).statusCode());
        var missingHeader = HttpRequest.newBuilder(URI.create(base() + route())).header("Content-Type", "application/json")
            .PUT(HttpRequest.BodyPublishers.ofString(payload(0, nativeDocument("denied")))).build();
        assertEquals(403, client.send(missingHeader, HttpResponse.BodyHandlers.ofString()).statusCode());
    }

    @Test void malformedSnapshotsAndMissingRevisionsAreRejectedWithoutCreatingRows() throws Exception {
        assertEquals(400, send("PUT", route(), "{\"document\":{\"nodes\":[],\"connections\":[]}}").statusCode());
        assertEquals(400, put(-1, nativeDocument("invalid")).statusCode());
        assertEquals(400, put(0, Json.read("{\"nodes\":[],\"connections\":[{\"id\":\"e\",\"fromNodeId\":\"missing\",\"toNodeId\":\"missing\"}]}" )).statusCode());
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM project_canvas_engine WHERE project_id=?", Integer.class, projectId));
    }

    private HttpResponse<String> put(long revision, JsonNode document) throws Exception { return send("PUT", route(), payload(revision, document)); }
    private static String payload(long revision, JsonNode document) { return Json.write(Map.of("baseRevision", revision, "document", document)); }
    private String route() { return "/api/projects/" + projectId + "/canvas-engine"; }
    private String base() { return "http://127.0.0.1:" + environment.getRequiredProperty("local.server.port"); }
    private HttpResponse<String> send(String method, String route, String body) throws Exception {
        var request = HttpRequest.newBuilder(URI.create(base() + route));
        if (!"GET".equals(method)) request.header("Content-Type", "application/json").header("X-Workbench-Request", "1").header("Origin", "http://localhost:5178");
        return client.send(request.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    }
    private static JsonNode nativeDocument(String text) {
        var nodes = new ArrayList<Map<String, Object>>();
        for (String type : List.of("text", "image", "video", "audio", "config", "group", "plugin:custom"))
            nodes.add(Map.of("id", type, "type", type, "title", type, "position", Map.of("x", -10, "y", 20), "width", 340, "height", 240,
                "metadata", Map.of("content", text, "groupId", "group", "custom", Map.of("keep", List.of(1, 2)))));
        return Json.read(Json.write(Map.of("id", "native-id", "title", "native project", "nodes", nodes,
            "connections", List.of(Map.of("id", "edge", "fromNodeId", "text", "toNodeId", "config")),
            "viewport", Map.of("x", 12, "y", -2, "k", 0.7), "groups", List.of(Map.of("id", "group")),
            "promptLibrary", List.of(Map.of("text", text)), "chatSessions", List.of(Map.of("messages", List.of(text))),
            "extension", Map.of("nested", List.of(true, 3)))));
    }
}
