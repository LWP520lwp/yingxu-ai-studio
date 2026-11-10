package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import java.net.URI;
import java.net.URLDecoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.test.context.ActiveProfiles;

/** Exercises redirect construction only; never follows the GitHub redirect or exchanges an auth code. */
@SpringBootTest(classes=WorkbenchApplication.class,webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties={"server.port=0","app.scheduler-enabled=false","app.muse-api-key=","app.muse-local-key-enabled=false",
        "app.github-client-id=fake-test-client","app.github-client-secret=fake-test-secret",
        "app.github-redirect-uri=http://localhost:8088/login/oauth2/code/github","spring.session.redis.namespace=workbench:github-redirect-regression"})
@ActiveProfiles("dev")
@EnabledIfEnvironmentVariable(named="DB_PASSWORD",matches=".+")
class GithubAuthorizationHttpTest {
    @Autowired Environment environment;
    @Test void rewrittenLoopbackRequestHostCannotChangeTheRegisteredCallback()throws Exception{
        String base="http://127.0.0.1:"+environment.getRequiredProperty("local.server.port");
        var client=HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build();
        var response=client.send(HttpRequest.newBuilder(URI.create(base+"/oauth2/authorization/github")).GET().build(),HttpResponse.BodyHandlers.ofString());
        assertEquals(302,response.statusCode());URI location=URI.create(response.headers().firstValue("Location").orElseThrow());assertEquals("github.com",location.getHost());
        Map<String,String> query=Arrays.stream(location.getRawQuery().split("&")).map(s->s.split("=",2)).collect(Collectors.toMap(a->decode(a[0]),a->a.length==2?decode(a[1]):""));
        assertEquals("http://localhost:8088/login/oauth2/code/github",query.get("redirect_uri"));assertFalse(query.getOrDefault("state","").isBlank());
        assertTrue(query.getOrDefault("scope","").isBlank(),"Public GitHub identity login must not request private profile, email or repository permissions");
        var bootstrap=client.send(HttpRequest.newBuilder(URI.create(base+"/api/bootstrap")).GET().build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,bootstrap.statusCode());
        assertEquals("http://localhost:8088/oauth2/authorization/github",Json.read(bootstrap.body()).path("auth").path("githubLoginUrl").asString());
    }
    private static String decode(String value){return URLDecoder.decode(value,StandardCharsets.UTF_8);}
}
