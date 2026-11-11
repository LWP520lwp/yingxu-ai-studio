package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.URI;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Flow;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class ChannelClientTest {
    private static final String KEY="test-secret-never-returned";
    private static final byte[] PNG=Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=");
    private static final ChannelService.Channel CHANNEL=new ChannelService.Channel("id","owner","测试","https://provider.example/v1",true,"encrypted",List.of(new ChannelService.Model("sora-2","video"),new ChannelService.Model("gpt-image-1","image"),new ChannelService.Model("gpt-4.1","text")));
    private final List<HttpRequest> sent=new ArrayList<>();
    private final HttpClient http=mock(HttpClient.class);
    private final ChannelService service=mock(ChannelService.class);
    private ChannelClient client() {
        when(service.key(CHANNEL)).thenReturn(KEY);
        return new ChannelClient(new AppSettings(new MockEnvironment()),service,http,uri->{assertEquals("https",uri.getScheme());});
    }
    @SuppressWarnings("unchecked")
    private void responses(java.util.function.Function<HttpRequest,HttpResponse<InputStream>> response)throws Exception {
        doAnswer(invocation->{HttpRequest request=invocation.getArgument(0);sent.add(request);return response.apply(request);}).when(http).send(any(HttpRequest.class),any(HttpResponse.BodyHandler.class));
    }
    @SuppressWarnings("unchecked")
    private static HttpResponse<InputStream> response(int status,byte[] body,Map<String,List<String>> headers){
        HttpResponse<InputStream> response=mock(HttpResponse.class);when(response.statusCode()).thenReturn(status);when(response.body()).thenReturn(new ByteArrayInputStream(body));when(response.headers()).thenReturn(HttpHeaders.of(headers,(a,b)->true));return response;
    }
    private static HttpResponse<InputStream> json(String body){return response(200,body.getBytes(StandardCharsets.UTF_8),Map.of());}
    private static JobService.Request request(String kind){return new JobService.Request("p","n",kind,"sunlit scene","channel:id:model",1024,1024,8,List.of());}
    private static String body(HttpRequest request)throws Exception {
        var done=new CompletableFuture<byte[]>();var bytes=new java.io.ByteArrayOutputStream();
        request.bodyPublisher().orElseThrow().subscribe(new Flow.Subscriber<ByteBuffer>(){
            public void onSubscribe(Flow.Subscription s){s.request(Long.MAX_VALUE);}
            public void onNext(ByteBuffer b){byte[] part=new byte[b.remaining()];b.get(part);bytes.writeBytes(part);}
            public void onError(Throwable e){done.completeExceptionally(e);}
            public void onComplete(){done.complete(bytes.toByteArray());}
        });return new String(done.get(),StandardCharsets.UTF_8);
    }
    @Test void imageUsesCompatibleEndpointAndRealProviderModel()throws Exception {
        responses(r->json("{\"data\":[{\"b64_json\":\""+Base64.getEncoder().encodeToString(PNG)+"\"}]}"));
        var client=client();var route=new ChannelService.Route(CHANNEL,"gpt-image-1");var outcome=client.submit("job-key",route,request("image"));
        assertTrue(outcome.completed());assertArrayEquals(PNG,client.download(route,outcome,"image").bytes());
        assertEquals("/v1/images/generations",sent.getFirst().uri().getPath());assertEquals("POST",sent.getFirst().method());
        JsonNodeAssertions.assertField(body(sent.getFirst()),"model","gpt-image-1");
        assertEquals("Bearer "+KEY,sent.getFirst().headers().firstValue("Authorization").orElseThrow());
        assertEquals("job-key",sent.getFirst().headers().firstValue("Idempotency-Key").orElseThrow());
        assertEquals(1,sent.size());
    }
    @Test void videoUsesMultipartThenPollsAndDownloadsContentWithoutAnotherSubmission()throws Exception {
        responses(r->switch(r.uri().getPath()){
            case "/v1/videos" -> json("{\"id\":\"video_1\",\"status\":\"queued\"}");
            case "/v1/videos/video_1" -> json("{\"id\":\"video_1\",\"status\":\"completed\"}");
            default -> response(200,PNG,Map.of());
        });
        var client=client();var route=new ChannelService.Route(CHANNEL,"sora-2");var submitted=client.submit("video-job",route,request("video"));
        assertFalse(submitted.completed());assertEquals("video_1",submitted.taskId());
        var polled=client.poll(route,"video",submitted.taskId());assertTrue(polled.completed());assertEquals("https://provider.example/v1/videos/video_1/content",polled.url());
        assertTrue(sent.getFirst().headers().firstValue("Content-Type").orElseThrow().startsWith("multipart/form-data; boundary="));
        assertTrue(body(sent.getFirst()).contains("name=\"seconds\"\r\n\r\n8"));assertTrue(body(sent.getFirst()).contains("name=\"size\"\r\n\r\n1024x1024"));
        assertThrows(MuseClient.Rejected.class,()->client.download(route,polled,"video")); // PNG is never accepted as a video.
        assertEquals(1,sent.stream().filter(r->r.method().equals("POST")).count());assertEquals(3,sent.size());
    }
    @Test void arkUsesOfficialSeedanceTaskEndpointAndParsesTypedVideoContent()throws Exception {
        var ark=new ChannelService.Channel("ark-id","owner","豆包 Ark","https://ark.cn-beijing.volces.com/api/v3","ark",true,"encrypted",List.of(new ChannelService.Model("doubao-seedance-1-0-pro","video")));
        when(service.key(ark)).thenReturn(KEY);
        responses(r->switch(r.uri().getPath()){
            case "/api/v3/contents/generations/tasks" -> json("{\"id\":\"cgt_1\",\"status\":\"queued\"}");
            case "/api/v3/contents/generations/tasks/cgt_1" -> json("{\"id\":\"cgt_1\",\"status\":\"succeeded\",\"content\":[{\"type\":\"video\",\"video_url\":\"https://provider.example/generated.mp4\"}]}");
            default -> response(200,PNG,Map.of());
        });
        var client=new ChannelClient(new AppSettings(new MockEnvironment()),service,http,uri->{assertEquals("https",uri.getScheme());});
        var route=new ChannelService.Route(ark,"doubao-seedance-1-0-pro");
        var submitted=client.submit("ark-job",route,request("video"));
        assertEquals("cgt_1",submitted.taskId()); assertFalse(submitted.completed());
        var completed=client.poll(route,"video",submitted.taskId());
        assertTrue(completed.completed()); assertEquals("https://provider.example/generated.mp4",completed.url());
        assertEquals("/api/v3/contents/generations/tasks",sent.getFirst().uri().getPath());
        var payload=Json.read(body(sent.getFirst())); assertEquals("doubao-seedance-1-0-pro",payload.path("model").asString());
        assertEquals("text",payload.path("content").get(0).path("type").asString());
        assertEquals(8,payload.path("duration").asInt()); assertEquals("1:1",payload.path("ratio").asString());
    }
    @Test void publicMediaRedirectDoesNotReceiveProviderCredential()throws Exception {
        responses(r->r.uri().getHost().equals("provider.example")?response(302,new byte[0],Map.of("Location",List.of("https://cdn.example/image.png"))):response(200,PNG,Map.of()));
        var client=client();var route=new ChannelService.Route(CHANNEL,"gpt-image-1");
        var result=client.download(route,new MuseClient.Outcome(null,"completed","/generated.png",null,null),"image");assertEquals("image/png",result.mime());
        assertEquals("Bearer "+KEY,sent.getFirst().headers().firstValue("Authorization").orElseThrow());assertTrue(sent.get(1).headers().firstValue("Authorization").isEmpty());
    }
    @Test void providerErrorsAreSanitizedAndApiRedirectsAreNotFollowed()throws Exception {
        responses(r->response(401,KEY.getBytes(StandardCharsets.UTF_8),Map.of()));
        var client=client();var failure=assertThrows(MuseClient.Rejected.class,()->client.submit("job",new ChannelService.Route(CHANNEL,"gpt-image-1"),request("image")));
        assertTrue(failure.getMessage().contains("401"));assertFalse(failure.getMessage().contains(KEY));
        responses(r->response(302,new byte[0],Map.of("Location",List.of("https://other.example/v1/images/generations"))));
        assertThrows(MuseClient.Rejected.class,()->client.submit("job",new ChannelService.Route(CHANNEL,"gpt-image-1"),request("image")));
        assertEquals(2,sent.size());
    }
    @Test void discoveryDoesNotPretendTextModelsCanGenerateImages()throws Exception {
        responses(r->json("{\"data\":[{\"id\":\"gpt-4.1\"},{\"id\":\"gpt-image-1\"},{\"id\":\"sora-2\"}]}"));
        var models=client().models(CHANNEL);assertEquals(List.of("text","image","video"),models.stream().map(ChannelClient.DiscoveredModel::capability).toList());
        assertEquals("/v1/models",sent.getFirst().uri().getPath());
    }
    @Test void discoveryKeepsUnknownIdsAndDistinguishesSuggestionsFromConfirmedConfiguration()throws Exception {
        responses(r->json("{\"data\":[{\"id\":\"private-research-2026\"},{\"id\":\"gpt-4.1\"},{\"id\":\"new-image-2026\"},{\"id\":\"qwen2.5-vl-72b\"},{\"id\":\"private-research-2026\"},{\"id\":\"../unsafe\"}]}"));
        var models=client().models(CHANNEL);
        assertEquals(4,models.size());
        assertEquals(new ChannelClient.DiscoveredModel("private-research-2026","unknown","unknown",true),models.get(0));
        assertEquals(new ChannelClient.DiscoveredModel("gpt-4.1","text","configured",false),models.get(1));
        assertEquals("unknown",models.get(2).capability()); // A word in a private alias is not a declared output type.
        assertEquals("vision",models.get(3).capability());assertEquals("name-hint",models.get(3).source());assertTrue(models.get(3).requiresConfirmation());
        assertFalse(Json.write(models).contains(KEY));
    }
    @Test void discoveryUsesExplicitProviderMetadataButStillRequiresUserConfirmation()throws Exception {
        responses(r->json("{\"data\":[{\"id\":\"multimodal-private\",\"capabilities\":[\"text\",\"vision\"]},{\"id\":\"render-private\",\"capability\":\"video\"},{\"id\":\"ambiguous-private\",\"capabilities\":[\"image\",\"video\"]}]}"));
        var models=client().models(CHANNEL);
        assertEquals(List.of("vision","video","unknown"),models.stream().map(ChannelClient.DiscoveredModel::capability).toList());
        assertEquals("provider",models.getFirst().source());assertTrue(models.stream().allMatch(ChannelClient.DiscoveredModel::requiresConfirmation));
    }
    @Test void textPlanUsesOneBoundedTextRequestWithoutMediaOrTools()throws Exception {
        String plan="{\"title\":\"科学讲解\",\"scenes\":[]}";
        responses(r->json(Json.write(Map.of("choices",List.of(Map.of("message",Map.of("content",plan)))))));
        var result=client().textPlan(new ChannelService.Route(CHANNEL,"gpt-4.1"),"constrained science system","user command");
        assertEquals(plan,result);assertEquals(1,sent.size());
        var request=sent.getFirst();assertEquals("/v1/chat/completions",request.uri().getPath());assertEquals("POST",request.method());
        assertEquals(java.time.Duration.ofSeconds(45),request.timeout().orElseThrow());
        assertEquals("Bearer "+KEY,request.headers().firstValue("Authorization").orElseThrow());
        var payload=Json.read(body(request));assertEquals("gpt-4.1",payload.path("model").asString());
        assertEquals("json_object",payload.path("response_format").path("type").asString());
        assertEquals("constrained science system",payload.path("messages").get(0).path("content").asString());
        assertFalse(payload.has("tools"));assertFalse(payload.has("files"));assertFalse(payload.has("media"));
    }
    @Test void textPlanRejectsWrongCapabilityBeforeTransportAndSanitizesFailures()throws Exception {
        var client=client();
        assertThrows(ApiException.class,()->client.textPlan(new ChannelService.Route(CHANNEL,"gpt-image-1"),"system","instruction"));
        assertTrue(sent.isEmpty());
        responses(r->response(401,KEY.getBytes(StandardCharsets.UTF_8),Map.of()));
        var error=assertThrows(ApiException.class,()->client.textPlan(new ChannelService.Route(CHANNEL,"gpt-4.1"),"system","instruction"));
        assertFalse(error.getMessage().contains(KEY));assertEquals(1,sent.size());
        responses(r->response(302,new byte[0],Map.of("Location",List.of("https://other.example/v1/chat/completions"))));
        assertThrows(ApiException.class,()->client.textPlan(new ChannelService.Route(CHANNEL,"gpt-4.1"),"system","instruction"));
        assertEquals(2,sent.size()); // Neither failure is retried and the redirect target is never contacted.
    }
    @Test void rejectsPrivateTargetsAndPathTraversalWithoutNetworkRequests()throws Exception {
        for(String target:List.of("http://public.example/a","https://127.0.0.1/a","https://169.254.169.254/latest/meta-data","https://10.0.0.1/a","https://localhost/a","https://service.internal/a","https://user:pass@provider.example/a","https://provider.example:3308/a","file:///secret"))
            assertThrows(MuseClient.Rejected.class,()->ChannelClient.validatePublic(URI.create(target)),target);
        assertDoesNotThrow(()->ChannelClient.validatePublic(URI.create("https://1.1.1.1/a")));
        for(String id:List.of("../admin","..","a/b","a?key=x","a\r\nheader"))assertThrows(MuseClient.Rejected.class,()->ChannelClient.safeId(id));
        assertEquals("https://provider.example/v1/models",ChannelClient.endpoint("https://provider.example/v1/","/models").toString());
        assertEquals("https://provider.example/v1/models",ChannelClient.endpoint("https://provider.example/","/models").toString());
        assertTrue(ChannelClient.parseOutcome(Json.read("{\"error\":{\"message\":\"private upstream body\"}}")).failed());
    }
    private static class JsonNodeAssertions {static void assertField(String body,String field,String expected){assertEquals(expected,Json.read(body).path(field).asString());}}
}
