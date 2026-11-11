package cn.musecanvas.api;

import java.io.InputStream;
import java.net.InetAddress;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

/** OpenAI-compatible generation transport; API credentials never reach the browser or other origins. */
@Component
public class ChannelClient {
    public record DiscoveredModel(String name,String capability,String source,boolean requiresConfirmation) {}
    @FunctionalInterface interface UriPolicy { void check(URI uri) throws Exception; }
    private final AppSettings settings;
    private final ChannelService channels;
    private final HttpClient http;
    private final UriPolicy policy;
    @Autowired
    public ChannelClient(AppSettings settings,ChannelService channels){
        this(settings,channels,HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).build(),ChannelClient::validatePublic);
    }
    // Test transport injection is deliberately not configurable through properties or a user channel.
    ChannelClient(AppSettings settings,ChannelService channels,HttpClient http,UriPolicy policy){this.settings=settings;this.channels=channels;this.http=http;this.policy=policy;}

    public List<DiscoveredModel> models(ChannelService.Channel channel){
        try{
            HttpRequest directoryRequest=send(channel,endpoint(channel.baseUrl(),"/models"),"GET",null,null);
            var bounded=HttpRequest.newBuilder(directoryRequest.uri()).timeout(Duration.ofSeconds(20));
            directoryRequest.headers().map().forEach((name,values)->values.forEach(value->bounded.header(name,value)));
            JsonNode raw=json(bounded.GET().build(),2*1024*1024);
            if(!raw.path("data").isArray())throw new IllegalStateException("Invalid model directory");
            var models=new ArrayList<DiscoveredModel>();var names=new HashSet<String>();
            for(JsonNode item:raw.path("data")){
                String id=MuseClient.text(item,"id","name");
                if(id==null||!id.matches("[a-zA-Z0-9][a-zA-Z0-9._/-]{0,63}")||!names.add(id))continue;
                var configured=channel.models().stream().filter(model->model.name().equals(id)).findFirst();
                String metadata=explicitCapability(item);
                String hint=guessCapability(id);
                String capability=configured.map(ChannelService.Model::capability).orElse(metadata!=null?metadata:hint!=null?hint:"unknown");
                String source=configured.isPresent()?"configured":metadata!=null?"provider":hint!=null?"name-hint":"unknown";
                models.add(new DiscoveredModel(id,capability,source,configured.isEmpty()));
                if(models.size()>=100)break;
            }
            return List.copyOf(models);
        }catch(MuseClient.Rejected e){throw ApiException.invalid(e.getMessage());}
        catch(InterruptedException interrupted){Thread.currentThread().interrupt();throw ApiException.invalid("获取模型已中断，请重试");}
        catch(Exception e){throw ApiException.invalid("无法获取渠道模型，请检查公网地址、API Key 和 OpenAI 兼容协议");}
    }

    private static String explicitCapability(JsonNode item){
        String direct=MuseClient.text(item,"capability");
        if(direct!=null&&ChannelService.CAPABILITIES.contains(direct))return direct;
        var declared=new HashSet<String>();
        JsonNode capabilities=item.path("capabilities");
        if(capabilities.isArray())for(JsonNode entry:capabilities){String value=entry.isString()?entry.asString():"";if(ChannelService.CAPABILITIES.contains(value))declared.add(value);}
        else if(capabilities.isObject())for(String capability:ChannelService.CAPABILITIES)if(capabilities.path(capability).isBoolean()&&capabilities.path(capability).asBoolean())declared.add(capability);
        // A vision model also accepts text; incompatible multiple output roles require user confirmation.
        if(declared.contains("vision")&&declared.stream().allMatch(role->Set.of("text","vision").contains(role)))return "vision";
        return declared.size()==1?declared.iterator().next():null;
    }

    /** Makes one text-planning call. Never sends media, tools, files or provider response bodies to clients. */
    public String textPlan(ChannelService.Route route,String system,String instruction){
        if(route.channel().models().stream().noneMatch(model->model.name().equals(route.model())&&"text".equals(model.capability())))
            throw ApiException.invalid("请选择此渠道中已配置的文本模型");
        try{
            var payload=Map.of("model",route.model(),"messages",List.of(Map.of("role","system","content",system),Map.of("role","user","content",instruction)),"temperature",0.1,"max_tokens",2400,"response_format",Map.of("type","json_object"));
            HttpRequest request=send(route.channel(),endpoint(route.channel().baseUrl(),"/chat/completions"),"POST","application/json",Json.write(payload).getBytes(StandardCharsets.UTF_8));
            // A planning request must not monopolize a generation transport timeout.
            var builder=HttpRequest.newBuilder(request.uri()).timeout(Duration.ofSeconds(45));
            request.headers().map().forEach((name,values)->values.forEach(value->builder.header(name,value)));
            JsonNode response=json(builder.POST(request.bodyPublisher().orElseThrow()).build(),2*1024*1024);
            JsonNode choices=response.path("choices");
            String content=choices.isArray()&&!choices.isEmpty()?MuseClient.text(choices.get(0).path("message"),"content"):null;
            if(content==null||content.isBlank()||content.length()>30000)throw new IllegalStateException("Invalid planning content");
            return content;
        }catch(InterruptedException interrupted){Thread.currentThread().interrupt();throw ApiException.invalid("文本规划已中断，请重新提交一次指令");}
        catch(Exception unavailable){throw ApiException.invalid("文本规划模型暂不可用，请检查渠道、模型权限和 JSON 输出兼容性；草稿未发生变化");}
    }

    public MuseClient.Outcome submit(String jobId,ChannelService.Route route,JobService.Request request)throws Exception{
        // Recheck ownership/capability in the runner before calling this transport.
        if(!request.referenceAssetIds().isEmpty())throw new MuseClient.Rejected("自建渠道暂不支持参考图");
        HttpRequest httpRequest;
        if(request.kind().equals("image")){
            var body=Map.of("model",route.model(),"prompt",request.prompt(),"n",1,"size",request.width()+"x"+request.height());
            httpRequest=send(route.channel(),endpoint(route.channel().baseUrl(),"/images/generations"),"POST","application/json",Json.write(body).getBytes(StandardCharsets.UTF_8),jobId);
        }else{
            if("ark".equals(route.channel().apiFormat())){
                // Volcengine Ark's official Seedance endpoint is JSON and returns an
                // asynchronous task. Keep this adapter explicit so generic OpenAI
                // /videos providers continue to use their existing multipart shape.
                var body=arkVideoBody(route.model(),request);
                httpRequest=send(route.channel(),endpoint(route.channel().baseUrl(),"/contents/generations/tasks"),"POST","application/json",Json.write(body).getBytes(StandardCharsets.UTF_8),jobId);
            }else{
                String boundary="Workbench"+UUID.randomUUID().toString().replace("-","");
                byte[] body=videoBody(boundary,route.model(),request);
                httpRequest=send(route.channel(),endpoint(route.channel().baseUrl(),"/videos"),"POST","multipart/form-data; boundary="+boundary,body,jobId);
            }
        }
        return parseOutcome(json(httpRequest,request.kind().equals("image")?(int)(AssetService.MAX_BYTES*4/3+1024*1024):2*1024*1024));
    }

    public MuseClient.Outcome poll(ChannelService.Route route,String kind,String taskId)throws Exception{
        if(!"video".equals(kind))throw new MuseClient.Rejected("兼容图片接口没有返回同步结果，请核对供应商任务");
        URI target=endpoint(route.channel().baseUrl(),("ark".equals(route.channel().apiFormat())?"/contents/generations/tasks/":"/videos/")+safeId(taskId));
        MuseClient.Outcome result=parseOutcome(json(send(route.channel(),target,"GET",null,null),2*1024*1024));
        if(result.completed()&&result.url()==null&&result.base64()==null)return new MuseClient.Outcome(taskId,result.status(),target+("ark".equals(route.channel().apiFormat())?"":"/content"),null,result.error());
        return result;
    }

    public MuseClient.Media download(ChannelService.Route route,MuseClient.Outcome outcome,String kind)throws Exception{
        if(outcome.base64()!=null){
            String value=outcome.base64();if(value.startsWith("data:")){int comma=value.indexOf(',');if(comma<0)throw new MuseClient.Rejected("上游媒体编码无效");value=value.substring(comma+1);}
            if(value.length()>AssetService.MAX_BYTES*4/3+10)throw new MuseClient.Rejected("生成资源超过 100MB");
            byte[] bytes;try{bytes=Base64.getDecoder().decode(value);}catch(IllegalArgumentException e){throw new MuseClient.Rejected("上游媒体编码无效");}
            if(bytes.length>AssetService.MAX_BYTES)throw new MuseClient.Rejected("生成资源超过 100MB");
            return new MuseClient.Media(bytes,AssetService.generatedMime(kind,bytes));
        }
        if(outcome.url()==null)throw new MuseClient.Rejected("上游已完成任务，但没有返回媒体资源");
        URI base=URI.create(route.channel().baseUrl());URI uri=base.resolve(outcome.url());
        for(int attempt=0;attempt<4;attempt++){
            policy.check(uri);
            HttpRequest.Builder builder=HttpRequest.newBuilder(uri).timeout(timeout());
            if(MuseClient.origin(base).equals(MuseClient.origin(uri)))builder.header("Authorization","Bearer "+channels.key(route.channel()));
            HttpResponse<InputStream> response=http.send(builder.GET().build(),HttpResponse.BodyHandlers.ofInputStream());
            try(InputStream in=response.body()){
                if(List.of(301,302,303,307,308).contains(response.statusCode())){
                    String location=response.headers().firstValue("Location").orElseThrow(()->new MuseClient.Rejected("上游资源重定向地址缺失"));
                    uri=uri.resolve(location);continue;
                }
                checkStatus(response.statusCode());
                byte[] bytes=readLimited(in,(int)AssetService.MAX_BYTES,"生成资源超过 100MB");
                return new MuseClient.Media(bytes,AssetService.generatedMime(kind,bytes));
            }
        }
        throw new MuseClient.Rejected("上游资源重定向次数过多");
    }

    private HttpRequest send(ChannelService.Channel channel,URI uri,String method,String contentType,byte[] body)throws Exception{return send(channel,uri,method,contentType,body,null);}
    private HttpRequest send(ChannelService.Channel channel,URI uri,String method,String contentType,byte[] body,String jobId)throws Exception{
        policy.check(uri);
        if(!MuseClient.origin(URI.create(channel.baseUrl())).equals(MuseClient.origin(uri)))throw new MuseClient.Rejected("渠道请求地址发生变化，未发送凭证");
        var builder=HttpRequest.newBuilder(uri).timeout(timeout()).header("Authorization","Bearer "+channels.key(channel)).header("Accept","application/json");
        if(contentType!=null)builder.header("Content-Type",contentType);
        if(jobId!=null)builder.header("Idempotency-Key",jobId);
        return builder.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofByteArray(body)).build();
    }
    private JsonNode json(HttpRequest request,int maxBytes)throws Exception{
        HttpResponse<InputStream> response=http.send(request,HttpResponse.BodyHandlers.ofInputStream());
        try(InputStream in=response.body()){
            checkStatus(response.statusCode());
            return Json.read(new String(readLimited(in,maxBytes,"上游响应超过允许大小"),StandardCharsets.UTF_8));
        }
    }
    private Duration timeout(){return Duration.ofSeconds(Math.min(300,Math.max(10,settings.providerTimeout())));}
    private static byte[] readLimited(InputStream in,int limit,String message)throws Exception{byte[] bytes=in.readNBytes(limit+1);if(bytes.length>limit)throw new MuseClient.Rejected(message);return bytes;}
    private static void checkStatus(int status){
        if(status>=200&&status<300)return;
        if(status>=300&&status<400)throw new MuseClient.Rejected("渠道 API 不允许重定向，请填写最终接口地址");
        if(status>=400&&status<500&&status!=429)throw new MuseClient.Rejected("渠道请求被拒绝（HTTP "+status+"），请检查模型、权限和参数");
        throw new IllegalStateException("渠道暂不可用（HTTP "+status+"）");
    }
    static MuseClient.Outcome parseOutcome(JsonNode raw){var parsed=MuseClient.parse(raw);return new MuseClient.Outcome(parsed.taskId(),parsed.error()==null?parsed.status():"failed",parsed.url(),parsed.base64(),parsed.error()==null?null:"渠道任务失败，请核对上游生成历史");}
    static URI endpoint(String base,String path){String value=base.replaceAll("/+$","");return URI.create(value+(value.endsWith("/v1")||value.endsWith("/api/v3")?"":"/v1")+path);}
    static String safeId(String value){if(value==null||!value.matches("[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}"))throw new MuseClient.Rejected("上游任务标识无效");return URLEncoder.encode(value,StandardCharsets.UTF_8).replace("+","%20");}
    static String guessCapability(String name){
        if(name==null)return null;
        String id=name.toLowerCase(Locale.ROOT);
        if(List.of("video","sora","veo","kling","seedance","hailuo").stream().anyMatch(id::contains)||id.matches("(?:.*/)?wan[-0-9].*"))return "video";
        if(List.of("dall-e","dalle","seedream","flux","imagen","sdxl","stable-diffusion").stream().anyMatch(id::contains)||id.matches("(?:.*/)?(?:gpt-image|image)[-0-9].*"))return "image";
        if(id.contains("vision")||id.matches(".*(?:^|[-_./])vl(?:$|[-_./]).*"))return "vision";
        if(id.matches("(?:gpt-[0-9].*|chatgpt-.*|o[134](?:[-.].*)?|claude[-/].*|(?:qwen|deepseek|glm|gemini|doubao-seed)[-/.].*)"))return "text";
        return null;
    }
    static Map<String,Object> arkVideoBody(String model,JobService.Request request){
        String ratio= MuseClient.ratio(request.width(),request.height());
        return Map.of("model",model,"content",List.of(Map.of("type","text","text",request.prompt())),"ratio",ratio,"duration",request.duration(),"watermark",false,"generate_audio",true);
    }
    static byte[] videoBody(String boundary,String model,JobService.Request r){
        var fields=new LinkedHashMap<String,String>();fields.put("model",model);fields.put("prompt",r.prompt());fields.put("size",r.width()+"x"+r.height());fields.put("seconds",String.valueOf(r.duration()));
        var text=new StringBuilder();fields.forEach((key,value)->text.append("--").append(boundary).append("\r\nContent-Disposition: form-data; name=\"").append(key).append("\"\r\n\r\n").append(value).append("\r\n"));text.append("--").append(boundary).append("--\r\n");return text.toString().getBytes(StandardCharsets.UTF_8);
    }
    static void validatePublic(URI uri)throws Exception{
        if(!"https".equalsIgnoreCase(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null||uri.getFragment()!=null||uri.getPort()!=-1&&uri.getPort()!=443)throw new MuseClient.Rejected("个人渠道与媒体仅允许 HTTPS 443 公网地址");
        String host=uri.getHost().toLowerCase(Locale.ROOT);if(host.equals("localhost")||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".internal")||!host.contains("."))throw new MuseClient.Rejected("个人渠道不能访问本机或内部网络");
        InetAddress[] addresses=InetAddress.getAllByName(host);if(addresses.length==0)throw new MuseClient.Rejected("渠道域名未解析");
        for(InetAddress address:addresses)if(!MuseClient.publicAddress(address))throw new MuseClient.Rejected("个人渠道不能访问本机或内部网络");
    }
}
