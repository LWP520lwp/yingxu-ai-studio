package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest(classes = WorkbenchApplication.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"server.port=0", "app.scheduler-enabled=false", "app.muse-api-key=", "spring.session.redis.namespace=workbench:skill-http-test"})
@ActiveProfiles("dev")
@EnabledIfEnvironmentVariable(named = "DB_PASSWORD", matches = ".+")
class SkillMarketHttpTest {
    @Autowired Environment environment;

    @Test void catalogIsPublicButWorkspaceMutationsRequireSessionAndTrustedHeaders() throws Exception {
        String base = "http://127.0.0.1:" + environment.getRequiredProperty("local.server.port");
        var client = HttpClient.newBuilder().cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL)).build();
        var directory = client.send(HttpRequest.newBuilder(URI.create(base + "/api/skills")).GET().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, directory.statusCode(), directory.body());
        assertEquals(new SkillCatalog().definitions().size(), Json.read(directory.body()).size());
        var workspace = client.send(HttpRequest.newBuilder(URI.create(base + "/api/workspace/skills")).GET().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(401, workspace.statusCode());
        var noSession = client.send(mutation(base + "/api/workspace/skills/image-create", "PUT", "{\"recipeVersion\":\"1.0.0\"}").build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(401, noSession.statusCode());
        var noFavoriteSession = client.send(mutation(base + "/api/workspace/skill-favorites/image-create", "PUT", "{}").build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(401, noFavoriteSession.statusCode());
        var noImportSession = client.send(HttpRequest.newBuilder(URI.create(base + "/api/workspace/skill-imports"))
            .header("Content-Type", "multipart/form-data; boundary=skill-test").header("X-Workbench-Request", "1")
            .POST(HttpRequest.BodyPublishers.ofString("--skill-test--\r\n")).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(401, noImportSession.statusCode());
        var login = client.send(mutation(base + "/api/auth/local", "POST", "{}").build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, login.statusCode(), login.body());
        var missingHeader = client.send(HttpRequest.newBuilder(URI.create(base + "/api/workspace/skills/image-create"))
            .header("Content-Type", "application/json").PUT(HttpRequest.BodyPublishers.ofString("{\"recipeVersion\":\"1.0.0\"}")).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(403, missingHeader.statusCode());
        var noFavoriteHeader = client.send(HttpRequest.newBuilder(URI.create(base + "/api/workspace/skill-favorites/image-create"))
            .PUT(HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(403, noFavoriteHeader.statusCode());
        var noImportHeader = client.send(HttpRequest.newBuilder(URI.create(base + "/api/workspace/skill-imports"))
            .header("Content-Type", "multipart/form-data; boundary=skill-test")
            .POST(HttpRequest.BodyPublishers.ofString("--skill-test--\r\n")).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(403, noImportHeader.statusCode());
        String invalidPackage = "--skill-test\r\nContent-Disposition: form-data; name=\"file\"; filename=\"skill.json\"\r\nContent-Type: application/json\r\n\r\n{invalid}\r\n--skill-test--\r\n";
        var invalidImport = client.send(HttpRequest.newBuilder(URI.create(base + "/api/workspace/skill-imports"))
            .header("Content-Type", "multipart/form-data; boundary=skill-test").header("X-Workbench-Request", "1")
            .header("Origin", environment.getRequiredProperty("app.frontend-url"))
            .POST(HttpRequest.BodyPublishers.ofString(invalidPackage)).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(400, invalidImport.statusCode(), invalidImport.body());
        var unknownFavorite = client.send(mutation(base + "/api/workspace/skill-favorites/not-a-built-in", "PUT", "{}").build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(404, unknownFavorite.statusCode());

        // Reuse the MySQL test owners for install/uninstall persistence coverage;
        // this HTTP test does not alter a developer's existing skill installations.
        var unknown = client.send(mutation(base + "/api/workspace/skills/not-a-built-in", "PUT", "{\"recipeVersion\":\"1.0.0\"}").build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(404, unknown.statusCode());
        var planned = client.send(mutation(base + "/api/workspace/skills/storyboard-to-video", "PUT", "{\"recipeVersion\":\"0.1.0\"}").build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(409, planned.statusCode());
        assertEquals("SKILL_NOT_AVAILABLE", Json.read(planned.body()).path("code").asString());
    }

    private HttpRequest.Builder mutation(String url, String method, String body) {
        return HttpRequest.newBuilder(URI.create(url)).header("Content-Type", "application/json")
            .header("X-Workbench-Request", "1").header("Origin", environment.getRequiredProperty("app.frontend-url"))
            .method(method, HttpRequest.BodyPublishers.ofString(body));
    }
}
