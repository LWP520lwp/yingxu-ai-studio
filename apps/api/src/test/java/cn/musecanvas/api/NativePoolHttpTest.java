package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.session.Session;
import org.springframework.session.SessionRepository;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** Real HTTP, MySQL and Redis with local fake Muse and browser-worker endpoints; no provider/site calls. */
@SpringBootTest(classes=WorkbenchApplication.class,webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties={"server.port=0","app.scheduler-enabled=false","app.muse-api-key=","app.muse-local-key-enabled=true",
        "app.browser-interactive-login-enabled=true","app.pool-credential-master-key=", "app.frontend-url=http://localhost:5178",
        "spring.session.redis.namespace=workbench:native-pool-http-regression"})
@ActiveProfiles("dev")
@EnabledIfEnvironmentVariable(named="DB_PASSWORD",matches=".+")
class NativePoolHttpTest {
    private static final String TOKEN="native-pool-test-bearer-token-0123456789";
    private static final String MASTER=Base64.getEncoder().encodeToString("0123456789abcdef0123456789abcdef".getBytes(StandardCharsets.UTF_8));
    private static final String PNG="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
    private static final byte[] PNG_BYTES=Base64.getDecoder().decode(PNG);
    private static final HttpServer WORKER=server();
    private static final HttpServer LEGACY=server();
    private static final Map<String,String> PROVIDERS=new ConcurrentHashMap<>();
    private static volatile String lastGenerateBody="";
    private static volatile boolean bearerValid=true;
    private static volatile int legacySubmissions;
    private static volatile boolean legacyBearerValid=true;
    private static volatile boolean rejectServicePolling;
    private static volatile int quotaChecks;
    private static final String WORKER_URL="http://127.0.0.1:"+WORKER.getAddress().getPort();
    private static final String LEGACY_URL="http://127.0.0.1:"+LEGACY.getAddress().getPort();

    static {
        WORKER.createContext("/health", exchange -> { auth(exchange); respond(exchange,200,"{\"status\":\"ok\"}"); });
        WORKER.createContext("/accounts/", NativePoolHttpTest::workerRoute);
        LEGACY.createContext("/admin/local-key", exchange -> respond(exchange,200,"{\"key\":\"legacy-key-never-return-this\"}"));
        LEGACY.createContext("/admin/status", exchange -> {
            assertEquals("Bearer legacy-key-never-return-this",exchange.getRequestHeaders().getFirst("Authorization"));
            respond(exchange,200,"{\"accounts\":[{\"id\":\"supplier-private-id\",\"label\":\"private-email\",\"enabled\":true,\"quota\":{\"found\":true,\"weekly_used_pct\":25,\"checked_at\":"+java.time.Instant.now().getEpochSecond()+",\"raw\":\"private-settings\"}}]}");
        });
        LEGACY.createContext("/admin/accounts/supplier-private-id/quota", exchange -> {
            assertEquals("POST",exchange.getRequestMethod()); quotaChecks++; respond(exchange,200,"{\"found\":true}");
        });
        LEGACY.createContext("/v1/images/tasks", NativePoolHttpTest::legacyImageRoute);
        WORKER.start(); LEGACY.start();
    }

    @DynamicPropertySource static void nativePoolProperties(DynamicPropertyRegistry properties){
        properties.add("app.browser-worker-url",()->WORKER_URL);properties.add("app.browser-worker-token",()->TOKEN);
        properties.add("app.pool-credential-master-key",()->MASTER);properties.add("app.muse-base-url",()->LEGACY_URL);
        properties.add("app.muse-local-pool-url",()->LEGACY_URL);properties.add("app.storage-root",()->System.getProperty("java.io.tmpdir")+"/creative-workbench-native-pool-test-assets");
    }

    @Autowired Environment environment;
    @Autowired JdbcTemplate jdbc;
    @Autowired NativePoolService pool;
    @Autowired CredentialCipher cipher;
    @Autowired BrowserWorkerClient worker;
    @Autowired JobRunner runner;
    @Autowired JobService jobs;
    @Autowired AssetService assets;
    @Autowired WorkbenchStore store;
    @Autowired PoolController controller;
    @Autowired RedisSupport redis;
    @Autowired UserService users;
    @Autowired SessionRepository<?> sessions;
    private HttpClient client;
    private String owner;
    private String projectId;
    private String jobId;
    private final List<String> accounts=new ArrayList<>();
    private final List<String> otherOwners=new ArrayList<>();
    private final List<String> sessionIds=new ArrayList<>();

