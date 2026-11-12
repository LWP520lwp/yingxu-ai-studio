package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class SettingsAndRequestTest {
    @Test void productionProfileAlwaysDisablesLocalLogin(){
        var env=new MockEnvironment();env.setActiveProfiles("dev");assertTrue(new AppSettings(env).localEnabled());
        env.setActiveProfiles("dev","prod");assertFalse(new AppSettings(env).localEnabled());
        env.setActiveProfiles("production");assertFalse(new AppSettings(env).localEnabled());
    }
    @Test void defaultModelAndDimensionsAreDeterministic(){
        var r=JobService.normalize(new JobService.Request("project","node","image","  solar system  ",null,null,null,null,null));
        assertEquals("muse-image",r.model());assertEquals(1024,r.width());assertEquals("solar system",r.prompt());assertEquals(List.of(),r.referenceAssetIds());
        assertEquals(Json.hash(Json.write(r)),Json.hash(Json.write(JobService.normalize(r))));
    }
    @Test void unsupportedInputFailsBeforeCallingAProvider(){
        assertThrows(ApiException.class,()->JobService.normalize(new JobService.Request("p","n",null,"prompt",null,null,null,null,null)));
        var generic=JobService.normalize(new JobService.Request("p","n","video","prompt",null,null,null,null,List.of("a","b","c")));
        assertEquals("reference",generic.videoMode());assertEquals(List.of("a","b","c"),generic.referenceAssetIds());
        assertThrows(ApiException.class,()->JobService.normalize(new JobService.Request("p","n","video","prompt",null,null,null,null,List.of("a","b","c"),null,null,"frames")));
        assertThrows(ApiException.class,()->JobService.normalize(new JobService.Request("p","n","image","prompt",null,100000,20,null,null)));
    }
    @Test void optionalSkillIdentityIsValidatedAndAbsentFieldsKeepExistingIdempotencySerialization(){
        var original=JobService.normalize(new JobService.Request("p","n","video","text",null,null,null,null,List.of()));
        assertFalse(Json.write(original).contains("skillId"));
        assertFalse(Json.write(original).contains("skillVersion"));
        assertThrows(ApiException.class,()->JobService.normalize(new JobService.Request("p","n","video","text",null,null,null,null,List.of(),"private-test",null)));
        assertThrows(ApiException.class,()->JobService.normalize(new JobService.Request("p","n","video","text",null,null,null,null,List.of(),"../other","1.0.0")));
        var selected=JobService.normalize(new JobService.Request("p","n","video","text",null,null,null,null,List.of(),"private-test","1.0.0"));
        assertEquals("private-test",selected.skillId()); assertEquals("1.0.0",selected.skillVersion());
        assertTrue(Json.write(selected).contains("skillId"));
    }
}
