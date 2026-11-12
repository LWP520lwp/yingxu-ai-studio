package cn.musecanvas.api;

import java.io.InputStream;
import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

@Component
public class MuseClient {
    public record Outcome(String taskId,String status,String url,String base64,String error) {
        public boolean completed(){return List.of("succeeded","completed","success","done").contains(status);}
        public boolean failed(){return List.of("failed","error","cancelled","canceled").contains(status);}
    }
    public record Media(byte[] bytes,String mime) {}
    public static class Rejected extends RuntimeException {public Rejected(String message){super(message);}}
    /** Explicit pre-acceptance HTTP rejection; unlike an I/O timeout it is safe to mark failed. */
    public static class RequestRejected extends Rejected {public RequestRejected(String message){super(message);}}
    private final AppSettings settings;
    private final AssetService assets;
    private final MuseProvider provider;
    private final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).build();
    public MuseClient(AppSettings settings,AssetService assets,MuseProvider provider){this.settings=settings;this.assets=assets;this.provider=provider;}
    public String completeText(String system,String input,int maxTokens,String apiKey)throws Exception{
        var payload=Map.of("model","muse-spark","messages",List.of(Map.of("role","system","content",system),Map.of("role","user","content",input)),"stream",false,"temperature",0.1,"max_tokens",maxTokens,"response_format",Map.of("type","json_object"));
        var request=HttpRequest.newBuilder(URI.create(settings.museBaseUrl()+"/v1/chat/completions"))
            .timeout(Duration.ofSeconds(90)).header("Authorization","Bearer "+apiKey).header("Accept","application/json").header("Content-Type","application/json")
            .POST(HttpRequest.BodyPublishers.ofString(Json.write(payload))).build();
        var response=client.send(request,HttpResponse.BodyHandlers.ofInputStream());
        try(var in=response.body()){
            check(response.statusCode(),false);
            byte[] bytes=in.readNBytes(2*1024*1024+1);if(bytes.length>2*1024*1024)throw new Rejected("Muse 文本响应过大");
            var raw=Json.read(new String(bytes,java.nio.charset.StandardCharsets.UTF_8));
            var choices=raw.path("choices");String content=choices.isArray()&&!choices.isEmpty()?text(choices.get(0).path("message"),"content"):null;
            if(content==null||content.isBlank()||content.length()>120000)throw new Rejected("Muse 未返回有效的文本规划");
            return MuseTextResponse.normalize(content,system);
        }
    }
    public Outcome submit(String jobId,String owner,JobService.Request request)throws Exception{
        return submit(jobId,owner,request,provider.apiKey());
    }
    public Outcome submit(String jobId,String owner,JobService.Request request,String apiKey)throws Exception{
        var body=new LinkedHashMap<String,Object>();body.put("model",request.model());body.put("prompt",request.prompt());
        String endpoint;
        if(request.kind().equals("image")){
            List<String> references=new ArrayList<>();for(String id:request.referenceAssetIds())references.add(assets.referenceDataUrl(owner,id));
            endpoint="/v1/images/tasks";body.put("n",1);body.put("size",request.width()+"x"+request.height());body.put("aspect_ratio",ratio(request.width(),request.height()));body.put("response_format","url");body.put("async",true);body.put("timeout",Math.min(600,settings.providerTimeout()));
            if(!references.isEmpty())body.put("images",references);
        }else{
            endpoint="/v1/videos";body.put("duration",request.duration());body.put("size",ratio(request.width(),request.height()));body.put("generate_audio",true);
        }
        HttpRequest req;
        if(request.kind().equals("video")&&!request.referenceAssetIds().isEmpty()){
            String boundary="Workbench"+UUID.randomUUID().toString().replace("-","");
            byte[] multipart=videoMultipart(owner,request,boundary);
            req=authorized(URI.create(settings.museBaseUrl()+endpoint),apiKey).header("Content-Type","multipart/form-data; boundary="+boundary).header("Idempotency-Key",jobId).POST(HttpRequest.BodyPublishers.ofByteArray(multipart)).build();
        }else req=authorized(URI.create(settings.museBaseUrl()+endpoint),apiKey).header("Content-Type","application/json").header("Idempotency-Key",jobId).POST(HttpRequest.BodyPublishers.ofString(Json.write(body))).build();
        return parse(requestJson(req,false));
    }
    private byte[] videoMultipart(String owner,JobService.Request request,String boundary)throws Exception{
        var out=new java.io.ByteArrayOutputStream();
        String mode=videoMode(request);
        var fields=new LinkedHashMap<String,String>();fields.put("model",request.model());fields.put("prompt",request.prompt());fields.put("seconds",String.valueOf(request.duration()));fields.put("size",request.width()+"x"+request.height());fields.put("ratio",ratio(request.width(),request.height()));fields.put("resolution_name",request.height()>720?"1080p":"720p");fields.put("mode",mode);fields.put("watermark","false");fields.put("generate_audio","true");
        for(var field:fields.entrySet())out.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\""+field.getKey()+"\"\r\n\r\n"+field.getValue()+"\r\n").getBytes(java.nio.charset.StandardCharsets.UTF_8));
        for(int i=0;i<request.referenceAssetIds().size();i++){
            String data=assets.referenceDataUrl(owner,request.referenceAssetIds().get(i));int comma=data.indexOf(',');String mime=data.substring(5,data.indexOf(';'));
            String field=mode.equals("frames")?(i==0?"first_frame":"last_frame"):"image[]";
            out.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\""+field+"\"; filename=\"reference"+i+AssetService.extension(mime)+"\"\r\nContent-Type: "+mime+"\r\n\r\n").getBytes(java.nio.charset.StandardCharsets.UTF_8));
            out.write(Base64.getDecoder().decode(data.substring(comma+1)));out.write("\r\n".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }
        out.write(("--"+boundary+"--\r\n").getBytes(java.nio.charset.StandardCharsets.UTF_8));return out.toByteArray();
    }
    static String videoMode(JobService.Request request){
        return "frames".equals(request.videoMode())?"frames":"reference";
    }
    public Outcome poll(String kind,String taskId)throws Exception{
        return poll(kind,taskId,provider.apiKey());
    }
    public Outcome poll(String kind,String taskId,String apiKey)throws Exception{
        String safe=java.net.URLEncoder.encode(taskId,java.nio.charset.StandardCharsets.UTF_8).replace("+","%20");
        String endpoint=kind.equals("image")?"/v1/images/tasks/":"/v1/videos/";
        Outcome outcome=parse(requestJson(authorized(URI.create(settings.museBaseUrl()+endpoint+safe),apiKey).GET().build(),true));
        if(outcome.completed()&&outcome.url()==null&&outcome.base64()==null&&kind.equals("video"))return new Outcome(taskId,outcome.status(),settings.museBaseUrl()+"/v1/videos/"+safe+"/content",null,null);
        return outcome;
    }
    private HttpRequest.Builder authorized(URI uri){return HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(settings.providerTimeout())).header("Authorization","Bearer "+provider.apiKey()).header("Accept","application/json");}
    private HttpRequest.Builder authorized(URI uri,String apiKey){return HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(settings.providerTimeout())).header("Authorization","Bearer "+apiKey).header("Accept","application/json");}
    private JsonNode requestJson(HttpRequest request,boolean polling)throws Exception{
        var response=client.send(request,HttpResponse.BodyHandlers.ofInputStream());
        try(var body=response.body()){
            check(response.statusCode(),polling);
            byte[] bytes=body.readNBytes(2*1024*1024+1);if(bytes.length>2*1024*1024)throw new Rejected("Muse 任务响应超过大小上限，请核对上游任务状态");
            return Json.read(new String(bytes,java.nio.charset.StandardCharsets.UTF_8));
        }
    }
    private void check(int status,boolean retryableOperation){
        if(status>=200&&status<300)return;
        if(status==429&&retryableOperation)throw new IllegalStateException("Muse 轮询或资源下载限流，请稍后重试");
        if(status==408)throw new IllegalStateException("Muse 请求超时，是否已受理需要核对");
        if(status>=400&&status<500)throw new RequestRejected("Muse 请求被拒绝（HTTP "+status+"）"+(status==401||status==403?"，请检查服务端 API 密钥与权限":status==429?"，当前请求受到限流或额度限制，请稍后再试":""));
        throw new IllegalStateException("Muse 暂不可用（HTTP "+status+"）");
    }
    static Outcome parse(JsonNode raw){
        JsonNode node=raw;
        if(raw.has("code")&&raw.path("code").asInt()!=0)return new Outcome(text(raw,"task_id","id"),"failed",null,null,providerError(raw));
        if(raw.path("data").isObject())node=raw.path("data");
        String task=text(node,"task_id","id");String status=text(node,"status","state");String url=text(node,"url","video_url","result_url");String b64=text(node,"b64_json");
        if(url==null)url=text(node.path("result"),"url","video_url");if(url==null)url=text(node.path("content"),"url","video_url");
        // Ark Seedance returns content as an array of typed media blocks in some
        // API versions (for example [{"type":"video","video_url":"..."}]).
        // Accept that documented shape while keeping the existing provider shapes.
        if(url==null&&node.path("content").isArray())for(JsonNode part:node.path("content")){
            url=text(part,"url","video_url","image_url","uri");
            if(url==null)url=text(part.path("video_url"),"url","uri");
            if(url==null)url=text(part.path("image_url"),"url","uri");
            if(url!=null)break;
        }
        for(String field:List.of("data","images","results")){
            JsonNode array=node.path(field);if(array.isArray()&&!array.isEmpty()){
                JsonNode first=array.get(0);if(first.isString())url=first.asString();else{if(url==null)url=text(first,"url","image_url");if(b64==null)b64=text(first,"b64_json");}
                break;
            }
        }
        if(status==null)status=(url!=null||b64!=null)?"completed":"queued";
        String error=null;if(node.has("error")&&!node.path("error").isNull())error=providerError(node);
        return new Outcome(task,status.toLowerCase(java.util.Locale.ROOT),url,b64,error);
    }
    static String providerError(JsonNode node){
        String message=text(node,"error","message","detail");if(message==null)message=text(node.path("error"),"message","code","type");
        String value=message==null?"":message.toLowerCase(java.util.Locale.ROOT);
        // Classify known failures without returning arbitrary upstream bodies, URLs or credentials.
        if(value.matches("(?s).*(timeout|timed.out|超时).*"))return "Muse 上游生成超时；请检查原任务记录后再决定是否重新生成，系统不会自动重复扣费请求";
        if(value.matches("(?s).*(quota|credit|余额|额度).*"))return "Muse 账号额度不足或暂不可用，请查看账号池剩余额度";
        if(value.matches("(?s).*(rate.limit|too.many|限流|频繁).*"))return "Muse 当前受到限流，请稍后重试";
        if(value.matches("(?s).*(unauth|forbid|expired|login|登录|过期).*"))return "Muse 登录或服务凭据已失效，请在账号池检查账号";
        if(value.matches("(?s).*(moderation|content.policy|safety|违规|敏感).*"))return "Muse 未通过内容审核，请调整提示词或参考图片";
        return "Muse 任务失败，请调整提示词或检查上游任务日志";
    }
    static String text(JsonNode node,String...fields){for(String f:fields){JsonNode n=node.path(f);if(n.isString()&&!n.asString().isBlank())return n.asString();}return null;}
    public Media download(Outcome outcome,String kind)throws Exception{
        return download(outcome,kind,provider.apiKey());
    }
    public Media download(Outcome outcome,String kind,String apiKey)throws Exception{
        if(outcome.base64()!=null){String b64=outcome.base64();int comma=b64.indexOf(',');if(b64.startsWith("data:")&&comma>=0)b64=b64.substring(comma+1);if(b64.length()>AssetService.MAX_BYTES*4/3+10)throw new Rejected("生成资源超过 100MB");byte[] bytes=Base64.getDecoder().decode(b64);return new Media(bytes,AssetService.generatedMime(kind,bytes));}
        if(outcome.url()==null)throw new Rejected("Muse 已完成任务，但没有返回可读取的生成资源");
        URI base=URI.create(settings.museBaseUrl());URI uri=canonicalPoolUri(base.resolve(outcome.url()),base);
        for(int redirect=0;redirect<4;redirect++){
            validateDownloadUri(uri,base,settings.museMediaAllowedHosts());
            boolean same=origin(uri).equals(origin(base));
            var builder=same?authorized(uri,apiKey):HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(settings.providerTimeout()));
            var response=client.send(builder.GET().build(),HttpResponse.BodyHandlers.ofInputStream());
            try(InputStream in=response.body()){
                if(List.of(301,302,303,307,308).contains(response.statusCode())){String location=response.headers().firstValue("Location").orElseThrow(()->new Rejected("资源重定向地址缺失"));uri=canonicalPoolUri(uri.resolve(location),base);continue;}
                check(response.statusCode(),true);
                byte[] bytes=in.readNBytes((int)AssetService.MAX_BYTES+1);if(bytes.length>AssetService.MAX_BYTES)throw new Rejected("生成资源超过 100MB");
                // Some Muse pool builds serve valid WebP files as text/plain. The
                // media signature is authoritative; HTML/JSON still fail validation.
                return new Media(bytes,AssetService.generatedMime(kind,bytes));
            }
        }
        throw new Rejected("资源重定向次数过多");
    }
    static String origin(URI uri){return uri.getScheme()+"://"+uri.getHost()+":"+(uri.getPort()==-1?("https".equals(uri.getScheme())?443:80):uri.getPort());}
    static URI canonicalPoolUri(URI uri,URI configuredBase){
        Set<String> loopback=Set.of("127.0.0.1","localhost","::1","[::1]");
        if(uri.getHost()!=null&&configuredBase.getHost()!=null&&uri.getUserInfo()==null
            &&loopback.contains(uri.getHost().toLowerCase(java.util.Locale.ROOT))&&loopback.contains(configuredBase.getHost().toLowerCase(java.util.Locale.ROOT))
            &&java.util.Objects.equals(uri.getScheme(),configuredBase.getScheme())
            &&effectivePort(uri)==effectivePort(configuredBase)){
            return URI.create(configuredBase.getScheme()+"://"+configuredBase.getRawAuthority()+(uri.getRawPath()==null?"":uri.getRawPath())+(uri.getRawQuery()==null?"":"?"+uri.getRawQuery()));
        }
        return uri;
    }
    private static int effectivePort(URI uri){return uri.getPort()==-1?("https".equals(uri.getScheme())?443:80):uri.getPort();}
    static void validateDownloadUri(URI uri,URI configuredBase)throws Exception{
        validateDownloadUri(uri,configuredBase,java.util.Set.of());
    }
    static void validateDownloadUri(URI uri,URI configuredBase,java.util.Set<String> allowedHosts)throws Exception{
        if(!List.of("http","https").contains(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null)throw new Rejected("上游返回非法资源地址");
        if(origin(uri).equals(origin(configuredBase)))return;
        String host=uri.getHost().toLowerCase(java.util.Locale.ROOT);
        if(!allowedHosts.contains(host))throw new Rejected("媒体域名尚未授权，请管理员在 MUSE_MEDIA_ALLOWED_HOSTS 配置可信 CDN 域名："+host);
        if(!"https".equals(uri.getScheme())||(uri.getPort()!=-1&&uri.getPort()!=443))throw new Rejected("外部媒体只允许 HTTPS 443");
        for(InetAddress address:InetAddress.getAllByName(uri.getHost()))if(!publicAddress(address))throw new Rejected("上游资源地址指向非公开网络");
    }
    static boolean publicAddress(InetAddress address){
        if(address.isAnyLocalAddress()||address.isLoopbackAddress()||address.isSiteLocalAddress()||address.isLinkLocalAddress()||address.isMulticastAddress())return false;
        byte[] b=address.getAddress();int a=b[0]&255,c=b[1]&255;
        if(b.length==4){
            int d=b[2]&255;
            return !(a==0||a==10||a==127||a>=224||(a==100&&c>=64&&c<=127)||(a==169&&c==254)||(a==172&&c>=16&&c<=31)||(a==192&&(c==168||(c==0&&(d==0||d==2))||(c==88&&d==99)))||(a==198&&(c==18||c==19||(c==51&&d==100)))||(a==203&&c==0&&d==113));
        }
        // Only global unicast; exclude documentation, Teredo and 6to4 transition ranges.
        return (a&224)==32&&!(a==32&&c==2)&&!(a==32&&c==1&&((b[2]&255)<=1||((b[2]&255)==13&&(b[3]&255)==184)))&&!(a==63&&c==255&&(b[2]&240)==0);
    }
    static String ratio(int w,int h){int a=w,b=h;while(b!=0){int t=a%b;a=b;b=t;}return (w/a)+":"+(h/a);}
}