    @BeforeEach void login(){
        PROVIDERS.clear();lastGenerateBody="";bearerValid=true;legacySubmissions=0;legacyBearerValid=true;rejectServicePolling=false;quotaChecks=0;
        var cookies=new CookieManager(null,CookiePolicy.ACCEPT_ALL);client=HttpClient.newBuilder().cookieHandler(cookies).followRedirects(HttpClient.Redirect.NEVER).build();
        try{var response=send("POST","/api/auth/local","{}");assertEquals(200,response.statusCode(),response.body());owner=Json.read(response.body()).path("id").asString();}catch(Exception e){throw new IllegalStateException(e);}
    }

    @AfterEach void cleanup()throws Exception{
        if(jobId!=null){
            for(String name:jdbc.queryForList("SELECT storage_name FROM asset WHERE source_job_id=?",String.class,jobId))Files.deleteIfExists(assets.safePath(name));
            jdbc.update("DELETE FROM asset WHERE source_job_id=?",jobId);jdbc.update("DELETE FROM generation_job WHERE id=?",jobId);
        }
        if(projectId!=null){
            for(String name:jdbc.queryForList("SELECT storage_name FROM asset WHERE project_id=?",String.class,projectId))Files.deleteIfExists(assets.safePath(name));
            jdbc.update("DELETE FROM asset WHERE project_id=?",projectId);jdbc.update("DELETE FROM project_revision WHERE project_id=?",projectId);jdbc.update("DELETE FROM project WHERE id=?",projectId);redis.evictProjects(owner);
        }
        for(String id:accounts)jdbc.update("DELETE FROM pool_account WHERE id=?",id);
        for(String sessionId:sessionIds)sessions.deleteById(sessionId);
        for(String other:otherOwners){redis.evictProjects(other);jdbc.update("DELETE FROM app_user WHERE id=?",other);}
        if(client!=null&&owner!=null)try{send("POST","/api/auth/logout","{}");}catch(Exception ignored){}
        PROVIDERS.clear();
    }

    @Test void managerCanCreateCheckCloseAndSoftDisableNativeAccounts()throws Exception{
        var account=create("Muse session",NativePoolService.MUSE);
        var login=post("/api/pool/accounts/"+account.get("id")+"/login","{}");assertEquals(200,login.statusCode(),login.body());
        assertEquals("login_required",Json.read(login.body()).path("state").asString());
        var checked=post("/api/pool/accounts/"+account.get("id")+"/check","{}");assertEquals(200,checked.statusCode(),checked.body());
        assertEquals("ready",Json.read(checked.body()).path("state").asString());
        assertTrue(Json.read(checked.body()).path("capabilities").path("video").asBoolean());
        var closed=post("/api/pool/accounts/"+account.get("id")+"/close","{}");assertEquals("login_required",Json.read(closed.body()).path("state").asString());
        var disabled=client.send(request("DELETE","/api/pool/accounts/"+account.get("id"),null).header("X-Workbench-Request","1").build(),HttpResponse.BodyHandlers.ofString());
        assertEquals(200,disabled.statusCode(),disabled.body());assertFalse(Json.read(disabled.body()).path("ok").isMissingNode());
        assertEquals(0,jdbc.queryForObject("SELECT COUNT(*) FROM pool_account WHERE id=? AND enabled=TRUE",Integer.class,account.get("id")));
        assertTrue(bearerValid,"Every worker endpoint must use the configured bearer token");
    }

