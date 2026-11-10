package cn.musecanvas.api;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/** Recovers an existing upstream task. This class deliberately has no submission path. */
@Service
public class JobRecoveryService {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final JobService jobs;
    private final MuseClient muse;
    private final NativePoolService pool;
    private final ChannelService channels;
    private final ChannelClient channelClient;
    private final AssetService assets;
    public JobRecoveryService(JdbcTemplate jdbc,TransactionTemplate tx,JobService jobs,MuseClient muse,NativePoolService pool,ChannelService channels,ChannelClient channelClient,AssetService assets){
        this.jdbc=jdbc;this.tx=tx;this.jobs=jobs;this.muse=muse;this.pool=pool;this.channels=channels;this.channelClient=channelClient;this.assets=assets;
    }

    public Map<String,Object> recover(String owner,String id){
        var job=jdbc.query("SELECT * FROM generation_job WHERE id=? AND owner_id=?",(rs,n)->JobService.internalRow(rs),id,owner).stream().findFirst().orElseThrow(ApiException::notFound);
        String status=(String)job.get("status"),task=(String)job.get("providerTaskId");
        if("succeeded".equals(status))return result(owner,id,"completed","已有生成结果，可直接查看素材");
        if(task==null||task.isBlank())throw ApiException.invalid("此任务没有可查询的上游任务标识；不能自动恢复或重新生成");
        if(!List.of("failed","unknown_external","cancelled").contains(status))return result(owner,id,"pending","任务正在执行或等待查询，请稍后刷新");
        String token=UUID.randomUUID().toString();
        if(jdbc.update("UPDATE generation_job SET status='running',lease_token=?,lease_until=TIMESTAMPADD(SECOND,660,CURRENT_TIMESTAMP(3)),updated_at=CURRENT_TIMESTAMP(3) WHERE id=? AND owner_id=? AND status=? AND provider_task_id IS NOT NULL AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP(3))",token,id,owner,status)!=1)
            throw new ApiException(HttpStatus.CONFLICT,"JOB_BUSY","任务正在被另一个请求查询，请稍后刷新");
        try{
            String kind=(String)job.get("kind"),model=(String)job.get("model"),route=(String)job.get("providerRoute");
            if(ChannelService.custom(model)){
                var selected=channels.route(owner,model);
                if(!selected.channel().id().equals(job.get("providerAccountId"))||!ChannelService.fingerprint(selected.channel()).equals(route))throw ApiException.invalid("原渠道地址或凭证已变更，请先恢复原配置");
                return finish(owner,id,token,status,job,channelClient.poll(selected,kind,task),outcome->channelClient.download(selected,outcome,kind));
            }
            if(NativePoolService.MUSE_SERVICE.equals(route)){
                try(var lease=pool.acquirePinnedService(owner,(String)job.get("providerAccountId"),660)){
                    String key=pool.decryptCredential(lease);
                    return finish(owner,id,token,status,job,muse.poll(kind,task,key),outcome->muse.download(outcome,kind,key));
                }
            }
            if(route!=null)throw ApiException.invalid("此网页任务没有服务接口查询通道，请在原网页检查生成记录");
            return finish(owner,id,token,status,job,muse.poll(kind,task),outcome->muse.download(outcome,kind));
        }catch(ApiException rejected){restore(id,token,status,rejected.getMessage());throw rejected;}
        catch(Exception unavailable){
            if(unavailable instanceof InterruptedException)Thread.currentThread().interrupt();
            restore(id,token,status,"查询原任务暂未完成，请稍后再查询；没有重新提交生成请求");
            return result(owner,id,"unavailable","暂时无法读取原任务结果，没有重新提交生成请求");
        }
    }

    @FunctionalInterface private interface Downloader { MuseClient.Media download(MuseClient.Outcome outcome)throws Exception; }
    private Map<String,Object> finish(String owner,String id,String token,String previous,Map<String,Object> job,MuseClient.Outcome outcome,Downloader download)throws Exception{
        if(outcome.failed()){restore(id,token,"failed",outcome.error()==null?"上游原任务已失败，没有重新生成":outcome.error());return result(owner,id,"failed","上游原任务已失败，没有重新生成");}
        if(!outcome.completed()){restore(id,token,previous,"上游原任务仍在处理中；可稍后再次查询，没有重新生成");return result(owner,id,"pending","上游原任务仍在处理中，没有重新生成");}
        var media=download.download(outcome);var file=assets.writeGenerated((String)job.get("kind"),media.bytes(),media.mime());
        try{
            boolean saved=Boolean.TRUE.equals(tx.execute(transaction->{
                var states=jdbc.queryForList("SELECT status FROM generation_job WHERE id=? AND owner_id=? AND lease_token=? FOR UPDATE",String.class,id,owner,token);
                if(states.isEmpty()||!"running".equals(states.getFirst()))return false;
                var asset=assets.commitGenerated(owner,(String)job.get("projectId"),id,file);
                jdbc.update("UPDATE generation_job SET status='succeeded',result_asset_id=?,error_message=NULL,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP(3) WHERE id=? AND owner_id=? AND lease_token=?",asset.get("id"),id,owner,token);
                return true;
            }));
            if(!saved){assets.discard(file);restore(id,token,previous,"查询结果保存已取消，请刷新任务");return result(owner,id,"cancelled","查询结果保存已取消");}
        }catch(RuntimeException failure){assets.discard(file);throw failure;}
        return result(owner,id,"completed","已找回原任务结果并保存素材，没有重新生成");
    }
    private void restore(String id,String token,String status,String message){jdbc.update("UPDATE generation_job SET status=CASE WHEN status='cancel_requested' THEN 'cancelled' ELSE ? END,error_message=?,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP(3) WHERE id=? AND lease_token=?",status,message,id,token);}
    private Map<String,Object> result(String owner,String id,String status,String message){var result=new LinkedHashMap<>(jobs.job(owner,id));result.put("recoveryStatus",status);result.put("recoveryMessage",message);result.put("generationResubmitted",false);return result;}
}
