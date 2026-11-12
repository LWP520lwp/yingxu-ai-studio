package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class MuseProviderTest {
    @Test void browserAndServiceVideoCapabilitiesMatchTheirImplementedTransport(){
        var browser=(java.util.Map<?,?>)MuseProvider.describe("muse-video",true,true).get("caps");
        var service=(java.util.Map<?,?>)MuseProvider.describe("muse-service-video",true).get("caps");
        assertEquals("内置 Muse 视频模型",MuseProvider.describe("muse-service-video",true).get("name"));
        assertEquals(2,browser.get("maxReferenceImages"));assertEquals(List.of("auto","reference"),browser.get("supportedVideoModes"));assertEquals(false,browser.get("supportsSizeControl"));
        assertEquals(4,service.get("maxReferenceImages"));assertEquals(List.of("auto","reference","frames"),service.get("supportedVideoModes"));assertEquals(2,service.get("maxFrameImages"));
    }
    private HttpServer server;private String base;
    private final AtomicInteger keyReads=new AtomicInteger();
    private final AtomicInteger modelReads=new AtomicInteger();
    @BeforeEach void setup()throws Exception{
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);base="http://127.0.0.1:"+server.getAddress().getPort();
        server.createContext("/admin/local-key",exchange->{
            assertEquals("GET",exchange.getRequestMethod());keyReads.incrementAndGet();byte[] body="{\"key\":\"fake-unit-test-key\"}".getBytes(StandardCharsets.UTF_8);exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,body.length);exchange.getResponseBody().write(body);exchange.close();
        });
        server.createContext("/v1/models",exchange->{
            assertEquals("GET",exchange.getRequestMethod());assertEquals("Bearer fake-unit-test-key",exchange.getRequestHeaders().getFirst("Authorization"));modelReads.incrementAndGet();
            byte[] body="{\"data\":[{\"id\":\"muse-spark\"},{\"id\":\"muse-image\"},{\"id\":\"muse-video\"},{\"id\":\"doubao-image\"},{\"id\":\"doubao-video\"}]}".getBytes(StandardCharsets.UTF_8);exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,body.length);exchange.getResponseBody().write(body);exchange.close();
        });server.start();
    }
    @AfterEach void close(){server.stop(0);}
    private MockEnvironment environment(){var env=new MockEnvironment().withProperty("app.muse-base-url",base).withProperty("app.muse-local-pool-url",base);env.setActiveProfiles("dev");return env;}
    @Test void existingLocalKeyIsReadOnceAndNeverIncludedInBrowserMetadata(){
        var env=environment().withProperty("app.muse-local-key-enabled","true");var provider=new MuseProvider(new AppSettings(env));
        assertTrue(provider.enabled());var models=provider.models();String publicJson=Json.write(provider.integration())+Json.write(models);
        assertEquals(1,keyReads.get());assertEquals(1,modelReads.get());assertFalse(publicJson.contains("fake-unit-test-key"));assertFalse(publicJson.contains("muse-spark"));assertTrue(publicJson.contains("doubao-video"));
        provider.validate(JobService.normalize(new JobService.Request("p","n","video","test","doubao-video",1280,720,10,List.of())));assertEquals(1,keyReads.get());assertEquals(1,modelReads.get());
    }
    @Test void localKeyDiscoveryIsOptInAndAlwaysDisabledInProduction(){
        var env=environment();var provider=new MuseProvider(new AppSettings(env));assertFalse(provider.enabled());assertEquals(0,keyReads.get());
        env.withProperty("app.muse-local-key-enabled","true");env.setActiveProfiles("dev","prod");assertFalse(new MuseProvider(new AppSettings(env)).enabled());assertEquals(0,keyReads.get());
        assertFalse(MuseProvider.validLocalPool("https://example.com", "https://example.com"));assertFalse(MuseProvider.validLocalPool(base+"/path",base));assertFalse(MuseProvider.validLocalPool(base,"http://127.0.0.1:9999"));
    }
    @Test void doubaoCapabilitiesAreEnforcedBeforeAnyUpstreamCall(){
        var provider=new MuseProvider(new AppSettings(environment()));
        assertThrows(ApiException.class,()->provider.validate(JobService.normalize(new JobService.Request("p","n","video","test","doubao-video",1280,720,5,List.of()))));
        assertThrows(ApiException.class,()->provider.validate(JobService.normalize(new JobService.Request("p","n","image","test","doubao-image",1024,1024,null,List.of("reference")))));
        var request=JobService.normalize(new JobService.Request("p","n","video","test","doubao-video",null,null,null,List.of()));assertEquals(10,request.duration());assertEquals(1280,request.width());assertEquals(720,request.height());assertEquals(0,keyReads.get());assertEquals(0,modelReads.get());
    }
}