    @Test void importedLoopbackKeyIsEncryptedAndNeverReturnedToTheBrowser()throws Exception{
        assertTrue(cipher.ready());
        var response=post("/api/pool/accounts/import-local","{\"name\":\"Existing Muse service\"}");
        assertEquals(201,response.statusCode(),response.body());assertFalse(response.body().contains("legacy-key-never-return-this"));
        String id=Json.read(response.body()).path("id").asString();accounts.add(id);
        String encrypted=jdbc.queryForObject("SELECT encrypted_credential FROM pool_account WHERE id=?",String.class,id);
        assertNotEquals("legacy-key-never-return-this",encrypted);assertFalse(encrypted.contains("legacy-key-never-return-this"));
        assertEquals("legacy-key-never-return-this",cipher.decrypt(id,encrypted));
        var directory=get("/api/pool/accounts");assertEquals(200,directory.statusCode());assertFalse(directory.body().contains("legacy-key-never-return-this"));
        var models=Json.read(get("/api/bootstrap").body()).path("models");
        assertEquals("muse-service-image",models.path("image").get(2).path("id").asString());
        assertTrue(models.path("image").get(2).path("available").asBoolean());
        var project=send("POST","/api/projects","{\"title\":\"service-route-test\",\"document\":{}}");assertEquals(201,project.statusCode(),project.body());projectId=Json.read(project.body()).path("id").asString();
        var job=client.send(request("POST","/api/jobs",null).header("X-Workbench-Request","1").header("Content-Type","application/json").header("Idempotency-Key",UUID.randomUUID().toString())
            .POST(HttpRequest.BodyPublishers.ofString("{\"projectId\":\""+projectId+"\",\"nodeId\":\"service-node\",\"kind\":\"image\",\"prompt\":\"service route\",\"model\":\"muse-service-image\"}" )).build(),HttpResponse.BodyHandlers.ofString());
        assertEquals(202,job.statusCode(),job.body());jobId=Json.read(job.body()).path("id").asString();
        runner.execute(jobId);assertEquals("waiting_provider",Json.read(get("/api/jobs/"+jobId).body()).path("status").asString());
        jdbc.update("UPDATE generation_job SET next_run_at=CURRENT_TIMESTAMP(3) WHERE id=?",jobId);
        runner.execute(jobId);assertEquals("succeeded",Json.read(get("/api/jobs/"+jobId).body()).path("status").asString());
        assertEquals(1,legacySubmissions,"Polling a pinned service task must not submit it a second time");assertTrue(legacyBearerValid);
    }

    @Test void ordinaryGithubUsersManageOnlyTheirOwnAccountsIncludingFromRemoteAddresses()throws Exception{
        String localAccount=(String)create("Private local account",NativePoolService.MUSE).get("id");
        var principal=githubIdentity();var auth=UsernamePasswordAuthenticationToken.authenticated(principal,"",principal.getAuthorities());
        var remoteRequest=new MockHttpServletRequest();remoteRequest.setRemoteAddr("198.51.100.17");
        var created=controller.create(auth,remoteRequest,new PoolController.CreateAccount("My remote Muse",NativePoolService.MUSE));
        String id=(String)created.getBody().get("id");accounts.add(id);
        assertEquals(principal.user().id(),jdbc.queryForObject("SELECT owner_id FROM pool_account WHERE id=?",String.class,id));
        String cookie=signIn(principal);
        var directory=sendAs(cookie,"GET","/api/pool/accounts",null);
        assertEquals(200,directory.statusCode(),directory.body());assertEquals("personal",Json.read(directory.body()).path("scope").asString());
        assertFalse(Json.read(directory.body()).path("canImportLocal").asBoolean());
        assertEquals(1,Json.read(directory.body()).path("accounts").size());assertTrue(directory.body().contains(id));assertFalse(directory.body().contains(localAccount));
        for(String action:List.of("login","check","close"))assertEquals(404,sendAs(cookie,"POST","/api/pool/accounts/"+localAccount+"/"+action,"{}").statusCode());
        assertEquals(404,sendAs(cookie,"PATCH","/api/pool/accounts/"+localAccount,"{\"enabled\":false}").statusCode());
        assertEquals(404,sendAs(cookie,"DELETE","/api/pool/accounts/"+localAccount,null).statusCode());
        assertEquals(403,sendAs(cookie,"POST","/api/pool/accounts/import-local","{\"name\":\"forbidden\"}").statusCode());
        assertTrue(PROVIDERS.isEmpty(),"Another user's account must be rejected before any worker operation");
        assertEquals(200,sendAs(cookie,"PATCH","/api/pool/accounts/"+id,"{\"enabled\":false}").statusCode());
        assertEquals(200,sendAs(cookie,"GET","/api/pool/overview",null).statusCode());
        assertFalse(get("/api/pool/accounts").body().contains(id),"The local owner cannot see a GitHub user's personal account");
    }

    @Test void privateModelValidationAndPinnedLeasesCannotUseAnotherUsersNativeAccount(){
        String id=(String)create("Private ready Muse",NativePoolService.MUSE).get("id");
        jdbc.update("UPDATE pool_account SET state='ready',capability_image=TRUE,last_checked_at=CURRENT_TIMESTAMP(3) WHERE id=?",id);
        String other=githubIdentity().user().id();
        var request=new JobService.Request("project","node","image","private test","muse-image",1024,1024,5,List.of());
        assertEquals("MODEL_UNAVAILABLE",assertThrows(ApiException.class,()->pool.validate(other,request)).code);
        assertNull(pool.acquireForGeneration(other,NativePoolService.MUSE,60));
        assertThrows(ApiException.class,()->pool.acquirePinned(other,NativePoolService.MUSE,id,60));
        var otherModels=Json.read(Json.write(pool.modelSnapshot(other).models()));
        assertFalse(otherModels.path("image").get(0).path("available").asBoolean());
        assertFalse(Json.write(pool.modelSnapshot(null).models()).contains("\"available\":true"));
        assertTrue(PROVIDERS.isEmpty());
    }

