package cn.musecanvas.api;

import java.util.List;
import java.util.Map;
import java.io.IOException;
import java.net.http.HttpTimeoutException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/** Server-only Muse text transport shared by story and science planners. */
@Service
public class MuseTextGateway {
    private static final Logger log=LoggerFactory.getLogger(MuseTextGateway.class);
    private final MuseProvider provider;
    private final NativePoolService pool;
    private final MuseClient client;

    public MuseTextGateway(MuseProvider provider,NativePoolService pool,MuseClient client){this.provider=provider;this.pool=pool;this.client=client;}

    public List<Map<String,Object>> models(String owner){
        return List.of(
            Map.of("id","muse-spark","name","Muse 文本","available",provider.enabled()),
            Map.of("id","muse-service-spark","name","Muse 服务通道 · 文本","available",pool.serviceTextAvailable(owner)));
    }

    public String complete(String owner,String model,String system,String input,int maxTokens){
        if(owner==null||owner.isBlank())throw ApiException.notFound();
        if(!List.of("muse-spark","muse-service-spark").contains(model==null?"":model))throw ApiException.invalid("请选择 Muse 文本模型");
        if(system==null||system.isBlank()||system.length()>60000||input==null||input.isBlank()||input.length()>120000)
            throw ApiException.invalid("文本规划指令为空或过长");
        if(maxTokens<512||maxTokens>12000)throw ApiException.invalid("文本输出上限应为 512–12000 tokens");
        try{
            if("muse-service-spark".equals(model)){
                try(var lease=pool.acquireServiceForGeneration(owner)){
                    if(lease==null)throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"MODEL_UNAVAILABLE","当前没有空闲的 Muse 服务账号，请稍后重试");
                    return client.completeText(system,input,maxTokens,pool.decryptCredential(lease));
                }
            }
            if(!provider.enabled())throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"MODEL_UNAVAILABLE","部署者尚未启用 Muse 文本服务");
            return client.completeText(system,input,maxTokens,provider.apiKey());
        }catch(ApiException rejected){throw rejected;}
        catch(HttpTimeoutException timeout){throw failed("TEXT_MODEL_TIMEOUT","Muse 文本服务在请求时限内未返回完整回复；请核对原对话，系统不会自动重复请求",timeout);}
        catch(MuseClient.RequestRejected rejected){throw failed("TEXT_MODEL_REJECTED","Muse 文本请求被上游明确拒绝，请检查服务凭据、模型权限或额度；系统没有自动重复请求",rejected);}
        catch(MuseClient.Rejected invalid){throw failed("TEXT_MODEL_RESPONSE_INVALID","Muse 文本响应格式无效、累计快照存在歧义或未符合约定结构；没有覆盖档案，也没有自动重发",invalid);}
        catch(InterruptedException interrupted){Thread.currentThread().interrupt();throw failed("TEXT_MODEL_INTERRUPTED","Muse 文本请求已中断，请核对原对话；系统不会自动重复请求",interrupted);}
        catch(IOException connection){throw failed("TEXT_MODEL_IO","Muse 文本服务网络连接中断或响应读取失败，请检查连接；系统不会自动重复请求",connection);}
        catch(Exception unavailable){throw failed("TEXT_MODEL_UNAVAILABLE","Muse 文本规划暂未完成，请检查服务账号、额度与上游状态；系统不会自动重复请求",unavailable);}
    }
    private static ApiException failed(String category,String message,Exception failure){
        // Log only stable categories and class names: no upstream messages, bodies, keys or owner details.
        log.warn("Muse text request failed: category={}, type={}",category,failure.getClass().getSimpleName());
        return new ApiException(HttpStatus.BAD_GATEWAY,category,message,Map.of("failureCategory",category));
    }
}
