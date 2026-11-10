package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.nio.file.Path;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.transaction.support.TransactionTemplate;

@EnabledIfEnvironmentVariable(named="DB_PASSWORD",matches=".+")
class ChannelPersistenceTest {
    @TempDir Path storage;
    private JdbcTemplate jdbc;private TransactionTemplate tx;private ChannelService channels;private CredentialCipher cipher;
    private WorkbenchStore store;private AppSettings settings;private JobService jobs;private NativePoolService pool;
    private String owner;private String other;
    private static final String SECRET="channel-secret-never-returned";
    private static final String MASTER=Base64.getEncoder().encodeToString("0123456789abcdef0123456789abcdef".getBytes(java.nio.charset.StandardCharsets.UTF_8));
    private static final byte[] PNG=Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=");
    @BeforeEach void setup(){
        String url=System.getenv().getOrDefault("DB_URL","jdbc:mysql://"+System.getenv().getOrDefault("DB_HOST","127.0.0.1")+":"+System.getenv().getOrDefault("DB_PORT","3308")+"/"+System.getenv().getOrDefault("DB_NAME","workbench")+"?serverTimezone=UTC");url+=(url.contains("?")?"&":"?")+"connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true";
        var ds=new DriverManagerDataSource(url,System.getenv().getOrDefault("DB_USERNAME","workbench"),System.getenv("DB_PASSWORD"));Flyway.configure().dataSource(ds).callbacks(new DatabaseCollationCompatibility()).load().migrate();jdbc=new JdbcTemplate(ds);tx=new TransactionTemplate(new DataSourceTransactionManager(ds));
        var env=new MockEnvironment().withProperty("app.pool-credential-master-key",MASTER).withProperty("app.storage-root",storage.toString());env.setActiveProfiles("dev");settings=new AppSettings(env);cipher=new CredentialCipher(settings);channels=new ChannelService(jdbc,cipher);pool=mock(NativePoolService.class);
        store=new WorkbenchStore(jdbc,tx,mock(RedisSupport.class),settings);jobs=new JobService(store,settings,jdbc,tx,mock(MuseProvider.class),pool,channels);
        owner=UUID.randomUUID().toString();other=UUID.randomUUID().toString();for(String id:List.of(owner,other))jdbc.update("INSERT INTO app_user(id,provider,external_id,display_name) VALUES(?,'test',?,'channel test')",id,id);
    }
    @AfterEach void cleanup(){
        if(jdbc==null||owner==null)return;for(String id:List.of(owner,other)){
            jdbc.update("DELETE FROM generation_job WHERE owner_id=?",id);jdbc.update("DELETE FROM asset WHERE owner_id=?",id);jdbc.update("DELETE r FROM project_revision r JOIN project p ON p.id=r.project_id WHERE p.owner_id=?",id);jdbc.update("DELETE FROM project WHERE owner_id=?",id);jdbc.update("DELETE FROM user_generation_channel WHERE owner_id=?",id);jdbc.update("DELETE FROM app_user WHERE id=?",id);
        }
    }
    private ChannelService.Input input(String id,String key){return new ChannelService.Input(id,"我的渠道","https://provider.example/v1","openai",true,key,List.of(new ChannelService.Model("gpt-image-1","image"),new ChannelService.Model("sora-2","video")));}
    private String create(){return (String)tx.execute(s->channels.save(owner,input(null,SECRET))).get("id");}
    private String project(){return (String)store.createProject(owner,"channel test",Json.read("{}")).get("id");}
    private JobService.Request request(String project,String channel,String kind){return new JobService.Request(project,"node",kind,"sunlight","channel:"+channel+":"+(kind.equals("image")?"gpt-image-1":"sora-2"),1024,1024,8,List.of());}
    private JobRunner runner(ChannelClient client){return new JobRunner(store,settings,mock(MuseClient.class),new AssetService(settings,store),jdbc,tx,mock(MuseProvider.class),pool,mock(BrowserWorkerClient.class),channels,client);}
    @Test void credentialsAreEncryptedRedactedAndBoundToChannelAndOwner(){
        String id=create();var channel=channels.require(owner,id);String ciphertext=jdbc.queryForObject("SELECT encrypted_key FROM user_generation_channel WHERE id=?",String.class,id);
        assertTrue(ciphertext.startsWith("v1:"));assertFalse(ciphertext.contains(SECRET));assertEquals(SECRET,channels.key(channel));assertThrows(IllegalStateException.class,()->cipher.decrypt("channel:another-id",ciphertext));
        String publicJson=Json.write(channels.list(owner));assertFalse(publicJson.contains(SECRET));assertFalse(publicJson.contains(ciphertext));assertFalse(publicJson.contains("encryptedKey"));assertTrue(publicJson.contains("hasKey"));
        assertTrue(channels.list(other).isEmpty());assertThrows(ApiException.class,()->channels.require(other,id));assertThrows(ApiException.class,()->tx.execute(s->channels.save(other,input(id,"attacker-key"))));assertThrows(ApiException.class,()->channels.delete(other,id));
        tx.execute(s->channels.save(owner,input(id,"")));assertEquals(ciphertext,channels.require(owner,id).encryptedKey());
        assertThrows(ApiException.class,()->tx.execute(s->channels.save(owner,new ChannelService.Input(id,"changed","https://different.example/v1","openai",true,"",input(id,"").models()))));
    }
    @Test void catalogOnlyIncludesOwnModelsAndDisabledChannelCannotSubmit(){
        String id=create();var nativeModels=Map.<String,Object>of("image",List.of(),"video",List.of());assertFalse(Json.write(channels.mergeModels(owner,nativeModels)).contains(SECRET));assertTrue(Json.write(channels.mergeModels(other,nativeModels)).contains("\"image\":[]"));
        var old=channels.require(owner,id);tx.execute(s->channels.save(owner,new ChannelService.Input(id,old.name(),old.baseUrl(),"openai",false,"",old.models())));
        assertTrue(Json.write(channels.mergeModels(owner,nativeModels)).contains("\"available\":false"));assertThrows(ApiException.class,()->channels.validate(owner,request("p",id,"image")));
    }
    @Test void textModelsAreOwnedAndKeptOutOfCanvasGenerationCatalog(){
        var saved=tx.execute(s->channels.save(owner,new ChannelService.Input(null,"剪辑渠道","https://provider.example/v1","openai",true,SECRET,List.of(new ChannelService.Model("gpt-4.1","text"),new ChannelService.Model("gpt-image-1","image")))));
        String id=(String)saved.get("id");String model="channel:"+id+":gpt-4.1";
        var text=channels.textModels(owner);assertEquals(1,text.size());assertEquals(model,text.getFirst().get("id"));assertEquals(true,text.getFirst().get("available"));assertTrue(channels.textModels(other).isEmpty());
        var catalog=channels.mergeModels(owner,Map.of("image",List.of(),"video",List.of()));
        assertFalse(Json.write(catalog).contains("gpt-4.1"));assertTrue(Json.write(catalog).contains("gpt-image-1"));
        assertFalse(Json.write(text).contains(SECRET));assertThrows(ApiException.class,()->channels.validate(owner,new JobService.Request("p","n","image","prompt",model,1024,1024,5,List.of())));
        var old=channels.require(owner,id);tx.execute(s->channels.save(owner,new ChannelService.Input(id,old.name(),old.baseUrl(),"openai",false,"",old.models())));
        assertEquals(false,channels.textModels(owner).getFirst().get("available"));assertThrows(ApiException.class,()->channels.route(owner,model));
    }
    @Test void submissionPinsChannelAndRejectsReferencesAndCrossUserRoutes(){
        // Keep test jobs invisible to a concurrently running local API scheduler until this test has finished them.
        isolated(()->{
        String id=create();String project=project();var request=request(project,id,"image");var submitted=jobs.submit(owner,"channel-queue",request);String jobId=(String)submitted.get("id");
        assertEquals(ChannelService.fingerprint(channels.require(owner,id)),jdbc.queryForObject("SELECT provider_route FROM generation_job WHERE id=?",String.class,jobId));assertEquals(id,jdbc.queryForObject("SELECT provider_account_id FROM generation_job WHERE id=?",String.class,jobId));assertFalse(submitted.containsKey("providerRoute"));
        assertEquals(jobId,jobs.submit(owner,"channel-queue",request).get("id"));verifyNoInteractions(pool);
        assertThrows(ApiException.class,()->channels.validate(other,request));assertThrows(ApiException.class,()->jobs.submit(owner,"reference",new JobService.Request(project,"n","image","prompt",request.model(),1024,1024,5,List.of("not-loaded"))));
        tx.execute(s->channels.save(owner,input(id,"rotated-key")));var client=mock(ChannelClient.class);try(var testRunner=new RunnerClose(runner(client))){testRunner.value.execute(jobId);}assertEquals("failed",jobs.job(owner,jobId).get("status"));verifyNoInteractions(client);
        });
    }
    @Test void completedImageAddsAssetWithoutOverwritingNewerCanvasAndCancellationDoesNotPublish()throws Exception {
        isolated(()->{
        String id=create();String project=project();var submitted=jobs.submit(owner,"generated",request(project,id,"image"));String jobId=(String)submitted.get("id");store.saveProject(owner,project,1,"new edit",Json.read("{\"nodes\":[{\"id\":\"manual\"}]}"));
        var client=mock(ChannelClient.class);var outcome=new MuseClient.Outcome(null,"completed",null,"fixture",null);when(client.submit(eq(jobId),any(),any())).thenReturn(outcome);when(client.download(any(),eq(outcome),eq("image"))).thenReturn(new MuseClient.Media(PNG,"image/png"));
        try(var testRunner=new RunnerClose(runner(client))){testRunner.value.execute(jobId);}assertEquals("succeeded",jobs.job(owner,jobId).get("status"));assertNotNull(jobs.job(owner,jobId).get("resultAssetId"));assertEquals("new edit",store.project(owner,project).get("title"));
        String cancelled=(String)jobs.submit(owner,"cancelled",request(project,id,"image")).get("id");when(client.submit(eq(cancelled),any(),any())).thenReturn(outcome);when(client.download(any(),eq(outcome),eq("image"))).thenAnswer(call->{jobs.cancel(owner,cancelled);return new MuseClient.Media(PNG,"image/png");});
        try(var testRunner=new RunnerClose(runner(client))){testRunner.value.execute(cancelled);}assertEquals("cancelled",jobs.job(owner,cancelled).get("status"));assertNull(jobs.job(owner,cancelled).get("resultAssetId"));
        });
    }
    @Test void videoPollingNeverReplaysSubmissionAndCredentialChangeStopsOldTask()throws Exception {
        isolated(()->{
        String id=create();String project=project();String jobId=(String)jobs.submit(owner,"video",request(project,id,"video")).get("id");var client=mock(ChannelClient.class);
        when(client.submit(eq(jobId),any(),any())).thenReturn(new MuseClient.Outcome("video_123","queued",null,null,null));when(client.poll(any(),eq("video"),eq("video_123"))).thenReturn(new MuseClient.Outcome("video_123","running",null,null,null));
        try(var testRunner=new RunnerClose(runner(client))){testRunner.value.execute(jobId);assertEquals("waiting_provider",jobs.job(owner,jobId).get("status"));jdbc.update("UPDATE generation_job SET next_run_at=CURRENT_TIMESTAMP(3) WHERE id=?",jobId);testRunner.value.execute(jobId);verify(client,times(1)).submit(eq(jobId),any(),any());verify(client,times(1)).poll(any(),eq("video"),eq("video_123"));
            tx.execute(s->channels.save(owner,input(id,"new-key")));jdbc.update("UPDATE generation_job SET next_run_at=CURRENT_TIMESTAMP(3) WHERE id=?",jobId);testRunner.value.execute(jobId);
        }
        assertEquals("unknown_external",jobs.job(owner,jobId).get("status"));verify(client,times(1)).poll(any(),eq("video"),eq("video_123"));
        });
    }
    @FunctionalInterface private interface TestWork {void run()throws Exception;}
    private void isolated(TestWork work){tx.executeWithoutResult(status->{try{work.run();}catch(RuntimeException error){throw error;}catch(Exception error){throw new AssertionError(error);}});}
    private static class RunnerClose implements AutoCloseable {final JobRunner value;RunnerClose(JobRunner value){this.value=value;}public void close(){value.close();}}
}