    @Test void sharedServiceAllowsGenerationWithoutRevealingOrGrantingManagement()throws Exception{
        var imported=post("/api/pool/accounts/import-local","{\"name\":\"Shared fixture service\"}");
        assertEquals(201,imported.statusCode(),imported.body());String id=Json.read(imported.body()).path("id").asString();accounts.add(id);
        assertFalse(Json.read(imported.body()).path("shared").asBoolean());
        var otherPrincipal=githubIdentity();String other=otherPrincipal.user().id();String cookie=signIn(otherPrincipal);
        assertThrows(ApiException.class,()->pool.acquirePinnedService(other,id,60));
        var shared=send("PATCH","/api/pool/accounts/"+id,"{\"shared\":true}");assertEquals(200,shared.statusCode(),shared.body());assertTrue(Json.read(shared.body()).path("shared").asBoolean());
        var directory=sendAs(cookie,"GET","/api/pool/accounts",null);assertEquals(200,directory.statusCode(),directory.body());
        assertFalse(directory.body().contains(id));assertFalse(directory.body().contains(owner));assertFalse(directory.body().contains("Shared fixture service"));assertFalse(directory.body().contains("legacy-key-never-return-this"));
        assertTrue(Json.read(directory.body()).path("sharedChannels").path("muse").path("available").asInt()>=1);
        var request=new JobService.Request("project","node","image","shared test","muse-service-image",1024,1024,5,List.of());
        assertDoesNotThrow(()->pool.validate(other,request));
        assertTrue(Json.read(sendAs(cookie,"GET","/api/bootstrap",null).body()).path("models").path("image").get(2).path("available").asBoolean());
        try(var lease=pool.acquirePinnedService(other,id,60)){
            assertNotNull(lease);assertEquals("legacy-key-never-return-this",pool.decryptCredential(lease));
            var occupied=Json.read(sendAs(cookie,"GET","/api/pool/accounts",null).body()).path("sharedChannels").path("muse");assertTrue(occupied.path("busy").asInt()>=1);
        }
        projectId=(String)store.createProject(other,"Shared service output fixture",Json.read("{}")).get("id");
        var generation=new JobService.Request(projectId,"shared-node","image","shared generation fixture","muse-service-image",1024,1024,5,List.of());
        jobId=(String)jobs.submit(other,UUID.randomUUID().toString(),generation).get("id");
        runner.execute(jobId);assertEquals("waiting_provider",jobs.job(other,jobId).get("status"));
        assertEquals(id,jdbc.queryForObject("SELECT provider_account_id FROM generation_job WHERE id=?",String.class,jobId));
        jdbc.update("UPDATE generation_job SET next_run_at=CURRENT_TIMESTAMP(3) WHERE id=?",jobId);
        runner.execute(jobId);assertEquals("succeeded",jobs.job(other,jobId).get("status"));
        assertEquals(other,jdbc.queryForObject("SELECT owner_id FROM asset WHERE source_job_id=?",String.class,jobId));
        assertEquals(1,legacySubmissions,"A shared route remains pinned and does not submit twice");
        assertEquals(404,sendAs(cookie,"PATCH","/api/pool/accounts/"+id,"{\"shared\":false,\"enabled\":false}").statusCode());
        assertEquals(200,send("PATCH","/api/pool/accounts/"+id,"{\"shared\":false}").statusCode());
        assertThrows(ApiException.class,()->pool.acquirePinnedService(other,id,60),"Revoking sharing also prevents a foreign pinned task from using it again");
        String nativeId=(String)create("Cannot share native",NativePoolService.MUSE).get("id");assertEquals(400,send("PATCH","/api/pool/accounts/"+nativeId,"{\"shared\":true}").statusCode());
    }

