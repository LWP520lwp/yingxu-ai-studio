package cn.musecanvas.api;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/** Server-only credentials and capability discovery; never creates keys or opens account logins. */
@Component
public class MuseProvider {
    private final AppSettings settings;
    private final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).followRedirects(HttpClient.Redirect.NEVER).build();
    private volatile String cachedLocalKey="";
    private volatile Instant keyExpires=Instant.EPOCH;
    private volatile Instant modelsExpire=Instant.EPOCH;
    private volatile Map<String,Object> cachedModels=fallbackModels();
    private volatile String discovery="unavailable";
    private volatile String discoveryError=null;

    public MuseProvider(AppSettings settings){this.settings=settings;}
    public String baseUrl(){return settings.museBaseUrl();}
    public boolean localKeyEnabled(){
        if(!settings.museLocalKeyRequested()||!settings.localEnabled())return false;
        return validLocalPool(settings.museLocalPoolUrl(),baseUrl());
    }
    static boolean validLocalPool(String value,String generationBase){
        try{
            URI uri=URI.create(value);URI base=URI.create(generationBase);
            return Set.of("http","https").contains(uri.getScheme())&&uri.getHost()!=null
                &&Set.of("127.0.0.1","::1","[::1]").contains(uri.getHost().toLowerCase(java.util.Locale.ROOT))
                &&uri.getUserInfo()==null&&uri.getQuery()==null&&uri.getFragment()==null
                &&(uri.getPath()==null||uri.getPath().isBlank()||uri.getPath().equals("/"))
                &&MuseClient.origin(uri).equals(MuseClient.origin(base));
        }catch(RuntimeException e){return false;}
    }
    /** Do not expose this value through controller responses, browser settings or logs. */
    public String apiKey(){
        if(!settings.museKey().isBlank())return settings.museKey();
        if(!localKeyEnabled())return "";
        Instant now=Instant.now();if(now.isBefore(keyExpires))return cachedLocalKey;
        synchronized(this){
            if(Instant.now().isBefore(keyExpires))return cachedLocalKey;
            try{
                String local=settings.museLocalPoolUrl().replaceAll("/+$","");
                var response=client.send(HttpRequest.newBuilder(URI.create(local+"/admin/local-key")).timeout(Duration.ofSeconds(2)).header("Accept","application/json").GET().build(),HttpResponse.BodyHandlers.ofString());
                if(response.statusCode()!=200)throw new IllegalStateException("Local pool key unavailable");
                String key=MuseClient.text(Json.read(response.body()),"key");
                if(key==null||key.isBlank()||key.length()>2048)throw new IllegalStateException("Invalid local pool response");
                cachedLocalKey=key;keyExpires=Instant.now().plusSeconds(300);
            }catch(Exception e){cachedLocalKey="";keyExpires=Instant.now().plusSeconds(10);if(e instanceof InterruptedException)Thread.currentThread().interrupt();}
            return cachedLocalKey;
        }
    }
    public boolean enabled(){return !apiKey().isBlank();}
    public Map<String,Object> models(){
        Instant now=Instant.now();if(now.isBefore(modelsExpire))return cachedModels;
        synchronized(this){
            if(Instant.now().isBefore(modelsExpire))return cachedModels;
            String key=apiKey();
            if(key.isBlank()){cachedModels=fallbackModels();discovery="unavailable";discoveryError="生成池尚未配置可用凭据";modelsExpire=Instant.now().plusSeconds(10);return cachedModels;}
            try{
                var response=client.send(HttpRequest.newBuilder(URI.create(baseUrl()+"/v1/models")).timeout(Duration.ofSeconds(3)).header("Authorization","Bearer "+key).header("Accept","application/json").GET().build(),HttpResponse.BodyHandlers.ofString());
                if(response.statusCode()!=200)throw new IllegalStateException("模型目录返回 HTTP "+response.statusCode());
                var rows=Json.read(response.body()).path("data");if(!rows.isArray())throw new IllegalStateException("模型目录响应格式无效");
                var image=new ArrayList<Map<String,Object>>();var video=new ArrayList<Map<String,Object>>();
                for(var row:rows){String id=MuseClient.text(row,"id");if(id==null)continue;String kind=modelKind(id);if(kind==null)continue;var model=describe(id,true);if(kind.equals("image"))image.add(model);else video.add(model);}
                cachedModels=Map.of("image",List.copyOf(image),"video",List.copyOf(video));discovery="live";discoveryError=null;modelsExpire=Instant.now().plusSeconds(60);
            }catch(Exception e){cachedModels=fallbackModels();discovery="unavailable";discoveryError="暂时无法读取生成池模型目录，请检查本机生成池状态与凭据";modelsExpire=Instant.now().plusSeconds(10);if(e instanceof InterruptedException)Thread.currentThread().interrupt();}
            return cachedModels;
        }
    }
    public String importableLocalKey(){
        if(!settings.museLocalKeyRequested()||!validLocalPool(settings.museLocalPoolUrl(),baseUrl()))return "";
        synchronized(this){
            try{
                String local=settings.museLocalPoolUrl().replaceAll("/+$","");
                var response=client.send(HttpRequest.newBuilder(URI.create(local+"/admin/local-key")).timeout(Duration.ofSeconds(2)).header("Accept","application/json").GET().build(),HttpResponse.BodyHandlers.ofInputStream());
                if(response.statusCode()!=200)return "";
                String payload;
                try(var body=response.body()){byte[] bytes=body.readNBytes(8193);if(bytes.length>8192)return "";payload=new String(bytes,java.nio.charset.StandardCharsets.UTF_8);}
                String key=MuseClient.text(Json.read(payload),"key");
                return key!=null&&!key.isBlank()&&key.length()<=2048?key:"";
            }catch(InterruptedException e){Thread.currentThread().interrupt();return "";}catch(Exception e){return "";}
        }
    }
    public Map<String,Object> integration(){
        boolean ready=enabled();models();var result=new LinkedHashMap<String,Object>();result.put("name","MuseCanvas");result.put("enabled",ready);result.put("status",ready?"configured":(localKeyEnabled()?"local_key_unavailable":"missing_api_key"));result.put("localKeyEnabled",localKeyEnabled());result.put("credentialSource",!settings.museKey().isBlank()?"environment":ready?"local_pool":"none");result.put("modelDiscovery",discovery);result.put("error",discoveryError);result.put("description",ready?"模型目录来自当前生成池；账号登录、额度和人机验证请在流量池查看，发现模型不代表生成已验证":"配置服务端 MUSE_API_KEY，或在开发环境显式连接本机生成池");return result;
    }
    public void validate(JobService.Request request){
        validateShape(request);
        var candidates=models().get(request.kind());
        if(!(candidates instanceof List<?> list)||list.stream().noneMatch(item->item instanceof Map<?,?> m&&request.model().equals(m.get("id"))&&Boolean.TRUE.equals(m.get("available"))))throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"MODEL_UNAVAILABLE","当前生成池未发现此模型，请刷新目录或检查本机服务");
    }
    public void validateShape(JobService.Request request){
        String expected=modelKind(request.model());if(expected==null||!expected.equals(request.kind()))throw ApiException.invalid("所选模型不支持此类生成，请刷新模型列表");
        if(request.model().startsWith("doubao-")){
            if(!request.referenceAssetIds().isEmpty())throw ApiException.invalid("豆包生图和生视频暂不支持参考图，请移除参考素材");
            if(request.kind().equals("video")&&(request.duration()!=10||request.width()!=1280||request.height()!=720))throw ApiException.invalid("豆包视频固定为 10 秒、720p（1280×720），请调整生成参数");
        }
    }
    static String modelKind(String id){return switch(id){case "muse-image","doubao-image","muse-service-image"->"image";case "muse-video","doubao-video","muse-service-video"->"video";default->null;};}
    static Map<String,Object> describe(String id,boolean available){
        return describe(id,available,false);
    }
    static Map<String,Object> describe(String id,boolean available,boolean browser){
        boolean service=id.startsWith("muse-service-");boolean doubao=id.startsWith("doubao-");String kind=modelKind(id);boolean video="video".equals(kind);var caps=new LinkedHashMap<String,Object>();
        caps.put("supportsReferenceImages",!doubao);caps.put("maxReferenceImages",doubao?0:browser&&video?2:4);caps.put("fixedDuration",doubao&&video?10:null);caps.put("durations",doubao&&video?List.of(10):List.of());caps.put("resolutions",doubao&&video?List.of("720p"):List.of());caps.put("fixedWidth",doubao&&video?1280:null);caps.put("fixedHeight",doubao&&video?720:null);caps.put("supportsSizeControl",!doubao&&!browser);caps.put("watermark",doubao&&!video);caps.put("requiresInteractiveVerification",doubao||browser);
        caps.put("supportedVideoModes",!video?List.of():doubao?List.of("auto"):browser?List.of("auto","reference"):List.of("auto","reference","frames"));
        caps.put("maxFrameImages",video&&!doubao&&!browser?2:0);
        return Map.of("id",id,"name",(doubao?"豆包":service?"Muse 服务密钥通道":"Muse")+(video?" 视频":" 图像"),"provider",doubao?"doubao":service?"muse-service":"muse","available",available,"caps",caps);
    }
    private static Map<String,Object> fallbackModels(){return Map.of("image",List.of(describe("muse-image",false),describe("doubao-image",false)),"video",List.of(describe("muse-video",false),describe("doubao-video",false)));}
}
