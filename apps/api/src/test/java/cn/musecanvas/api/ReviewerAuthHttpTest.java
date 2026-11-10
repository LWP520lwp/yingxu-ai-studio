package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** Real HTTP, MySQL and Redis sessions with a public test-only password fixture; never contacts providers. */
@SpringBootTest(classes=WorkbenchApplication.class,webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties={"server.port=0","app.scheduler-enabled=false","app.github-client-id=","app.github-client-secret=", "app.pool-overview-enabled=false",
        "app.frontend-url=https://review.example.com","spring.session.redis.namespace=workbench:reviewer-http-regression"})
@ActiveProfiles("prod")
@EnabledIfEnvironmentVariable(named="DB_PASSWORD",matches=".+")
class ReviewerAuthHttpTest {
    static final String USERNAME="reviewer-"+UUID.randomUUID();
    @DynamicPropertySource static void reviewerProperties(DynamicPropertyRegistry registry){
        registry.add("REVIEWER_USERNAME",()->USERNAME);registry.add("REVIEWER_PASSWORD_HASH",()->ReviewerCredentialsTest.HASH);
    }
    @Autowired ConfigurableEnvironment environment;
    @Autowired JdbcTemplate jdbc;
    @Autowired RedisSupport redis;
    private final HttpClient client=HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build();
    private String cookie="",owner;
    @AfterEach void cleanup()throws Exception{
        environment.getPropertySources().remove("reviewer-disabled-by-test");
        if(!cookie.isBlank())send("POST","/api/auth/logout","{}",true);
        if(owner!=null){
            jdbc.update("DELETE r FROM project_revision r JOIN project p ON r.project_id=p.id WHERE p.owner_id=?",owner);
            jdbc.update("DELETE FROM project WHERE owner_id=?",owner);jdbc.update("DELETE FROM app_user WHERE id=?",owner);redis.evictProjects(owner);
        }
    }
    @Test void privateProductionReviewLoginPersistsAndCanBeRevoked()throws Exception{
        assertEquals(401,send("GET","/api/projects",null,true).statusCode());
        assertEquals(403,send("POST","/api/auth/local","{}",true).statusCode());
        assertTrue(Json.read(send("GET","/api/auth/reviewer/config",null,true).body()).path("enabled").asBoolean());
        String credentials=Json.write(Map.of("username",USERNAME,"password","reviewer-unit-test-password"));
        assertEquals(403,send("POST","/api/auth/reviewer",credentials,false).statusCode(),"Missing request marker must reject login");
        assertEquals(401,send("POST","/api/auth/reviewer",Json.write(Map.of("username",USERNAME,"password","wrong")),true).statusCode());
        var login=send("POST","/api/auth/reviewer",credentials,true);assertEquals(200,login.statusCode(),login.body());
        owner=Json.read(login.body()).path("id").asString();assertEquals("reviewer",Json.read(login.body()).path("provider").asString());
        assertEquals("no-store",login.headers().firstValue("Cache-Control").orElse(""));
        cookie=login.headers().allValues("Set-Cookie").stream().filter(s->s.startsWith("WORKBENCH_SESSION=")).findFirst().orElseThrow().split(";",2)[0];
        var boot=send("GET","/api/bootstrap",null,true);assertEquals(owner,Json.read(boot.body()).path("user").path("id").asString());
        assertEquals(201,send("POST","/api/projects","{\"title\":\"private reviewer fixture\",\"document\":{}}",true).statusCode());
        assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM project WHERE owner_id=?",Integer.class,owner));
        assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM app_user WHERE provider='reviewer' AND external_id=?",Integer.class,USERNAME));
        environment.getPropertySources().addFirst(new MapPropertySource("reviewer-disabled-by-test",Map.of("REVIEWER_PASSWORD_HASH","")));
        var revoked=send("GET","/api/projects",null,true);assertEquals(401,revoked.statusCode());assertTrue(revoked.body().contains("REVIEWER_SESSION_EXPIRED"));
        assertEquals(401,send("GET","/api/projects",null,true).statusCode());
    }
    private HttpResponse<String> send(String method,String path,String body,boolean marker)throws Exception{
        var request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+environment.getRequiredProperty("local.server.port")+path)).header("Origin","https://review.example.com");
        if(!cookie.isBlank())request.header("Cookie",cookie);
        if(!method.equals("GET")){if(marker)request.header("X-Workbench-Request","1");request.header("Content-Type","application/json");}
        return client.send(request.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());
    }
}
