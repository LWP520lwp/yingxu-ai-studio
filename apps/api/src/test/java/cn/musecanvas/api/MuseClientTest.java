package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import static org.mockito.Mockito.*;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class MuseClientTest {
    @Test void textToVideoExplicitlyRequestsNativeAudioWithoutImageEndpoints()throws Exception{
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);var body=new AtomicReference<String>();
        server.createContext("/v1/videos",exchange->{body.set(new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8));byte[] response="{\"id\":\"native-video\",\"status\":\"queued\"}".getBytes(StandardCharsets.UTF_8);exchange.sendResponseHeaders(200,response.length);exchange.getResponseBody().write(response);exchange.close();});server.start();
        try{
            var settings=new AppSettings(new MockEnvironment().withProperty("app.muse-base-url","http://127.0.0.1:"+server.getAddress().getPort()));
            new MuseClient(settings,null,new MuseProvider(settings)).submit("job","owner",JobService.normalize(new JobService.Request("p","n","video","中文自然旁白与连续运动","muse-video",1280,720,15,List.of())),"test-only");
            var request=Json.read(body.get());assertEquals("muse-video",request.path("model").asString());assertEquals(15,request.path("duration").asInt());assertTrue(request.path("generate_audio").asBoolean());assertEquals("16:9",request.path("size").asString());
        }finally{server.stop(0);}
    }
    @Test void framesAndReferenceModesUseDifferentMultipartFieldsAndPreserveOrder()throws Exception{
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        var requestBody=new AtomicReference<String>();
        server.createContext("/v1/videos",exchange->{requestBody.set(new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8));byte[] response="{\"id\":\"existing-video\",\"status\":\"queued\"}".getBytes(StandardCharsets.UTF_8);exchange.sendResponseHeaders(200,response.length);exchange.getResponseBody().write(response);exchange.close();});server.start();
        try{
            var settings=new AppSettings(new MockEnvironment().withProperty("app.muse-base-url","http://127.0.0.1:"+server.getAddress().getPort()));
            var assets=mock(AssetService.class);
            when(assets.referenceDataUrl("owner","first")).thenReturn("data:image/png;base64,"+Base64.getEncoder().encodeToString("FIRST-FRAME-CONTENT".getBytes(StandardCharsets.UTF_8)));
            when(assets.referenceDataUrl("owner","last")).thenReturn("data:image/png;base64,"+Base64.getEncoder().encodeToString("LAST-FRAME-CONTENT".getBytes(StandardCharsets.UTF_8)));
            var client=new MuseClient(settings,assets,new MuseProvider(settings));
            for(String mode:List.of("frames","reference","auto")){
                client.submit("job-"+mode,"owner",JobService.normalize(new JobService.Request("p","n","video","move","muse-video",1280,720,8,List.of("first","last"),null,null,mode)),"test-only");
                String body=requestBody.get();assertTrue(body.contains("name=\"mode\"\r\n\r\n"+(mode.equals("frames")?"frames":"reference")));
                assertTrue(body.indexOf("FIRST-FRAME-CONTENT")<body.indexOf("LAST-FRAME-CONTENT"));
                if(mode.equals("frames")){assertTrue(body.contains("name=\"first_frame\""));assertTrue(body.contains("name=\"last_frame\""));assertFalse(body.contains("name=\"image[]\""));}
                else{assertFalse(body.contains("name=\"first_frame\""));assertEquals(2,body.split("name=\\\"image\\[\\]\\\"",-1).length-1);}
            }
            var defaultRequest=JobService.normalize(new JobService.Request("p","n","video","move","muse-video",1280,720,8,List.of("first","last")));
            assertEquals("reference",defaultRequest.videoMode());
            client.submit("job-default","owner",defaultRequest,"test-only");
            String defaultBody=requestBody.get();assertTrue(defaultBody.contains("name=\"mode\"\r\n\r\nreference"));assertFalse(defaultBody.contains("name=\"first_frame\""));assertEquals(2,defaultBody.split("name=\\\"image\\[\\]\\\"",-1).length-1);
        }finally{server.stop(0);}
    }
    @Test void videoLimitsDistinguishReferenceSetsFromEndpointFrames(){
        var refs=List.of("a","b","c","d");
        var reference=JobService.normalize(new JobService.Request("p","n","video","move","muse-service-video",1280,720,8,refs,null,null,"reference"));
        assertEquals(refs,reference.referenceAssetIds());assertEquals("reference",MuseClient.videoMode(reference));
        var auto=JobService.normalize(new JobService.Request("p","n","video","move","muse-service-video",1280,720,8,refs,null,null,"auto"));assertEquals("reference",MuseClient.videoMode(auto));
        var twoAuto=JobService.normalize(new JobService.Request("p","n","video","move","muse-service-video",1280,720,8,List.of("a","b"),null,null,"auto"));assertEquals("reference",MuseClient.videoMode(twoAuto));
        assertThrows(ApiException.class,()->JobService.normalize(new JobService.Request("p","n","video","move","muse-service-video",1280,720,8,refs,null,null,"frames")));
        assertThrows(ApiException.class,()->JobService.normalize(new JobService.Request("p","n","video","move","muse-service-video",1280,720,8,List.of(),null,null,"frames")));
        assertThrows(ApiException.class,()->JobService.normalize(new JobService.Request("p","n","image","move","muse-image",1024,1024,8,List.of(),null,null,"reference")));
    }
    @Test void explicitSubmitRejectionDoesNotReplayAndNeverReturnsTheUpstreamBody()throws Exception{
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);var calls=new AtomicInteger();
        server.createContext("/v1/videos",exchange->{calls.incrementAndGet();byte[] response="private upstream credential and cookie details".getBytes(StandardCharsets.UTF_8);exchange.sendResponseHeaders(429,response.length);exchange.getResponseBody().write(response);exchange.close();});server.start();
        try{
            var settings=new AppSettings(new MockEnvironment().withProperty("app.muse-base-url","http://127.0.0.1:"+server.getAddress().getPort()));
            var client=new MuseClient(settings,null,new MuseProvider(settings));
            var failure=assertThrows(MuseClient.RequestRejected.class,()->client.submit("job","owner",JobService.normalize(new JobService.Request("p","n","video","move","muse-video",1280,720,8,List.of())),"test-only"));
            assertTrue(failure.getMessage().contains("429"));assertFalse(failure.getMessage().contains("credential"));assertEquals(1,calls.get());
        }finally{server.stop(0);}
    }
    @Test void upstreamTimeoutAndQuotaAreClassifiedWithoutLeakingPrivateDetails(){
        var timeout=MuseClient.parse(Json.read("{\"id\":\"task\",\"status\":\"failed\",\"error\":\"generation timeout for secret-cookie@example.com\"}"));
        assertTrue(timeout.failed());assertTrue(timeout.error().contains("超时"));assertFalse(timeout.error().contains("secret"));
        assertTrue(MuseClient.parse(Json.read("{\"code\":429,\"error\":{\"message\":\"quota exceeded\"}}")).error().contains("额度"));
    }
    @Test void museTextUsesConfirmedModelAndExtractsContentWithBoundedTransport()throws Exception{
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/v1/chat/completions",exchange->{
            var request=Json.read(new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8));assertEquals("muse-spark",request.path("model").asString());assertEquals(10000,request.path("max_tokens").asInt());assertFalse(request.path("stream").asBoolean());assertEquals("Bearer server-only",exchange.getRequestHeaders().getFirst("Authorization"));
            byte[] body=Json.write(Map.of("choices",List.of(Map.of("message",Map.of("content","{\"scenes\":[]}"))))).getBytes(StandardCharsets.UTF_8);exchange.sendResponseHeaders(200,body.length);exchange.getResponseBody().write(body);exchange.close();
        });server.start();
        try{var settings=new AppSettings(new MockEnvironment().withProperty("app.muse-base-url","http://127.0.0.1:"+server.getAddress().getPort()));assertEquals("{\"scenes\":[]}",new MuseClient(settings,null,new MuseProvider(settings)).completeText("system","input",10000,"server-only"));}finally{server.stop(0);}
    }
    @Test void asynchronousImageTaskIsNotMistakenForAResult(){
        var result=MuseClient.parse(Json.read("{\"object\":\"image.task\",\"task_id\":\"task-1\",\"status\":\"queued\"}"));
        assertEquals("task-1",result.taskId());assertFalse(result.completed());
    }
    @Test void acceptsNestedAndSynchronousProviderFormats(){
        assertEquals("https://cdn.example/a.png",MuseClient.parse(Json.read("{\"data\":[{\"url\":\"https://cdn.example/a.png\"}]}")).url());
        var nested=MuseClient.parse(Json.read("{\"code\":0,\"data\":{\"id\":\"video-1\",\"status\":\"succeeded\",\"content\":{\"video_url\":\"https://cdn.example/a.mp4\"}}}"));
        assertTrue(nested.completed());assertEquals("video-1",nested.taskId());assertEquals("https://cdn.example/a.mp4",nested.url());
        assertEquals("aGVsbG8=",MuseClient.parse(Json.read("{\"images\":[{\"b64_json\":\"aGVsbG8=\"}]}")).base64());
    }
    @Test void rejectsBusinessErrorsAndPrivateDownloadTargets(){
        assertTrue(MuseClient.parse(Json.read("{\"code\":500,\"data\":{\"url\":\"https://example.com/not-real.png\"}}")).failed());
        assertThrows(MuseClient.Rejected.class,()->MuseClient.validateDownloadUri(URI.create("http://127.0.0.1:3308/private"),URI.create("http://127.0.0.1:18610")));
        assertThrows(MuseClient.Rejected.class,()->MuseClient.validateDownloadUri(URI.create("file:///etc/passwd"),URI.create("http://127.0.0.1:18610")));
        assertDoesNotThrow(()->MuseClient.validateDownloadUri(URI.create("http://127.0.0.1:18610/v1/videos/id/content"),URI.create("http://127.0.0.1:18610")));
    }
    @Test void htmlCannotBecomeASuccessfulImageOrVideo(){
        byte[] html="<!doctype html><html>upstream error</html>".getBytes(StandardCharsets.UTF_8);
        assertThrows(MuseClient.Rejected.class,()->AssetService.generatedMime("image",html));
        assertThrows(MuseClient.Rejected.class,()->AssetService.generatedMime("video",html));
        byte[] png=java.util.Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=");
        assertEquals("image/png",AssetService.generatedMime("image",png));
        assertThrows(MuseClient.Rejected.class,()->AssetService.generatedMime("video",png));
    }
    @Test void uncommonPrivateRangesAndUnapprovedHostsAreRejected()throws Exception{
        assertFalse(MuseClient.publicAddress(java.net.InetAddress.getByName("fd00::1")));
        assertFalse(MuseClient.publicAddress(java.net.InetAddress.getByName("100.64.0.1")));
        assertFalse(MuseClient.publicAddress(java.net.InetAddress.getByName("2001:db8::1")));
        assertFalse(MuseClient.publicAddress(java.net.InetAddress.getByName("198.18.0.1")));
        assertTrue(MuseClient.publicAddress(java.net.InetAddress.getByName("1.1.1.1")));
        assertThrows(MuseClient.Rejected.class,()->MuseClient.validateDownloadUri(URI.create("https://unapproved.example/a.png"),URI.create("http://127.0.0.1:18610")));
    }
    @Test void configuredPoolLoopbackAliasIsCanonicalizedWithoutOpeningOtherPorts(){
        URI base=URI.create("http://127.0.0.1:18610");URI media=MuseClient.canonicalPoolUri(URI.create("http://localhost:18610/v1/media/image.png?signature=a%2Fb"),base);
        assertEquals("http://127.0.0.1:18610/v1/media/image.png?signature=a%2Fb",media.toString());
        assertEquals("localhost",MuseClient.canonicalPoolUri(URI.create("http://localhost:3308/private"),base).getHost());
        assertEquals("example.com",MuseClient.canonicalPoolUri(URI.create("https://example.com/media"),base).getHost());
    }
    @Test void downloadsValidWebpEvenWhenMusePoolLabelsItAsPlainText()throws Exception{
        byte[] webp=Base64.getDecoder().decode("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==");
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/v1/media/generated.webp",exchange->{
            assertEquals("Bearer test-only-key",exchange.getRequestHeaders().getFirst("Authorization"));
            exchange.getResponseHeaders().set("Content-Type","text/plain; charset=utf-8");
            exchange.sendResponseHeaders(200,webp.length);exchange.getResponseBody().write(webp);exchange.close();
        });server.start();
        try{
            var settings=new AppSettings(new MockEnvironment().withProperty("app.muse-base-url","http://127.0.0.1:"+server.getAddress().getPort()));
            var client=new MuseClient(settings,null,new MuseProvider(settings));
            var media=client.download(new MuseClient.Outcome("existing-task","completed","/v1/media/generated.webp",null,null),"image","test-only-key");
            assertEquals("image/webp",media.mime());assertArrayEquals(webp,media.bytes());
        }finally{server.stop(0);}
    }
    @Test void rejectsErrorPageEvenWhenItAdvertisesAnImageMimeType()throws Exception{
        byte[] html="<!doctype html><html>upstream error</html>".getBytes(StandardCharsets.UTF_8);
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/v1/media/fake.png",exchange->{
            exchange.getResponseHeaders().set("Content-Type","image/png");
            exchange.sendResponseHeaders(200,html.length);exchange.getResponseBody().write(html);exchange.close();
        });server.start();
        try{
            var settings=new AppSettings(new MockEnvironment().withProperty("app.muse-base-url","http://127.0.0.1:"+server.getAddress().getPort()));
            var client=new MuseClient(settings,null,new MuseProvider(settings));
            assertThrows(MuseClient.Rejected.class,()->client.download(new MuseClient.Outcome("task","completed","/v1/media/fake.png",null,null),"image","test-only-key"));
        }finally{server.stop(0);}
    }
    @Test void inlineMediaUsesActualFileTypeAndCannotHideAnErrorPage(){
        var settings=new AppSettings(new MockEnvironment());var client=new MuseClient(settings,null,new MuseProvider(settings));
        String webp="UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==";
        assertDoesNotThrow(()->assertEquals("image/webp",client.download(new MuseClient.Outcome(null,"completed",null,webp,null),"image","unused").mime()));
        String html=Base64.getEncoder().encodeToString("<html>not a generated image</html>".getBytes(StandardCharsets.UTF_8));
        assertThrows(MuseClient.Rejected.class,()->client.download(new MuseClient.Outcome(null,"completed",null,html,null),"image","unused"));
    }
}
