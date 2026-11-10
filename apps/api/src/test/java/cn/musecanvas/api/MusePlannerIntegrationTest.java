package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;

/** Science planning shares server-only Muse text routing and never runs media jobs. */
class MusePlannerIntegrationTest {
    private final WorkbenchStore store=mock(WorkbenchStore.class);
    private final JdbcTemplate jdbc=mock(JdbcTemplate.class);
    private final TransactionTemplate tx=mock(TransactionTemplate.class);
    private final AssetService assets=mock(AssetService.class);
    private final VideoCompositionRenderer renderer=mock(VideoCompositionRenderer.class);
    private final ChannelService channels=mock(ChannelService.class);
    private final ChannelClient client=mock(ChannelClient.class);
    private final MuseTextGateway muse=mock(MuseTextGateway.class);
    private final JobService jobs=mock(JobService.class);
    private final MockEnvironment env=new MockEnvironment();
    private final AppSettings settings=new AppSettings(env);

    @Test void scienceMusePlanningPreservesSourceReferencesAndRequiresManualVerification(){
        when(store.project("owner","science")).thenReturn(Map.of("id","science"));
        var documents=new ScienceVideoDocument(store);var composition=mock(VideoCompositionDocument.class);
        var science=new ScienceVideoService(jdbc,tx,store,assets,documents,mock(ScienceTtsService.class),renderer,composition,jobs,channels,client,settings,env,muse);
        try{
            var input=CanvasStoryDocument.mutable(ScienceVideoDocument.empty());input.put("topic","月光");input.put("sources",List.of(Map.of("id","source_one","title","来源摘录","url","https://example.com/source","excerpt","月光主要来自太阳光的反射。")));
            when(muse.complete(eq("owner"),anyString(),anyString(),anyString(),eq(4000))).thenReturn("```json\n{\"title\":\"月光\",\"scenes\":[{\"role\":\"explain\",\"narration\":\"月光主要来自太阳光的反射。\",\"visualPrompt\":\"太阳光照向月面示意\",\"sourceIds\":[\"source_one\"]}]}\n```");
            for(String model:List.of("muse-spark","muse-service-spark")){
                var result=science.plan("owner","science",CanvasStoryDocument.node(input),model);
                JsonNode doc=(JsonNode)result.get("document");assertEquals("model",result.get("source"));assertFalse(doc.path("scenes").get(0).path("verified").asBoolean());assertEquals("source_one",doc.path("scenes").get(0).path("sourceIds").get(0).asString());
                verify(muse).complete(eq("owner"),eq(model),anyString(),anyString(),eq(4000));
            }
            verifyNoInteractions(channels,client,jobs,jdbc,tx,assets,renderer,composition);
        }finally{science.close();}
    }
}
