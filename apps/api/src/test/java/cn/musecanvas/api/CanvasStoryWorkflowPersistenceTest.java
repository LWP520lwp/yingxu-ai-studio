package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.*;
import tools.jackson.databind.JsonNode;

@EnabledIfEnvironmentVariable(named="DB_PASSWORD",matches=".+")
class CanvasStoryWorkflowPersistenceTest {
    private JdbcTemplate jdbc; private DataSourceTransactionManager manager; private TransactionStatus fixture;
    private WorkbenchStore store; private CanvasStoryModelClient models; private CanvasStoryWorkflowService service;
    private String owner,other,project,anotherProject;
    @BeforeEach void setup(){
        String url=System.getenv().getOrDefault("DB_URL","jdbc:mysql://"+System.getenv().getOrDefault("DB_HOST","127.0.0.1")+":"+System.getenv().getOrDefault("DB_PORT","3308")+"/"+System.getenv().getOrDefault("DB_NAME","workbench")+"?serverTimezone=UTC");
        url+=(url.contains("?")?"&":"?")+"connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true";
        var ds=new DriverManagerDataSource(url,System.getenv().getOrDefault("DB_USERNAME","workbench"),System.getenv("DB_PASSWORD"));
        Flyway.configure().dataSource(ds).callbacks(new DatabaseCollationCompatibility()).load().migrate();jdbc=new JdbcTemplate(ds);manager=new DataSourceTransactionManager(ds);var tx=new TransactionTemplate(manager);
        // Keep every queued fixture invisible to the running application's scheduler.
        fixture=manager.getTransaction(new DefaultTransactionDefinition());
        var settings=new AppSettings(new MockEnvironment().withProperty("app.scheduler-enabled","false"));
        store=new WorkbenchStore(jdbc,tx,mock(RedisSupport.class),settings);models=mock(CanvasStoryModelClient.class);
        service=new CanvasStoryWorkflowService(jdbc,tx,store,new CanvasStoryDocument(),models,settings);
        owner=UUID.randomUUID().toString();other=UUID.randomUUID().toString();
        for(String id:List.of(owner,other))jdbc.update("INSERT INTO app_user(id,provider,external_id,display_name) VALUES(?,'test',?,'story fixture')",id,id);
        project=(String)store.createProject(owner,"story",Json.read("{\"nodes\":[{\"id\":\"keep-canvas\"}]}")).get("id");
        anotherProject=(String)store.createProject(owner,"other canvas",Json.read("{}")).get("id");
        when(models.fingerprint(owner,"muse-spark")).thenReturn("pinned");
        when(models.complete(eq(owner),eq("muse-spark"),eq("pinned"),anyString(),anyString())).thenReturn(archive());
    }
    @AfterEach void cleanup(){if(service!=null)service.close();if(fixture!=null&&!fixture.isCompleted())manager.rollback(fixture);}
    private JsonNode input(String paragraph){var fields=new LinkedHashMap<String,Object>();for(String key:CanvasStoryDocument.EDITABLE)fields.put(key,CanvasStoryDocument.empty().path(key));fields.put("novel","陈青走进仓库。");fields.put("paragraph",paragraph);fields.put("model","muse-spark");return CanvasStoryDocument.node(fields);}
    private String submit(){service.save(owner,project,0L,input("她推开仓库大门。"));return (String)service.create(owner,project,1L,"extract").get("id");}
    private void running(String id){jdbc.update("UPDATE canvas_story_task SET status='running',lease_token='fixture-lease',lease_until=TIMESTAMPADD(SECOND,300,CURRENT_TIMESTAMP(3)) WHERE id=?",id);}
    @Test void projectOwnerBoundaryIndependentRevisionsAndTaskViewsNeverExposeInputsOrCredentials(){
        String id=submit();assertEquals(1L,service.get(owner,project).get("revision"));assertEquals(0L,service.get(owner,anotherProject).get("revision"));
        assertThrows(ApiException.class,()->service.get(other,project));assertThrows(ApiException.class,()->service.save(other,project,1L,input("other")));
        assertThrows(ApiException.class,()->service.task(other,project,id));assertThrows(ApiException.class,()->service.task(owner,anotherProject,id));assertThrows(ApiException.class,()->service.cancel(owner,anotherProject,id));
        var view=service.task(owner,project,id);assertEquals("queued",view.get("status"));for(String hidden:List.of("input_document","model_fingerprint","lease_token","apiKey"))assertFalse(view.containsKey(hidden));
        assertTrue(Json.write(store.project(owner,project)).contains("keep-canvas"));verify(models,never()).complete(anyString(),anyString(),anyString(),anyString(),anyString());
    }
    @Test void staleRevisionAndConcurrentOwnerTasksAreRejectedBeforeAnyPaidRequest(){
        String id=submit();assertThrows(ApiException.class,()->service.save(owner,project,0L,input("stale")));assertThrows(ApiException.class,()->service.create(owner,project,1L,"extract"));
        service.save(owner,anotherProject,0L,input("另一画布"));assertThrows(ApiException.class,()->service.create(owner,anotherProject,1L,"extract"));
        assertEquals("queued",service.task(owner,project,id).get("status"));assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM canvas_story_task WHERE owner_id=?",Integer.class,owner));verify(models,never()).complete(anyString(),anyString(),anyString(),anyString(),anyString());
    }
    @Test void cancellingQueuedAndAlreadyStartedTasksNeverPublishesAResult(){
        String id=submit();service.cancel(owner,project,id);service.execute(id);assertEquals("cancelled",service.task(owner,project,id).get("status"));verify(models,never()).complete(anyString(),anyString(),anyString(),anyString(),anyString());
        String next=(String)service.create(owner,project,1L,"extract").get("id");running(next);
        when(models.complete(eq(owner),anyString(),anyString(),anyString(),anyString())).thenAnswer(call->{service.cancel(owner,project,next);return archive();});
        service.execute(next);assertEquals("cancelled",service.task(owner,project,next).get("status"));assertEquals(1L,service.get(owner,project).get("revision"));assertTrue(((JsonNode)service.get(owner,project).get("document")).path("characters").isEmpty());
    }
    @Test void newerDraftWinsWhenTheModelFinishesAndTheOriginalTaskFailsWithConflict(){
        String id=submit();running(id);
        when(models.complete(eq(owner),anyString(),anyString(),anyString(),anyString())).thenAnswer(call->{service.save(owner,project,1L,input("用户在另一窗口写入的最新段落。"));return archive();});
        service.execute(id);var task=service.task(owner,project,id);assertEquals("failed",task.get("status"));assertTrue(task.get("error").toString().contains("其他窗口修改"));
        assertEquals(2L,service.get(owner,project).get("revision"));assertEquals("用户在另一窗口写入的最新段落。",((JsonNode)service.get(owner,project).get("document")).path("paragraph").asString());
    }
    @Test void successIsCommittedOnceAndInvalidOutputCannotOverwriteArchives(){
        String id=submit();running(id);when(models.complete(eq(owner),anyString(),anyString(),anyString(),anyString())).thenReturn("档案如下：\n```json\n"+archive()+"\n```\n请核对。 ");service.execute(id);service.execute(id);assertEquals("succeeded",service.task(owner,project,id).get("status"));assertEquals(2L,service.get(owner,project).get("revision"));
        JsonNode saved=(JsonNode)service.get(owner,project).get("document");assertTrue(saved.path("characters").get(0).path("locked").asBoolean());
        verify(models,times(1)).complete(anyString(),anyString(),anyString(),anyString(),anyString());
        String bad=(String)service.create(owner,project,2L,"extract").get("id");running(bad);when(models.complete(eq(owner),anyString(),anyString(),anyString(),anyString())).thenReturn("not json");service.execute(bad);
        assertEquals("failed",service.task(owner,project,bad).get("status"));assertEquals(saved,service.get(owner,project).get("document"));assertEquals(2L,service.get(owner,project).get("revision"));
    }
    @Test void anExpiredExecutionIsMarkedFailedAndNeverReplayedAutomatically(){
        String id=submit();running(id);jdbc.update("UPDATE canvas_story_task SET lease_until=TIMESTAMPADD(SECOND,-1,CURRENT_TIMESTAMP(3)) WHERE id=?",id);
        service.recoverExpired();service.execute(id);assertEquals("failed",service.task(owner,project,id).get("status"));assertTrue(service.task(owner,project,id).get("error").toString().contains("未自动重发"));
        verify(models,never()).complete(anyString(),anyString(),anyString(),anyString(),anyString());
        String retry=(String)service.create(owner,project,1L,"extract").get("id");assertNotEquals(id,retry);assertEquals("queued",service.task(owner,project,retry).get("status"));
    }
    @Test void oneClickFirstSegmentIsAtomicWhenTheSecondModelStepFails(){
        service.save(owner,project,0L,input("她推开仓库大门。"));String id=(String)service.create(owner,project,1L,"first").get("id");running(id);
        when(models.complete(eq(owner),anyString(),anyString(),anyString(),anyString())).thenReturn(archive(),"{\"shots\":[]}");
        service.execute(id);assertEquals("failed",service.task(owner,project,id).get("status"));assertEquals(1L,service.get(owner,project).get("revision"));
        JsonNode saved=(JsonNode)service.get(owner,project).get("document");assertTrue(saved.path("characters").isEmpty());assertTrue(saved.path("segments").isEmpty());
        verify(models,times(2)).complete(anyString(),anyString(),anyString(),anyString(),anyString());
    }
    private String archive(){
        var core=new LinkedHashMap<String,String>();for(String key:CanvasStoryDocument.CORE)core.put(key,"原文未明，拟定项");
        var person=Map.of("id","actor","name","陈青","aliases",List.of("小陈"),"locked",false,"core",core,"clothing",Map.of("upper","灰色外套","lower","深色长裤","shoes","白鞋","accessories","无"),"personality","冷静","voice","自然女声","assumptions",List.of("外观拟定，待核对"));
        return Json.write(Map.of("characters",List.of(person),"scenes",List.of(Map.of("id","warehouse","name","仓库","aliases",List.of(),"time","早晨","weather","晴朗","lighting","自然侧光","space","大门与走廊","elements","水泥地面")),"props",List.of()));
    }
}
