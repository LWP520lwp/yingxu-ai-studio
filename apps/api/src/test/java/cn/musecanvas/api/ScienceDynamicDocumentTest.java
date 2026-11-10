package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

class ScienceDynamicDocumentTest {
    private final WorkbenchStore store=mock(WorkbenchStore.class);
    private final ScienceVideoDocument documents=new ScienceVideoDocument(store);
    private JsonNode document(String extra,String narration){
        return Json.read("{\"schemaVersion\":1,\"topic\":\"水的变化\",\"title\":\"看见蒸发\",\"audience\":\"teen\",\"structure\":\"explain\",\"aspectRatio\":\"16:9\",\"sources\":[{\"id\":\"s\",\"title\":\"提供的资料\",\"url\":\"https://example.com/source\",\"excerpt\":\"液态水可以转变成水蒸气。\"}],\"scenes\":[{\"id\":\"shot\",\"role\":\"explain\",\"narration\":\""+narration+"\",\"visualPrompt\":\"玻璃杯\",\"videoPrompt\":\"跟随杯中水位变化，保持自然运动\",\"sourceIds\":[\"s\"],\"verified\":true"+extra+"}]}");
    }
    @Test void videoBindingRejectsPicturesAndOtherProjects(){
        when(store.asset("owner","picture")).thenReturn(Map.of("mimeType","image/png","projectId","project"));
        when(store.asset("owner","foreign")).thenReturn(Map.of("mimeType","video/mp4","projectId","other"));
        when(store.asset("owner","video")).thenReturn(Map.of("mimeType","video/mp4","projectId","project"));
        assertThrows(ApiException.class,()->documents.validate("owner","project",document(",\"videoAssetId\":\"picture\"","水可以蒸发。")));
        assertThrows(ApiException.class,()->documents.validate("owner","project",document(",\"videoAssetId\":\"foreign\"","水可以蒸发。")));
        JsonNode saved=documents.validate("owner","project",document(",\"videoAssetId\":\"video\"","水可以蒸发。"));
        assertDoesNotThrow(()->documents.requireDynamicReady(saved,false,15));
    }
    @Test void paidGenerationRequiresExplicitChoiceAndNaturalSpeechBudget(){
        JsonNode saved=documents.validate("owner","project",document("","水可以蒸发。"));
        assertThrows(ApiException.class,()->documents.requireDynamicReady(saved,false,15));
        assertDoesNotThrow(()->documents.requireDynamicReady(saved,true,15));
        JsonNode longSpeech=documents.validate("owner","project",document("","科".repeat(46)));
        assertThrows(ApiException.class,()->documents.requireDynamicReady(longSpeech,true,15));
        JsonNode quickSpeech=documents.validate("owner","project",document("","科".repeat(16)));
        assertThrows(ApiException.class,()->documents.requireDynamicReady(quickSpeech,true,5));
    }
    @Test void motionRequestPreservesReferenceImageAndNativeChineseNarration(){
        JsonNode scene=document("","水可以蒸发。").path("scenes").get(0);
        var request=ScienceVideoService.videoRequest("project",scene,"muse-service-video",15,"9:16","reference");
        assertEquals("video",request.kind());assertEquals("muse-service-video",request.model());assertEquals(List.of("reference"),request.referenceAssetIds());
        assertEquals(720,request.width());assertEquals(1280,request.height());assertEquals(15,request.duration());assertEquals("auto",request.videoMode());
        assertTrue(request.prompt().contains("跟随杯中水位变化"));assertTrue(request.prompt().contains("中文讲解：水可以蒸发。"));
        assertTrue(request.prompt().contains("中文旁白音轨"));assertTrue(request.prompt().contains("科学可视化示意"));assertTrue(request.prompt().contains("不能使用静止图片轮播"));
    }
}
