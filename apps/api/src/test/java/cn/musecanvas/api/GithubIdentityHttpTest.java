package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.session.Session;
import org.springframework.session.SessionRepository;
import org.springframework.test.context.ActiveProfiles;

/** Simulated provider profiles; real MySQL identities, Redis sessions and authenticated HTTP. No GitHub network calls. */
@SpringBootTest(classes=WorkbenchApplication.class,webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties={"server.port=0","app.scheduler-enabled=false","app.muse-api-key=","app.muse-local-key-enabled=false",
        "app.github-client-id=fake-test-client","app.github-client-secret=fake-test-secret",
        "app.github-redirect-uri=http://localhost:8088/login/oauth2/code/github","spring.session.redis.namespace=workbench:github-identity-regression"})
@ActiveProfiles("dev")
@EnabledIfEnvironmentVariable(named="DB_PASSWORD",matches=".+")
class GithubIdentityHttpTest {
    @Autowired Environment environment;
    @Autowired UserService users;
    @Autowired JdbcTemplate jdbc;
    @Autowired SessionRepository<?> sessions;
    @Autowired AssetService assets;
    @Autowired RedisSupport redis;
    private final HttpClient client=HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build();
    private final List<String> owners=new ArrayList<>();
    private final List<String> sessionIds=new ArrayList<>();

    @AfterEach void cleanup()throws Exception{
        for(String sessionId:sessionIds)sessions.deleteById(sessionId);
        for(String owner:owners){
            for(String name:jdbc.queryForList("SELECT storage_name FROM asset WHERE owner_id=?",String.class,owner))Files.deleteIfExists(assets.safePath(name));
            jdbc.update("DELETE FROM asset WHERE owner_id=?",owner);
            jdbc.update("DELETE r FROM project_revision r JOIN project p ON r.project_id=p.id WHERE p.owner_id=?",owner);
            jdbc.update("DELETE FROM project WHERE owner_id=?",owner);
            jdbc.update("DELETE FROM user_skill_installation WHERE owner_id=?",owner);
            jdbc.update("DELETE FROM app_user WHERE id=?",owner);
            redis.evictProjects(owner);
        }
    }

    @Test void returningGithubIdKeepsItsAccountWhenPublicProfileChanges(){
        String externalId=externalId();
        var profile=new HashMap<String,Object>();profile.put("id",Long.parseLong(externalId));profile.put("login","first-handle");profile.put("name",null);profile.put("avatar_url",null);
        var first=users.githubUser(profile);owners.add(first.user().id());
        assertEquals("first-handle",first.user().name());assertEquals("",first.user().avatarUrl());
        profile.put("login","renamed-handle");profile.put("name","  创作者\n新名字  ");profile.put("avatar_url","https://avatars.githubusercontent.com/u/1?v=4");
        var returning=users.githubUser(profile);
        assertEquals(first.user().id(),returning.user().id());assertEquals("创作者新名字",returning.user().name());
        assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM app_user WHERE provider='github' AND external_id=?",Integer.class,externalId));
        var other=users.githubUser(Map.of("id",externalId(),"login","renamed-handle","name","x".repeat(300),"avatar_url","javascript:alert(1)"));owners.add(other.user().id());
        assertNotEquals(returning.user().id(),other.user().id(),"GitHub handles do not link unrelated numeric identities");
        assertEquals(255,other.user().name().length());assertEquals("",other.user().avatarUrl());
    }