    @Test void sharedQuotaIsAnonymousRefreshableAndDoesNotGrantPrivateAccountManagement()throws Exception{
        var imported=post("/api/pool/accounts/import-local","{\"name\":\"Private quota fixture\"}");
        assertEquals(201,imported.statusCode(),imported.body());String id=Json.read(imported.body()).path("id").asString();accounts.add(id);
        var personalQuota=Json.read(imported.body()).path("quota").path("accounts").get(0);
        assertEquals(25d,personalQuota.path("weeklyUsedPercent").asDouble());
        assertEquals(75d,personalQuota.path("weeklyRemainingPercent").asDouble());
        assertTrue(personalQuota.path("plan").isNull());
        var visitor=githubIdentity();String cookie=signIn(visitor);
        assertEquals(404,sendAs(cookie,"POST","/api/pool/accounts/"+id+"/quota","{}").statusCode());
        assertEquals(200,send("PATCH","/api/pool/accounts/"+id,"{\"shared\":true}").statusCode());
        var refreshed=sendAs(cookie,"POST","/api/pool/quota/refresh","{}");assertEquals(200,refreshed.statusCode(),refreshed.body());
        assertEquals("no-store",refreshed.headers().firstValue("Cache-Control").orElse(""));
        var snapshot=Json.read(refreshed.body());
        assertTrue(snapshot.path("accounts").isArray());assertEquals(0,snapshot.path("accounts").size());
        assertEquals(75d,snapshot.path("sharedChannels").path("muse").path("quota").path("accounts").get(0).path("weeklyRemainingPercent").asDouble());
        assertEquals(1,quotaChecks);assertEquals(0,legacySubmissions,"Quota reads must never create a generation");
        for(String secret:List.of(id,owner,"Private quota fixture","supplier-private-id","private-email","private-settings","legacy-key-never-return-this"))assertFalse(refreshed.body().contains(secret),secret);
        assertEquals(200,send("PATCH","/api/pool/accounts/"+id,"{\"shared\":false}").statusCode());
        var hidden=sendAs(cookie,"GET","/api/pool/accounts",null);
        assertEquals(0,Json.read(hidden.body()).path("sharedChannels").path("muse").path("quota").path("accounts").size());
    }

    @Test void accountAvailabilityExcludesBusyStaleDisabledAndUnsupportedRoutes(){
        String ready=(String)create("Ready Muse",NativePoolService.MUSE).get("id");
        String busy=(String)create("Busy Muse",NativePoolService.MUSE).get("id");
        String stale=(String)create("Stale Muse",NativePoolService.MUSE).get("id");
        String disabled=(String)create("Disabled Muse",NativePoolService.MUSE).get("id");
        String doubao=(String)create("Checked Doubao",NativePoolService.DOUBAO).get("id");
        for(String id:List.of(ready,busy,stale,disabled,doubao))
            jdbc.update("UPDATE pool_account SET state='ready',capability_image=TRUE,capability_video=TRUE,last_checked_at=CURRENT_TIMESTAMP(3) WHERE id=?",id);
        jdbc.update("UPDATE pool_account SET lease_token=?,lease_until=TIMESTAMPADD(MINUTE,1,CURRENT_TIMESTAMP(3)) WHERE id=?",UUID.randomUUID().toString(),busy);
        jdbc.update("UPDATE pool_account SET last_checked_at=TIMESTAMPADD(MINUTE,-11,CURRENT_TIMESTAMP(3)) WHERE id=?",stale);
        jdbc.update("UPDATE pool_account SET enabled=FALSE WHERE id=?",disabled);

        var response=get("/api/pool/accounts");assertEquals(200,response.statusCode(),response.body());
        var rows=Json.read(response.body()).path("accounts");
        for(var row:rows){
            String id=row.path("id").asString();
            if(ready.equals(id)){assertTrue(row.path("schedulable").asBoolean());assertTrue(row.path("fresh").asBoolean());}
            if(List.of(busy,stale,disabled,doubao).contains(id))assertFalse(row.path("schedulable").asBoolean(),id);
            if(busy.equals(id))assertTrue(row.path("busy").asBoolean());
            if(stale.equals(id))assertFalse(row.path("fresh").asBoolean());
        }
        int museAvailable=0,doubaoAvailable=0;
        for(var row:rows)if(row.path("schedulable").asBoolean()){
            if("muse".equals(row.path("provider").asString()))museAvailable++;
            if("doubao".equals(row.path("provider").asString()))doubaoAvailable++;
        }
        var overview=Json.read(get("/api/pool/overview").body());
        assertEquals(museAvailable,overview.path("accounts").path("available").asInt());
        assertEquals(doubaoAvailable,overview.path("doubao").path("available").asInt());
    }

    @Test void anUndecryptableServiceCredentialIsNeverAdvertisedAsAvailable(){
        String id=UUID.randomUUID().toString();accounts.add(id);
        jdbc.update("INSERT INTO pool_account(id,owner_id,name,type,provider,enabled,state,capability_image,capability_video,encrypted_credential,last_checked_at) VALUES(?,?,'Unreadable service',?,'muse',TRUE,'ready',TRUE,TRUE,'invalid-ciphertext',CURRENT_TIMESTAMP(3))",id,owner,NativePoolService.MUSE_SERVICE);
        var response=get("/api/pool/accounts");assertEquals(200,response.statusCode(),response.body());
        boolean found=false;
        for(var row:Json.read(response.body()).path("accounts"))if(id.equals(row.path("id").asString())){
            found=true;assertFalse(row.path("schedulable").asBoolean());
        }
        assertTrue(found);
        assertFalse(response.body().contains("invalid-ciphertext"));
    }

