package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.aop.support.AopUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

/** Runs through Spring's repository proxy, real HTTP, MySQL and Redis session storage. */
@SpringBootTest(classes=WorkbenchApplication.class,webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties={"server.port=0","app.scheduler-enabled=false","app.muse-api-key=","app.muse-local-key-enabled=false","spring.session.redis.namespace=workbench:runtime-regression"})
@ActiveProfiles("dev")
@EnabledIfEnvironmentVariable(named="DB_PASSWORD",matches=".+")
class SpringRuntimeRegressionTest {
    @Autowired Environment environment;
    @Autowired WorkbenchStore store;
    @Autowired JobService jobs;
    @Autowired JobRunner runner;
    @Autowired JdbcTemplate jdbc;
    @Autowired RedisSupport redis;
    private String projectId;
    private String ownerId;

    @AfterEach void cleanup(){
        if(projectId!=null){jdbc.update("DELETE FROM project_revision WHERE project_id=?",projectId);jdbc.update("DELETE FROM project WHERE id=?",projectId);}
        if(ownerId!=null)redis.evictProjects(ownerId);
    }

    @Test void proxiedStoreAndSpringServicesWorkThroughAuthenticatedHttp()throws Exception{
        assertTrue(AopUtils.isAopProxy(store),"Regression must exercise Spring's repository proxy, not a manually created store");
        var cookies=new CookieManager(null,CookiePolicy.ACCEPT_ALL);
        var client=HttpClient.newBuilder().cookieHandler(cookies).build();
        String base="http://127.0.0.1:"+environment.getRequiredProperty("local.server.port");
        var boot=client.send(HttpRequest.newBuilder(URI.create(base+"/api/bootstrap")).GET().build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,boot.statusCode());
        var directory=client.send(HttpRequest.newBuilder(URI.create(base+"/api/skills")).GET().build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,directory.statusCode());
        assertEquals(Json.read(directory.body()),Json.read(boot.body()).path("skills"),"Bootstrap and the skills market must expose the same directory schema and facts");
        var login=client.send(mutation(base+"/api/auth/local","{}").build(),HttpResponse.BodyHandlers.ofString());
        assertEquals(200,login.statusCode(),login.body());ownerId=Json.read(login.body()).path("id").asString();
        var created=client.send(mutation(base+"/api/projects","{\"title\":\"Spring runtime regression\",\"document\":{}}").build(),HttpResponse.BodyHandlers.ofString());
        assertEquals(201,created.statusCode(),created.body());projectId=Json.read(created.body()).path("id").asString();
        var listed=client.send(HttpRequest.newBuilder(URI.create(base+"/api/jobs?projectId="+projectId)).GET().build(),HttpResponse.BodyHandlers.ofString());
        assertEquals(200,listed.statusCode(),listed.body());assertTrue(Json.read(listed.body()).isArray());
        assertTrue(jobs.jobs(ownerId,projectId).isEmpty());
        assertDoesNotThrow(()->runner.execute(UUID.randomUUID().toString()),"Spring-managed worker must obtain its database dependency without dereferencing repository proxy fields");
        var logout=client.send(mutation(base+"/api/auth/logout","{}").build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,logout.statusCode());
    }

    private HttpRequest.Builder mutation(String url,String body){
        return HttpRequest.newBuilder(URI.create(url)).header("Content-Type","application/json").header("X-Workbench-Request","1")
            .header("Origin",environment.getRequiredProperty("app.frontend-url")).POST(HttpRequest.BodyPublishers.ofString(body));
    }
}
