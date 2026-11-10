package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.util.*;
import org.junit.jupiter.api.*;
import tools.jackson.databind.JsonNode;

class VideoCompositionDocumentTest {
    private WorkbenchStore store;private VideoCompositionDocument composition;
    @BeforeEach void setup(){
        store=mock(WorkbenchStore.class);when(store.project("owner","project")).thenReturn(Map.of("id","project"));
        when(store.asset(eq("owner"),anyString())).thenReturn(Map.of("id","image","projectId","project","mimeType","image/png"));
        composition=new VideoCompositionDocument(store);
    }
    private static JsonNode doc(Object...clips){return Json.read(Json.write(Map.of("schemaVersion",1,"fps",30,"aspectRatio","16:9","clips",List.of(clips))));}
    private static Map<String,Object> image(String id,double start,double duration){return Map.of("id",id,"track","video","assetId","image","start",start,"duration",duration,"volume",1);}
    @Test void roundsToFramesAndAddsSafeDefaults(){
        var normalized=composition.validate("owner","project",doc(Map.of("id","a","track","video","assetId","image","start",0.02,"duration",0.99)));
        assertEquals(1d/30,normalized.path("clips").get(0).path("start").asDouble(),0.0000001);
        assertEquals(1d,normalized.path("clips").get(0).path("duration").asDouble());assertEquals(1d,normalized.path("clips").get(0).path("volume").asDouble());
    }
    @Test void preventsOverlapsOversizeUnknownFieldsAndInvalidVolumes(){
        assertThrows(ApiException.class,()->composition.validate("owner","project",doc(image("a",0,3),image("b",2,3))));
        assertThrows(ApiException.class,()->composition.validate("owner","project",doc(image("a",179,2))));
        var clip=new HashMap<>(image("a",0,2));clip.put("url","http://unexpected");assertThrows(ApiException.class,()->composition.validate("owner","project",doc(clip)));
        clip.remove("url");clip.put("volume",1.01);assertThrows(ApiException.class,()->composition.validate("owner","project",doc(clip)));
        var clips=new ArrayList<Object>();for(int i=0;i<41;i++)clips.add(image("a"+i,i,1));assertThrows(ApiException.class,()->composition.validate("owner","project",doc(clips.toArray())));
        assertThrows(ApiException.class,()->composition.validate("owner","project",Json.read("{\"schemaVersion\":1.5,\"fps\":30,\"aspectRatio\":\"16:9\",\"clips\":[]}")));
    }
    @Test void assetMustBelongToOwnerAndCurrentProjectOrBeUnassigned(){
        when(store.asset("owner","image")).thenThrow(ApiException.notFound());assertThrows(ApiException.class,()->composition.validate("owner","project",doc(image("a",0,1))));
        reset(store);when(store.asset("owner","image")).thenReturn(Map.of("mimeType","image/png","projectId","different"));assertThrows(ApiException.class,()->composition.validate("owner","project",doc(image("a",0,1))));
        when(store.asset("owner","image")).thenReturn(Map.of("mimeType","image/png"));assertDoesNotThrow(()->composition.validate("owner","project",doc(image("a",0,1))));
    }
    @Test void audioMayOverlapButTracksMustMatchAssetsAndCaptionMustBeText(){
        when(store.asset("owner","audio")).thenReturn(Map.of("mimeType","audio/wav","projectId","project"));
        var a=Map.of("id","a","track","audio","assetId","audio","start",0,"duration",2);var b=Map.of("id","b","track","audio","assetId","audio","start",1,"duration",2);
        assertDoesNotThrow(()->composition.validate("owner","project",doc(a,b)));
        assertThrows(ApiException.class,()->composition.validate("owner","project",doc(Map.of("id","a","track","video","assetId","audio","start",0,"duration",2))));
        assertThrows(ApiException.class,()->composition.validate("owner","project",doc(Map.of("id","a","track","caption","text",12,"start",0,"duration",2))));
    }
}