    @Test void rejectedPollForPinnedServiceTaskIsMarkedUnknownExternal()throws Exception{
        var imported=post("/api/pool/accounts/import-local","{\"name\":\"Service polling test\"}");
        assertEquals(201,imported.statusCode(),imported.body());accounts.add(Json.read(imported.body()).path("id").asString());
        var project=send("POST","/api/projects","{\"title\":\"service-poll-rejection\",\"document\":{}}");
        assertEquals(201,project.statusCode(),project.body());projectId=Json.read(project.body()).path("id").asString();
        var job=client.send(request("POST","/api/jobs",null).header("X-Workbench-Request","1").header("Content-Type","application/json").header("Idempotency-Key",UUID.randomUUID().toString())
            .POST(HttpRequest.BodyPublishers.ofString("{\"projectId\":\""+projectId+"\",\"nodeId\":\"service-node\",\"kind\":\"image\",\"prompt\":\"service route\",\"model\":\"muse-service-image\"}" )).build(),HttpResponse.BodyHandlers.ofString());
        assertEquals(202,job.statusCode(),job.body());jobId=Json.read(job.body()).path("id").asString();
        runner.execute(jobId);
        assertEquals("waiting_provider",Json.read(get("/api/jobs/"+jobId).body()).path("status").asString());
        jdbc.update("UPDATE generation_job SET next_run_at=CURRENT_TIMESTAMP(3) WHERE id=?",jobId);
        rejectServicePolling=true;
        runner.execute(jobId);
        assertEquals("unknown_external",Json.read(get("/api/jobs/"+jobId).body()).path("status").asString());
        assertEquals(1,legacySubmissions,"A rejected poll must not resubmit the pinned generation");
        assertTrue(Json.read(get("/api/jobs/"+jobId).body()).path("canRecover").asBoolean());
        var other=githubIdentity();String cookie=signIn(other);
        assertEquals(404,sendAs(cookie,"POST","/api/jobs/"+jobId+"/recover","{}").statusCode(),"Another owner cannot query this upstream task");
        rejectServicePolling=false;
        jdbc.update("UPDATE generation_job SET created_at=TIMESTAMPADD(DAY,-3,CURRENT_TIMESTAMP(3)) WHERE id=?",jobId);
        var recovered=post("/api/jobs/"+jobId+"/recover","{}");assertEquals(200,recovered.statusCode(),recovered.body());
        var recoveredBody=Json.read(recovered.body());assertEquals("succeeded",recoveredBody.path("status").asString(),recovered.body());
        assertEquals("completed",recoveredBody.path("recoveryStatus").asString());assertFalse(recoveredBody.path("generationResubmitted").asBoolean());
        assertEquals(1,legacySubmissions,"Recovery must only poll/download the original task");
        assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM asset WHERE source_job_id=?",Integer.class,jobId));
        assertEquals(200,post("/api/jobs/"+jobId+"/recover","{}").statusCode());
        assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM asset WHERE source_job_id=?",Integer.class,jobId),"Repeated recovery is idempotent");
    }

