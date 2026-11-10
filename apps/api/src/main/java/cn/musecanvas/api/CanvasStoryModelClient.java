package cn.musecanvas.api;

import java.io.InputStream;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import org.springframework.stereotype.Component;

/** One bounded text call. It never retries an uncertain external request or exposes upstream bodies. */
@Component
public class CanvasStoryModelClient {
    private final ChannelService channels;private final MuseTextGateway muse;
    private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).build();
    public CanvasStoryModelClient(ChannelService channels,MuseTextGateway muse){this.channels=channels;this.muse=muse;}
    public String fingerprint(String owner,String model){
        if(muse(model)){
            if(muse.models(owner).stream().noneMatch(value->model.equals(value.get("id"))&&Boolean.TRUE.equals(value.get("available"))))throw ApiException.invalid("此Muse文本模型暂不可用，请检查账号池或文本服务配置");
            return model;
        }
        var route=channels.route(owner,model);if(route.channel().models().stream().noneMatch(value->value.name().equals(route.model())&&"text".equals(value.capability())))throw ApiException.invalid("请先配置并选择文本理解模型");return ChannelService.fingerprint(route.channel());
    }
    public String complete(String owner,String model,String pinned,String system,String input){
        if(!Objects.equals(pinned,fingerprint(owner,model)))throw ApiException.invalid("模型渠道或凭证已经修改，请重新提交工作流任务");
        if(muse(model))return muse.complete(owner,model,system,input,10000);
        var route=channels.route(owner,model);
        try{
            var uri=ChannelClient.endpoint(route.channel().baseUrl(),"/chat/completions");ChannelClient.validatePublic(uri);
            byte[] payload=Json.write(Map.of("model",route.model(),"messages",List.of(Map.of("role","system","content",system),Map.of("role","user","content",input)),"temperature",0.2,"max_tokens",10000,"response_format",Map.of("type","json_object"))).getBytes(StandardCharsets.UTF_8);
            var request=HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(90)).header("Authorization","Bearer "+channels.key(route.channel())).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofByteArray(payload)).build();
            var response=http.send(request,HttpResponse.BodyHandlers.ofInputStream());
            try(InputStream body=response.body()){
                if(response.statusCode()<200||response.statusCode()>=300)throw ApiException.invalid("文本模型请求失败（HTTP "+response.statusCode()+"），请检查地址、模型权限与额度；任务没有自动重发");
                byte[] data=body.readNBytes(2*1024*1024+1);if(data.length>2*1024*1024)throw ApiException.invalid("文本模型响应超过2MiB限制");var raw=Json.read(new String(data,StandardCharsets.UTF_8));
                var choices=raw.path("choices");String result=choices.isArray()&&!choices.isEmpty()?MuseClient.text(choices.get(0).path("message"),"content"):null;
                if(result==null||result.isBlank()||result.length()>120000)throw ApiException.invalid("文本模型没有返回有效的档案或分镜内容");return result;
            }
        }catch(InterruptedException interrupted){Thread.currentThread().interrupt();throw ApiException.invalid("工作流调用已中断；任务没有自动重发");}
        catch(ApiException expected){throw expected;}
        catch(Exception unavailable){throw ApiException.invalid("文本模型暂不可用或响应超时，请检查渠道；任务没有自动重发");}
    }
    private static boolean muse(String id){return "muse-spark".equals(id)||"muse-service-spark".equals(id);}
}
