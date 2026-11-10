package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.test.context.ActiveProfiles;

/** Verifies retirement through authenticated HTTP, so a security 401 cannot mask a surviving route. */
@SpringBootTest(classes=WorkbenchApplication.class,webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties={"server.port=0","app.scheduler-enabled=false","app.muse-api-key=","app.muse-local-key-enabled=false",
        "spring.session.redis.namespace=workbench:retired-editing-regression"})
@ActiveProfiles("dev")
@EnabledIfEnvironmentVariable(named="DB_PASSWORD",matches=".+")
class RetiredEditingHttpTest {
    @Autowired Environment environment;
    private record Route(String method,String path){}

    @Test void removedEditingAsrAndExportRoutesReturn404WhileSharedTextModelsRemainAuthenticated()throws Exception{
        var client=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();
        assertEquals(401,send(client,"GET","/api/models/text").statusCode());
        var login=send(client,"POST","/api/auth/local");assertEquals(200,login.statusCode(),login.body());
        try{
            var catalog=send(client,"GET","/api/models/text");assertEquals(200,catalog.statusCode(),catalog.body());
            assertEquals("no-store",catalog.headers().firstValue("Cache-Control").orElseThrow());
            var models=Json.read(catalog.body()).path("models");assertTrue(models.isArray());
            boolean hasMuse=false;for(var model:models)if("muse-spark".equals(model.path("id").asString()))hasMuse=true;
            assertTrue(hasMuse);
            for(var route:List.of(
                new Route("GET","/api/video-editor/agent/models"),
                new Route("POST","/api/projects/retired/video-editor/agent/plan"),
                new Route("GET","/api/video-editor/capabilities"),
                new Route("GET","/api/projects/retired/video-editor"),
                new Route("PUT","/api/projects/retired/video-editor"),
                new Route("GET","/api/projects/retired/video-editor/exports"),
                new Route("POST","/api/projects/retired/video-editor/exports"),
                new Route("GET","/api/projects/retired/video-editor/exports/retired"),
                new Route("GET","/api/video-captions/capabilities"),
                new Route("POST","/api/projects/retired/video-captions"),
                new Route("GET","/api/projects/retired/video-captions/retired"))){
                var response=send(client,route.method(),route.path());
                assertEquals(404,response.statusCode(),route.method()+" "+route.path()+" must be retired: "+response.body());
            }
        }finally{assertEquals(200,send(client,"POST","/api/auth/logout").statusCode());}
    }

    private HttpResponse<String> send(HttpClient client,String method,String path)throws Exception{
        String base="http://127.0.0.1:"+environment.getRequiredProperty("local.server.port");
        var request=HttpRequest.newBuilder(URI.create(base+path));
        if(method.equals("GET"))request.GET();
        else request.header("Content-Type","application/json").header("X-Workbench-Request","1")
            .header("Origin",environment.getRequiredProperty("app.frontend-url")).method(method,HttpRequest.BodyPublishers.ofString("{}"));
        return client.send(request.build(),HttpResponse.BodyHandlers.ofString());
    }
}