    @Test void nativeGenerationUsesAnExclusiveRedisAndMysqlLeaseAndPersistsMedia()throws Exception{
        var account=create("Muse generation",NativePoolService.MUSE);
        assertEquals(200,post("/api/pool/accounts/"+account.get("id")+"/login","{}").statusCode());
        assertEquals("ready",Json.read(post("/api/pool/accounts/"+account.get("id")+"/check","{}").body()).path("state").asString());
        try(var lease=pool.acquireForGeneration(owner,NativePoolService.MUSE,60)){
            assertNotNull(lease);assertNull(pool.acquireForGeneration(owner,NativePoolService.MUSE,60),"Redis SET NX plus the MySQL lease must block a second worker");
        }
        var project=send("POST","/api/projects","{\"title\":\"native-pool-test\",\"document\":{}}");assertEquals(201,project.statusCode(),project.body());projectId=Json.read(project.body()).path("id").asString();
        var uploaded=assets.upload(owner,projectId,new MockMultipartFile("file","ref.png","image/png",PNG_BYTES));
        String refId=(String)uploaded.get("id");
        var job=client.send(request("POST","/api/jobs",null).header("X-Workbench-Request","1").header("Content-Type","application/json").header("Idempotency-Key",UUID.randomUUID().toString())
            .POST(HttpRequest.BodyPublishers.ofString("{\"projectId\":\""+projectId+"\",\"nodeId\":\"n1\",\"kind\":\"image\",\"prompt\":\"test prompt\",\"model\":\"muse-image\",\"referenceAssetIds\":[\""+refId+"\"]}" )).build(),HttpResponse.BodyHandlers.ofString());
        assertEquals(202,job.statusCode(),job.body());jobId=Json.read(job.body()).path("id").asString();
        runner.execute(jobId);
        var result=get("/api/jobs/"+jobId);assertEquals("succeeded",Json.read(result.body()).path("status").asString(),result.body());
        assertTrue(lastGenerateBody.contains("\"provider\":\"muse\""));assertTrue(lastGenerateBody.contains("\"model\":\"muse-image\""));
        assertTrue(lastGenerateBody.contains("\"referenceImages\":[\"data:image/png;base64,"));
        assertTrue(bearerValid);String assetId=Json.read(result.body()).path("resultAssetId").asString();
        assertEquals(200,get("/api/assets/"+assetId+"/content").statusCode());
    }

    @Test void queuedGenerationWaitsForBusyAccountWithoutCallingUpstreamThenCompletes(){
        var fixture=isolatedNativeJob();String requester=fixture.get("owner"),account=fixture.get("account");
        try(var occupied=pool.acquirePinned(requester,NativePoolService.MUSE,account,60)){
            runner.execute(jobId);
            assertEquals("queued",jobs.job(requester,jobId).get("status"));
            assertNull(jdbc.queryForObject("SELECT provider_route FROM generation_job WHERE id=?",String.class,jobId));
            assertNull(jdbc.queryForObject("SELECT provider_task_id FROM generation_job WHERE id=?",String.class,jobId));
            assertNull(jdbc.queryForObject("SELECT lease_token FROM generation_job WHERE id=?",String.class,jobId));
            assertEquals("",lastGenerateBody,"Waiting for a slot must never submit a paid generation");
        }
        jdbc.update("UPDATE generation_job SET next_run_at=CURRENT_TIMESTAMP(3) WHERE id=?",jobId);
        runner.execute(jobId);
        assertEquals("succeeded",jobs.job(requester,jobId).get("status"));
        assertFalse(lastGenerateBody.isBlank());
        assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM asset WHERE source_job_id=?",Integer.class,jobId));
    }

    @Test void queuedGenerationStillFailsWhenAccountReallyNeedsLogin(){
        var fixture=isolatedNativeJob();String requester=fixture.get("owner"),account=fixture.get("account");
        jdbc.update("UPDATE pool_account SET state='login_required' WHERE id=?",account);
        runner.execute(jobId);
        assertEquals("failed",jobs.job(requester,jobId).get("status"));
        assertEquals("",lastGenerateBody,"An unready account must not be submitted or endlessly retried");
        assertNull(jdbc.queryForObject("SELECT provider_route FROM generation_job WHERE id=?",String.class,jobId));
    }

    private Map<String,String> isolatedNativeJob(){
        String requester=githubIdentity().user().id(),account=(String)create("Queue contention fixture",NativePoolService.MUSE).get("id");
        jdbc.update("UPDATE pool_account SET owner_id=? WHERE id=?",requester,account);
        pool.login(requester,account);pool.check(requester,account);
        projectId=(String)store.createProject(requester,"Pool queue fixture",Json.read("{}")).get("id");
        var request=new JobService.Request(projectId,"queued-image","image","queue fixture","muse-image",1024,1024,5,List.of());
        jobId=(String)jobs.submit(requester,UUID.randomUUID().toString(),request).get("id");
        return Map.of("owner",requester,"account",account);
    }