    @Test void twoGithubAccountsHaveIndependentProjectsAssetsSkillsAndLogout()throws Exception{
        String firstCookie=signIn(identity("first"));String secondCookie=signIn(identity("second"));
        var firstBoot=send(firstCookie,"GET","/api/bootstrap",null);var secondBoot=send(secondCookie,"GET","/api/bootstrap",null);
        assertEquals(200,firstBoot.statusCode());assertEquals(200,secondBoot.statusCode());
        String firstOwner=Json.read(firstBoot.body()).path("user").path("id").asString();
        String secondOwner=Json.read(secondBoot.body()).path("user").path("id").asString();
        assertNotEquals(firstOwner,secondOwner);assertEquals("github",Json.read(firstBoot.body()).path("user").path("provider").asString());
        var projectResponse=send(firstCookie,"POST","/api/projects","{\"title\":\"first private project\",\"document\":{}}");assertEquals(201,projectResponse.statusCode(),projectResponse.body());
        String projectId=Json.read(projectResponse.body()).path("id").asString();
        assertEquals(1,Json.read(send(firstCookie,"GET","/api/projects",null).body()).size());
        assertEquals(0,Json.read(send(secondCookie,"GET","/api/projects",null).body()).size());
        assertEquals(404,send(secondCookie,"GET","/api/projects/"+projectId,null).statusCode());
        assertEquals(404,send(secondCookie,"PUT","/api/projects/"+projectId,"{\"title\":\"stolen\",\"document\":{},\"baseRevision\":1}").statusCode());

        String boundary="github-identity-fixture";
        String multipart="--"+boundary+"\r\nContent-Disposition: form-data; name=\"projectId\"\r\n\r\n"+projectId+"\r\n--"+boundary+"\r\nContent-Disposition: form-data; name=\"file\"; filename=\"private.txt\"\r\nContent-Type: text/plain\r\n\r\nfirst account private asset\r\n--"+boundary+"--\r\n";
        var upload=client.send(request(firstCookie,"/api/assets").header("X-Workbench-Request","1").header("Content-Type","multipart/form-data; boundary="+boundary).POST(HttpRequest.BodyPublishers.ofString(multipart)).build(),HttpResponse.BodyHandlers.ofString());
        assertEquals(201,upload.statusCode(),upload.body());String assetId=Json.read(upload.body()).path("id").asString();
        assertEquals("first account private asset",send(firstCookie,"GET","/api/assets/"+assetId+"/content",null).body());
        assertEquals(404,send(secondCookie,"GET","/api/assets/"+assetId+"/content",null).statusCode());
        assertEquals(0,Json.read(send(secondCookie,"GET","/api/assets",null).body()).size());
        assertEquals(404,send(secondCookie,"GET","/api/assets?projectId="+projectId,null).statusCode());

        assertEquals(200,send(firstCookie,"PUT","/api/workspace/skills/image-create","{\"recipeVersion\":\"1.0.0\"}").statusCode());
        assertEquals(1,Json.read(send(firstCookie,"GET","/api/workspace/skills",null).body()).size());
        assertEquals(0,Json.read(send(secondCookie,"GET","/api/workspace/skills",null).body()).size());
        assertFalse(Json.read(send(secondCookie,"GET","/api/skills/image-create",null).body()).path("installed").asBoolean());
        assertEquals(200,send(secondCookie,"DELETE","/api/workspace/skills/image-create",null).statusCode());
        assertEquals(1,Json.read(send(firstCookie,"GET","/api/workspace/skills",null).body()).size());
        assertEquals(200,send(firstCookie,"POST","/api/auth/logout","{}").statusCode());
        assertEquals(401,send(firstCookie,"GET","/api/projects",null).statusCode());
        assertEquals(200,send(secondCookie,"GET","/api/projects",null).statusCode(),"Signing one user out must not invalidate another user's Redis session");
    }

    private UserService.GithubPrincipal identity(String name){
        var principal=users.githubUser(Map.of("id",externalId(),"login",name));owners.add(principal.user().id());return principal;
    }
    private static String externalId(){return Long.toString(ThreadLocalRandom.current().nextLong(1_000_000_000_000_000L,9_000_000_000_000_000L));}
    private String signIn(UserService.GithubPrincipal principal){return saveSession(sessions,principal);}
    private <S extends Session> String saveSession(SessionRepository<S> repository,UserService.GithubPrincipal principal){
        var context=SecurityContextHolder.createEmptyContext();context.setAuthentication(new OAuth2AuthenticationToken(principal,principal.getAuthorities(),"github"));
        S session=repository.createSession();session.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY,context);repository.save(session);sessionIds.add(session.getId());
        return "WORKBENCH_SESSION="+Base64.getEncoder().encodeToString(session.getId().getBytes(StandardCharsets.UTF_8));
    }
    private HttpRequest.Builder request(String cookie,String path){return HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+environment.getRequiredProperty("local.server.port")+path)).header("Cookie",cookie);}
    private HttpResponse<String> send(String cookie,String method,String path,String body)throws Exception{
        var request=request(cookie,path);if(!method.equals("GET"))request.header("X-Workbench-Request","1").header("Content-Type","application/json");
        return client.send(request.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());
    }
}
