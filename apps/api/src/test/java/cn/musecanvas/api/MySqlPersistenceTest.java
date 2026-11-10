package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.transaction.support.TransactionTemplate;

@EnabledIfEnvironmentVariable(named="DB_PASSWORD",matches=".+")
class MySqlPersistenceTest {
    @TempDir Path storage;
    private JdbcTemplate jdbc;private WorkbenchStore store;private AppSettings settings;private JobService jobs;private String owner;private TransactionTemplate transactions;private MuseProvider provider;
    @BeforeEach void setup(){
        String url=System.getenv().getOrDefault("DB_URL","jdbc:mysql://"+System.getenv().getOrDefault("DB_HOST","127.0.0.1")+":"+System.getenv().getOrDefault("DB_PORT","3308")+"/"+System.getenv().getOrDefault("DB_NAME","workbench")+"?serverTimezone=UTC");
        url+=(url.contains("?")?"&":"?")+"connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true";
        var ds=new DriverManagerDataSource(url,System.getenv().getOrDefault("DB_USERNAME","workbench"),System.getenv("DB_PASSWORD"));
        Flyway.configure().dataSource(ds).callbacks(new DatabaseCollationCompatibility()).load().migrate();jdbc=new JdbcTemplate(ds);
        var env=new MockEnvironment().withProperty("app.muse-api-key","test-key-never-sent").withProperty("app.storage-root",storage.toString());env.setActiveProfiles("dev");settings=new AppSettings(env);
        provider=mock(MuseProvider.class);when(provider.enabled()).thenReturn(true);transactions=new TransactionTemplate(new DataSourceTransactionManager(ds));store=new WorkbenchStore(jdbc,transactions,mock(RedisSupport.class),settings);jobs=new JobService(store,settings,jdbc,transactions,provider);
        owner=UUID.randomUUID().toString();jdbc.update("INSERT INTO app_user(id,provider,external_id,display_name) VALUES(?,'test',?,'test')",owner,owner);
    }
    @AfterEach void cleanup(){
        if(jdbc==null||owner==null)return;
        jdbc.update("DELETE FROM generation_job WHERE owner_id=?",owner);jdbc.update("DELETE FROM asset WHERE owner_id=?",owner);
        jdbc.update("DELETE r FROM project_revision r JOIN project p ON p.id=r.project_id WHERE p.owner_id=?",owner);jdbc.update("DELETE FROM project WHERE owner_id=?",owner);jdbc.update("DELETE FROM app_user WHERE id=?",owner);
    }
    @Test void staleSaveCannotOverwriteAndEachRevisionIsRetained(){
        var project=store.createProject(owner,"A",Json.read("{\"nodes\":[]}"));String id=(String)project.get("id");
        var saved=store.saveProject(owner,id,1,"B",Json.read("{\"nodes\":[{\"id\":\"new\"}]}"));assertEquals(2L,saved.get("revision"));
        var conflict=assertThrows(ApiException.class,()->store.saveProject(owner,id,1,"stale",Json.read("{}")));assertEquals("REVISION_CONFLICT",conflict.code);
        assertEquals("B",store.project(owner,id).get("title"));assertEquals(2,jdbc.queryForObject("SELECT COUNT(*) FROM project_revision WHERE project_id=?",Integer.class,id));
        assertThrows(ApiException.class,()->store.project("another-user",id));
    }
    @Test void idempotencyIsDurableAndRejectsDifferentRequests(){
        String project=(String)store.createProject(owner,"A",Json.read("{}")).get("id");var request=new JobService.Request(project,"node","image","sunlight",null,null,null,null,List.of());
        var first=jobs.submit(owner,"key-1",request);var second=jobs.submit(owner,"key-1",request);assertEquals(first.get("id"),second.get("id"));assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM generation_job WHERE owner_id=?",Integer.class,owner));
        var conflict=assertThrows(ApiException.class,()->jobs.submit(owner,"key-1",new JobService.Request(project,"node","image","moonlight",null,null,null,null,List.of())));assertEquals("IDEMPOTENCY_CONFLICT",conflict.code);
        assertFalse(first.containsKey("requestJson"));assertFalse(first.containsKey("leaseToken"));
    }
    @Test void finishingAnOldGenerationOnlyAddsACandidateAsset()throws Exception{
        String project=(String)store.createProject(owner,"original",Json.read("{\"nodes\":[]}")).get("id");
        String id=(String)jobs.submit(owner,"old-generation",new JobService.Request(project,"node","image","sunlight",null,null,null,null,List.of())).get("id");
        store.saveProject(owner,project,1,"newer edit",Json.read("{\"nodes\":[{\"id\":\"manual-edit\"}]}"));
        var muse=mock(MuseClient.class);var outcome=new MuseClient.Outcome(null,"completed",null,"unused",null);when(muse.submit(eq(id),eq(owner),any())).thenReturn(outcome);
        byte[] png=java.util.Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=");when(muse.download(outcome,"image")).thenReturn(new MuseClient.Media(png,"image/png"));
        var runner=new JobRunner(store,settings,muse,new AssetService(settings,store),jdbc,transactions,provider);try{runner.execute(id);}finally{runner.close();}
        var result=jobs.job(owner,id);assertEquals("succeeded",result.get("status"));assertNotNull(result.get("resultAssetId"));
        assertEquals("newer edit",store.project(owner,project).get("title"));assertEquals(2L,store.project(owner,project).get("revision"));assertEquals(1L,result.get("inputRevision"));
    }
    @Test void cancellationDuringDownloadDoesNotPublishAnAsset()throws Exception{
        String project=(String)store.createProject(owner,"cancel test",Json.read("{}")).get("id");
        String id=(String)jobs.submit(owner,"cancel-during-download",new JobService.Request(project,"node","image","sunlight",null,null,null,null,List.of())).get("id");
        var muse=mock(MuseClient.class);var outcome=new MuseClient.Outcome(null,"completed",null,"unused",null);when(muse.submit(eq(id),eq(owner),any())).thenReturn(outcome);
        byte[] png=java.util.Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=");
        when(muse.download(outcome,"image")).thenAnswer(invocation->{jobs.cancel(owner,id);return new MuseClient.Media(png,"image/png");});
        var runner=new JobRunner(store,settings,muse,new AssetService(settings,store),jdbc,transactions,provider);try{runner.execute(id);}finally{runner.close();}
        assertEquals("cancelled",jobs.job(owner,id).get("status"));assertNull(jobs.job(owner,id).get("resultAssetId"));
        assertEquals(0,jdbc.queryForObject("SELECT COUNT(*) FROM asset WHERE source_job_id=?",Integer.class,id));
    }
    @Test void expiredJobsStopBeforeAnyExternalCall(){
        String project=(String)store.createProject(owner,"expired test",Json.read("{}")).get("id");
        String id=(String)jobs.submit(owner,"expired",new JobService.Request(project,"node","image","sunlight",null,null,null,null,List.of())).get("id");
        jdbc.update("UPDATE generation_job SET status='waiting_provider',provider_task_id='upstream-existing',created_at=TIMESTAMPADD(HOUR,-3,CURRENT_TIMESTAMP(3)) WHERE id=?",id);
        var muse=mock(MuseClient.class);var runner=new JobRunner(store,settings,muse,new AssetService(settings,store),jdbc,transactions,provider);try{runner.execute(id);}finally{runner.close();}
        assertEquals("unknown_external",jobs.job(owner,id).get("status"));verifyNoInteractions(muse);
    }
}