    private Map<String,Object> create(String name,String type){var response=post("/api/pool/accounts","{\"name\":\""+name+"\",\"type\":\""+type+"\"}");assertEquals(201,response.statusCode(),response.body());var value=Json.read(response.body()).path("id").asString();accounts.add(value);return Map.of("id",value);}
    private HttpRequest.Builder request(String method,String path,String body){return HttpRequest.newBuilder(URI.create(base()+path)).header("Origin","http://localhost:5178").method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body));}
    private HttpResponse<String> send(String method,String path,String body)throws Exception{var req=request(method,path,body);if(!method.equals("GET"))req.header("X-Workbench-Request","1").header("Content-Type","application/json");return client.send(req.build(),HttpResponse.BodyHandlers.ofString());}
    private HttpResponse<String> get(String path){try{return send("GET",path,null);}catch(Exception e){throw new IllegalStateException(e);}}
    private HttpResponse<String> post(String path,String body){try{return send("POST",path,body);}catch(Exception e){throw new IllegalStateException(e);}}
    private String base(){return "http://127.0.0.1:"+environment.getRequiredProperty("local.server.port");}

    private UserService.GithubPrincipal githubIdentity(){
        String external=Long.toString(java.util.concurrent.ThreadLocalRandom.current().nextLong(1_000_000_000_000_000L,9_000_000_000_000_000L));
        var principal=users.githubUser(Map.of("id",external,"login","pool-isolation-fixture"));otherOwners.add(principal.user().id());return principal;
    }
    private String signIn(UserService.GithubPrincipal principal){return saveSession(sessions,principal);}
    private <S extends Session> String saveSession(SessionRepository<S> repository,UserService.GithubPrincipal principal){
        var context=SecurityContextHolder.createEmptyContext();context.setAuthentication(new OAuth2AuthenticationToken(principal,principal.getAuthorities(),"github"));
        S session=repository.createSession();session.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY,context);repository.save(session);sessionIds.add(session.getId());
        return "WORKBENCH_SESSION="+Base64.getEncoder().encodeToString(session.getId().getBytes(StandardCharsets.UTF_8));
    }
    private HttpResponse<String> sendAs(String cookie,String method,String path,String body)throws Exception{
        var req=request(method,path,body).header("Cookie",cookie);if(!method.equals("GET"))req.header("X-Workbench-Request","1").header("Content-Type","application/json");
        return HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build().send(req.build(),HttpResponse.BodyHandlers.ofString());
    }

    private static HttpServer server(){try{return HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);}catch(IOException ex){throw new ExceptionInInitializerError(ex);}}
    private static void workerRoute(HttpExchange exchange)throws IOException{
        auth(exchange);String path=exchange.getRequestURI().getPath();String[] parts=path.split("/");String id=parts.length>2?parts[2]:"";
        if(path.endsWith("/login")){var body=Json.read(new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8));PROVIDERS.put(id,body.path("provider").asString());respond(exchange,200,status("login_required",PROVIDERS.get(id)));return;}
        if(path.endsWith("/status")){String provider=PROVIDERS.get(id);respond(exchange,200,status(provider==null?"login_required":"ready",provider));return;}
        if(path.endsWith("/close")){PROVIDERS.remove(id);respond(exchange,200,"{\"closed\":true}");return;}
        if(path.endsWith("/generate")){lastGenerateBody=new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8);respond(exchange,200,"{\"base64\":\""+PNG+"\",\"mimeType\":\"image/png\"}");return;}
        if(exchange.getRequestMethod().equals("DELETE")){PROVIDERS.remove(id);respond(exchange,200,"{\"deleted\":true}");return;}
        respond(exchange,404,"{\"code\":\"NOT_FOUND\",\"message\":\"not found\",\"submissionUncertain\":false}");
    }
    private static void legacyImageRoute(HttpExchange exchange)throws IOException{
        String authorization=exchange.getRequestHeaders().getFirst("Authorization");
        if(!"Bearer legacy-key-never-return-this".equals(authorization))legacyBearerValid=false;
        if("POST".equals(exchange.getRequestMethod())){
            legacySubmissions++;exchange.getRequestBody().readAllBytes();respond(exchange,200,"{\"data\":{\"task_id\":\"service-task\",\"status\":\"processing\"}}");return;
        }
        if(exchange.getRequestURI().getPath().endsWith("/service-task")){
            if(rejectServicePolling){respond(exchange,401,"{\"error\":\"invalid key\"}");return;}
            respond(exchange,200,"{\"data\":{\"task_id\":\"service-task\",\"status\":\"completed\",\"b64_json\":\""+PNG+"\"}}");return;
        }
        respond(exchange,404,"{}");
    }
    private static String status(String state,String provider){boolean muse="muse".equals(provider);return "{\"state\":\""+state+"\",\"message\":\"test\",\"capabilities\":{\"image\":"+muse+",\"video\":"+muse+"}}";}
    private static void auth(HttpExchange exchange){String value=exchange.getRequestHeaders().getFirst("Authorization");if(value==null||!TOKEN.equals(value.replaceFirst("^Bearer ","")))bearerValid=false;}
    private static void respond(HttpExchange exchange,int status,String body)throws IOException{byte[] bytes=body.getBytes(StandardCharsets.UTF_8);exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(status,bytes.length);try(var output=exchange.getResponseBody()){output.write(bytes);}}
}
