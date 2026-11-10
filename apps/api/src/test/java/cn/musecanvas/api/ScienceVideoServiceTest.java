package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.file.*;
import java.util.*;
import javax.imageio.ImageIO;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.*;
import tools.jackson.databind.JsonNode;

@EnabledIfEnvironmentVariable(named="DB_PASSWORD",matches=".+")
class ScienceVideoServiceTest {
    @TempDir Path storage;
    private JdbcTemplate jdbc;private DataSourceTransactionManager manager;private TransactionTemplate tx;private TransactionStatus isolation;
    private WorkbenchStore store;private AssetService assets;private AppSettings settings;private MockEnvironment env;private ScienceVideoDocument docs;private ScienceTtsService tts;private VideoCompositionRenderer renderer;private VideoCompositionDocument composition;private ScienceVideoService service;private JobService jobs;private ChannelService channels;private ChannelClient client;
    private String owner,other,project,image;
    @BeforeEach void setup()throws Exception{
        String url=System.getenv().getOrDefault("DB_URL","jdbc:mysql://"+System.getenv().getOrDefault("DB_HOST","127.0.0.1")+":"+System.getenv().getOrDefault("DB_PORT","3308")+"/"+System.getenv().getOrDefault("DB_NAME","workbench")+"?serverTimezone=UTC");url+=(url.contains("?")?"&":"?")+"connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true";
        var ds=new DriverManagerDataSource(url,System.getenv().getOrDefault("DB_USERNAME","workbench"),System.getenv("DB_PASSWORD"));Flyway.configure().dataSource(ds).callbacks(new DatabaseCollationCompatibility()).load().migrate();jdbc=new JdbcTemplate(ds);manager=new DataSourceTransactionManager(ds);tx=new TransactionTemplate(manager);
        env=new MockEnvironment().withProperty("app.storage-root",storage.toString()).withProperty("app.scheduler-enabled","false");settings=new AppSettings(env);store=new WorkbenchStore(jdbc,tx,mock(RedisSupport.class),settings);assets=new AssetService(settings,store);docs=new ScienceVideoDocument(store);tts=mock(ScienceTtsService.class);when(tts.capabilities()).thenReturn(Map.of("ttsAvailable",true,"voices",List.of(Map.of("id","sapi-huihui-zh-cn","name","test")),"message","test"));renderer=mock(VideoCompositionRenderer.class);when(renderer.available()).thenReturn(true);composition=new VideoCompositionDocument(store);jobs=mock(JobService.class);channels=mock(ChannelService.class);client=mock(ChannelClient.class);service=create();
        owner=UUID.randomUUID().toString();other=UUID.randomUUID().toString();for(String id:List.of(owner,other))jdbc.update("INSERT INTO app_user(id,provider,external_id,display_name) VALUES(?,'test',?,'science test')",id,id);
        project=(String)store.createProject(owner,"science test",Json.read("{\"nodes\":[{\"id\":\"preserve-canvas\"}]}")).get("id");var bytes=new ByteArrayOutputStream();ImageIO.write(new BufferedImage(80,60,BufferedImage.TYPE_INT_RGB),"png",bytes);image=(String)assets.upload(owner,project,new MockMultipartFile("file","science.png","image/png",bytes.toByteArray())).get("id");
        // Keep queued fixtures invisible to the user's running API scheduler.
        isolation=manager.getTransaction(new DefaultTransactionDefinition());
    }
    private ScienceVideoService create(){return new ScienceVideoService(jdbc,tx,store,assets,docs,tts,renderer,composition,jobs,channels,client,settings,env);}
    @AfterEach void cleanup(){
        if(service!=null)service.close();if(isolation!=null)manager.rollback(isolation);if(jdbc==null||owner==null)return;for(String id:List.of(owner,other)){jdbc.update("DELETE FROM science_video_run WHERE owner_id=?",id);jdbc.update("DELETE FROM asset WHERE owner_id=?",id);jdbc.update("DELETE r FROM project_revision r JOIN project p ON p.id=r.project_id WHERE p.owner_id=?",id);jdbc.update("DELETE FROM project WHERE owner_id=?",id);jdbc.update("DELETE FROM app_user WHERE id=?",id);}
    }
    private JsonNode document(boolean verified,boolean withImage){
        var scene=new LinkedHashMap<String,Object>();scene.put("id","scene_one");scene.put("role","explain");scene.put("narration","这是示意图。请观察画面。");scene.put("visualPrompt","蓝色背景的科普示意图");scene.put("sourceIds",List.of("source_one"));scene.put("verified",verified);if(withImage)scene.put("assetId",image);
        return Json.read(Json.write(Map.of("schemaVersion",1,"topic","示意说明","title","测试科普","audience","teen","structure","explain","aspectRatio","16:9","sources",List.of(Map.of("id","source_one","title","用户提供测试资料","url","https://example.com/source","excerpt","这是用户提供的测试示意讲稿。")),"scenes",List.of(scene))));
    }
    private String enqueue(boolean generate){return (String)service.createRun(owner,project,new ScienceVideoController.Run(1L,"sapi-huihui-zh-cn",generate,generate?"muse-image":null)).get("id");}
    private void running(String id){jdbc.update("UPDATE science_video_run SET status='running',lease_token='test-science-token' WHERE id=?",id);}
    private ScienceVideoController.Run dynamicRun(boolean generate){return new ScienceVideoController.Run(1L,null,false,null,null,"muse-service-video",15,null,generate);}
    @SuppressWarnings("unchecked") private JsonNode dynamicDocument(boolean twoScenes,String video){
        var base=Json.MAPPER.readValue(Json.write(document(true,false)),LinkedHashMap.class);
        var scenes=(List<Map<String,Object>>)base.get("scenes");var first=new LinkedHashMap<>(scenes.getFirst());first.put("videoPrompt","镜头平稳跟随水滴移动，水滴落入杯中形成涟漪");if(video!=null)first.put("videoAssetId",video);
        var output=new ArrayList<Map<String,Object>>();output.add(first);if(twoScenes){var second=new LinkedHashMap<>(first);second.put("id","scene_two");second.put("videoPrompt","侧面观察水面涟漪连续扩散");output.add(second);}base.put("scenes",output);return Json.read(Json.write(base));
    }
    private String videoAsset(byte[] bytes){return (String)assets.upload(owner,project,new MockMultipartFile("file","motion.mp4","video/mp4",bytes)).get("id");}
    @Test void dynamicIsDefaultDoesNotRequireTtsAndSubmitsOnlyOneDurableVideoTask(){
        when(tts.capabilities()).thenReturn(Map.of("ttsAvailable",false,"voices",List.of()));service.save(owner,project,0L,dynamicDocument(false,null));
        assertThrows(ApiException.class,()->service.createRun(owner,project,dynamicRun(false)));verifyNoInteractions(jobs);
        when(jobs.submit(eq(owner),anyString(),any())).thenReturn(Map.of("id","motion-task"));when(jobs.job(owner,"motion-task")).thenReturn(Map.of("status","queued"));
        String id=(String)service.createRun(owner,project,dynamicRun(true)).get("id");assertEquals(id,service.createRun(owner,project,dynamicRun(true)).get("id"));
        assertEquals("muse_video",service.run(owner,project,id).get("productionMode"));assertEquals("muse_native",service.run(owner,project,id).get("audioMode"));assertEquals("scene",service.run(owner,project,id).get("captionTiming"));
        running(id);service.execute(id);assertEquals("waiting_videos",service.run(owner,project,id).get("status"));running(id);service.execute(id);
        var request=org.mockito.ArgumentCaptor.forClass(JobService.Request.class);verify(jobs,times(1)).submit(eq(owner),anyString(),request.capture());assertEquals("video",request.getValue().kind());assertEquals(15,request.getValue().duration());assertTrue(request.getValue().prompt().contains("中文讲解：这是示意图。请观察画面。"));verifyNoInteractions(tts);verify(renderer,never()).render(anyString(),any(),any(),any());
    }
    @Test void failedRunReusesCompletedNativeVideoByExactProjectAndPromptFingerprint(){
        String video=videoAsset(new byte[]{1});service.save(owner,project,0L,dynamicDocument(true,null));when(renderer.inspect(any())).thenReturn(new VideoCompositionRenderer.MediaInfo(15,true,true));
        var submitted=new ArrayList<JobService.Request>();when(jobs.submit(eq(owner),anyString(),any())).thenAnswer(call->{JobService.Request request=call.getArgument(2);submitted.add(request);return Map.of("id",request.nodeId().equals("science_scene_one")?"ready-video":"second-"+submitted.size());});
        when(jobs.job(eq(owner),anyString())).thenAnswer(call->{String task=call.getArgument(1);return task.equals("ready-video")?Map.of("status","succeeded","resultAssetId",video):task.equals("second-2")?Map.of("status","failed"):Map.of("status","queued");});
        String first=(String)service.createRun(owner,project,dynamicRun(true)).get("id");running(first);service.execute(first);assertEquals("failed",service.run(owner,project,first).get("status"));assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM science_video_clip_cache WHERE owner_id=?",Integer.class,owner));
        String retry=(String)service.createRun(owner,project,dynamicRun(true)).get("id");assertNotEquals(first,retry);running(retry);service.execute(retry);
        assertEquals("waiting_videos",service.run(owner,project,retry).get("status"));assertEquals(3,submitted.size());assertEquals(1,submitted.stream().filter(request->request.nodeId().equals("science_scene_one")).count());
        assertEquals(video,((JsonNode)service.run(owner,project,retry).get("resolvedVideos")).path("scene_one").asString());verifyNoInteractions(tts);
    }
    @Test void missingNativeAudioFailsHonestlyAndKeepsTheVideoWithoutGeneratingTts(){
        String video=videoAsset(new byte[]{1});service.save(owner,project,0L,dynamicDocument(false,null));when(renderer.inspect(any())).thenReturn(new VideoCompositionRenderer.MediaInfo(15,false,true));
        when(jobs.submit(eq(owner),anyString(),any())).thenReturn(Map.of("id","silent-video"));when(jobs.job(owner,"silent-video")).thenReturn(Map.of("status","succeeded","resultAssetId",video));
        String id=(String)service.createRun(owner,project,dynamicRun(true)).get("id");running(id);service.execute(id);var result=service.run(owner,project,id);
        assertEquals("failed",result.get("status"));assertTrue(String.valueOf(result.get("error")).contains("没有原生音轨"));assertEquals(video,((JsonNode)result.get("resolvedVideos")).path("scene_one").asString());assertNull(result.get("resultAssetId"));assertEquals(0,jdbc.queryForObject("SELECT COUNT(*) FROM science_video_clip_cache WHERE owner_id=?",Integer.class,owner));verifyNoInteractions(tts);verify(renderer,never()).render(anyString(),any(),any(),any());
    }
    @Test void realDynamicProductionPreservesNativeVideoAudioAndDoesNotInvokeOfflineNarration()throws Exception{
        renderer=new VideoCompositionRenderer(env);Assumptions.assumeTrue(renderer.available(),"No FFmpeg on this host");service.close();service=create();
        Path source=storage.resolve("test-native-motion.mp4");var ffmpeg=new ProcessBuilder("ffmpeg","-v","error","-nostdin","-y","-f","lavfi","-i","testsrc2=size=320x180:rate=30:duration=1.2","-f","lavfi","-i","sine=frequency=620:duration=1.2","-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac","-shortest",source.toString()).redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD).start();assertTrue(ffmpeg.waitFor(15,java.util.concurrent.TimeUnit.SECONDS));assertEquals(0,ffmpeg.exitValue());
        String video=videoAsset(Files.readAllBytes(source));service.save(owner,project,0L,dynamicDocument(false,video));String id=(String)service.createRun(owner,project,dynamicRun(false)).get("id");running(id);service.execute(id);var result=service.run(owner,project,id);
        assertEquals("succeeded",result.get("status"),String.valueOf(result.get("error")));assertEquals("scene",result.get("captionTiming"));assertNull(result.get("narrationAssetId"));assertNotNull(result.get("subtitleAssetId"));assertNotNull(result.get("resultAssetId"));
        JsonNode timeline=(JsonNode)result.get("timeline");assertEquals(video,timeline.path("clips").get(0).path("assetId").asString());assertEquals(1,timeline.path("clips").get(0).path("volume").asInt());assertEquals("video",timeline.path("clips").get(0).path("track").asString());
        var output=renderer.inspect(assets.content(owner,(String)result.get("resultAssetId")));assertTrue(output.hasVideo());assertTrue(output.hasAudio());assertEquals(5.2,output.duration(),.08);verifyNoInteractions(tts,jobs);
        try(var paths=Files.list(storage)){assertFalse(paths.anyMatch(path->path.getFileName().toString().startsWith(".science-")));}
    }
    @Test void draftsAllowIncompleteEditingWithIndependentRevisionAndOwnership(){
        assertEquals(0L,service.get(owner,project).get("revision"));assertThrows(ApiException.class,()->service.get(other,project));assertEquals(1L,service.save(owner,project,0L,ScienceVideoDocument.empty()).get("revision"));assertThrows(ApiException.class,()->service.save(owner,project,0L,document(false,true)));assertEquals(2L,service.save(owner,project,1L,document(false,true)).get("revision"));assertEquals(0,jdbc.queryForObject("SELECT COUNT(*) FROM project_video_editor WHERE project_id=?",Integer.class,project));assertTrue(Json.write(store.project(owner,project)).contains("preserve-canvas"));
        String foreign=(String)store.createProject(other,"other",Json.read("{}")).get("id");String foreignAsset=(String)assets.upload(other,foreign,new MockMultipartFile("file","foreign.png","image/png",new byte[]{1})).get("id");String raw=Json.write(document(false,true)).replace(image,foreignAsset);assertThrows(ApiException.class,()->service.save(owner,project,2L,Json.read(raw)));
    }
    @Test void localPlanOnlyUsesProvidedTextAndModelPlanCannotInventSourceIdsOrVerification(){
        assertThrows(ApiException.class,()->service.plan(owner,project,ScienceVideoDocument.empty(),null));var local=service.plan(owner,project,document(true,true),null);assertEquals("source",local.get("source"));JsonNode planned=(JsonNode)local.get("document");assertFalse(planned.path("scenes").get(0).path("verified").asBoolean());verifyNoInteractions(client);
        var route=new ChannelService.Route(null,"text-model");when(channels.route(owner,"channel:test:model")).thenReturn(route);when(client.textPlan(eq(route),anyString(),anyString())).thenReturn("{\"title\":\"规划\",\"scenes\":[{\"role\":\"explain\",\"narration\":\"仅使用提供的讲稿。\",\"visualPrompt\":\"示意图\",\"sourceIds\":[\"source_one\"]}]}");var model=service.plan(owner,project,document(true,true),"channel:test:model");assertEquals("model",model.get("source"));assertFalse(((JsonNode)model.get("document")).path("scenes").get(0).path("verified").asBoolean());
        when(client.textPlan(eq(route),anyString(),anyString())).thenReturn("{\"scenes\":[{\"role\":\"explain\",\"narration\":\"虚构来源\",\"visualPrompt\":\"\",\"sourceIds\":[\"invented\"]}]}");assertThrows(ApiException.class,()->service.plan(owner,project,document(false,true),"channel:test:model"));
    }
    @Test void productionRequiresUserReviewAndExplicitImageGeneration(){
        service.save(owner,project,0L,document(false,true));assertThrows(ApiException.class,()->enqueue(false));service.save(owner,project,1L,document(true,false));assertThrows(ApiException.class,()->service.createRun(owner,project,new ScienceVideoController.Run(2L,"sapi-huihui-zh-cn",false,null)));verifyNoInteractions(jobs);verify(tts,never()).synthesize(anyString(),anyString(),any());
    }
    @Test void creationUsesTheDeploymentVoiceInventoryInsteadOfAssumingWindows(){
        service.save(owner,project,0L,document(true,true));
        when(tts.capabilities()).thenReturn(Map.of("ttsAvailable",true,"voices",List.of(Map.of("id",ScienceTtsService.ESPEAK_VOICE_ID,"name","中文 · 本地基础音色")),"message","local"));
        assertThrows(ApiException.class,()->enqueue(false));
        var created=service.createRun(owner,project,new ScienceVideoController.Run(1L,ScienceTtsService.ESPEAK_VOICE_ID,false,null));
        assertEquals("queued",created.get("status"));
        assertEquals(ScienceTtsService.ESPEAK_VOICE_ID,jdbc.queryForObject("SELECT voice_id FROM science_video_run WHERE id=?",String.class,created.get("id")));
    }
    @Test void missingImageIsSubmittedOnceAndAwaitedWithoutStartingNarration(){
        service.save(owner,project,0L,document(true,false));when(jobs.submit(eq(owner),anyString(),any())).thenReturn(Map.of("id","image-job"));when(jobs.job(owner,"image-job")).thenReturn(Map.of("id","image-job","status","queued"));String id=enqueue(true);assertEquals(id,enqueue(true));running(id);service.execute(id);assertEquals("waiting_images",service.run(owner,project,id).get("status"));running(id);service.execute(id);verify(jobs,times(1)).submit(eq(owner),eq("science:"+id+":scene_one"),any());verify(tts,never()).synthesize(anyString(),anyString(),any());assertThrows(ApiException.class,()->service.run(other,project,id));
    }
    @Test void sourceAndSceneValidationRejectsUnknownFieldsUnsafeLinksAndUnavailableReferences(){
        assertDoesNotThrow(()->docs.requireReady(docs.validate(owner,project,Json.read(Json.write(document(true,true)).replace("https://example.com/source",""))),false));
        String raw=Json.write(document(true,true));assertThrows(ApiException.class,()->docs.requireReady(docs.validate(owner,project,Json.read(raw.replace("https://example.com/source","file:///c:/windows/test"))),false));assertThrows(ApiException.class,()->docs.validate(owner,project,Json.read(raw.replace("\"sourceIds\":[\"source_one\"]","\"sourceIds\":[\"missing\"]"))));assertThrows(ApiException.class,()->docs.validate(owner,project,Json.read(raw.replace("\"verified\":true","\"verified\":true,\"apiKey\":\"ignored\""))));
    }
    @Test void realOfflineNarrationSubtitlesAndMp4KeepPinnedSnapshotAndHistoricalData()throws Exception{
        tts=new ScienceTtsService(env);if(Boolean.getBoolean("science.tts.require-available"))assertTrue(tts.available());Assumptions.assumeTrue(tts.available(),"No configured offline Chinese voice on this host");renderer=new VideoCompositionRenderer(env);Assumptions.assumeTrue(renderer.available(),"No FFmpeg on this host");service.close();service=create();
        String before="{\"schemaVersion\":1,\"aspectRatio\":\"16:9\",\"fps\":30,\"clips\":[]}";jdbc.update("INSERT INTO project_video_editor(project_id,revision,document) VALUES(?,1,?)",project,before);service.save(owner,project,0L,document(true,true));String voice=Json.read(Json.write(tts.capabilities())).path("voices").get(0).path("id").asString();String id=(String)service.createRun(owner,project,new ScienceVideoController.Run(1L,voice,false,null)).get("id");service.save(owner,project,1L,ScienceVideoDocument.empty());running(id);service.execute(id);var result=service.run(owner,project,id);assertEquals("succeeded",result.get("status"),String.valueOf(result.get("error")));assertNotNull(result.get("resultAssetId"));assertNotNull(result.get("subtitleAssetId"));assertNotNull(result.get("narrationAssetId"));
        String resultId=(String)result.get("resultAssetId"),subtitleId=(String)result.get("subtitleAssetId");assertEquals("video/mp4",store.asset(owner,resultId).get("mimeType"));assertThrows(ApiException.class,()->assets.content(other,resultId));String srt=Files.readString(assets.content(owner,subtitleId));assertTrue(srt.contains("这是示意图。"));assertTrue(srt.contains("参考资料"));JsonNode timeline=(JsonNode)result.get("timeline");assertEquals(1,timeline.path("schemaVersion").asInt());assertTrue(timeline.path("clips").size()>=6);assertEquals(Json.read(before),Json.read(jdbc.queryForObject("SELECT document FROM project_video_editor WHERE project_id=?",String.class,project)));assertEquals(2L,service.get(owner,project).get("revision"));assertEquals(0,((JsonNode)service.get(owner,project).get("document")).path("scenes").size());verifyNoInteractions(jobs);
        try(var paths=Files.list(storage)){assertFalse(paths.anyMatch(path->path.getFileName().toString().startsWith(".science-")),"private temporary narration files must be cleaned");}
    }
}
