package cn.musecanvas.api;

import jakarta.annotation.PreDestroy;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Semaphore;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.SynchronousQueue;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

@Component
public class JobRunner {
    private static final Logger log=LoggerFactory.getLogger(JobRunner.class);
    private final WorkbenchStore store;private final AppSettings settings;private final MuseClient muse;private final AssetService assets;
    private final JdbcTemplate jdbc;private final TransactionTemplate tx;
    private final MuseProvider provider;
    private final NativePoolService nativePool;private final BrowserWorkerClient browserWorker;
    private final ChannelService channels;private final ChannelClient channelClient;
    private final ThreadPoolExecutor executor;private final Semaphore slots;
    @Autowired
    public JobRunner(WorkbenchStore store,AppSettings settings,MuseClient muse,AssetService assets,JdbcTemplate jdbc,TransactionTemplate tx,MuseProvider provider,NativePoolService nativePool,BrowserWorkerClient browserWorker,ChannelService channels,ChannelClient channelClient){this.store=store;this.settings=settings;this.muse=muse;this.assets=assets;this.jdbc=jdbc;this.tx=tx;this.provider=provider;this.nativePool=nativePool;this.browserWorker=browserWorker;this.channels=channels;this.channelClient=channelClient;int n=settings.workerConcurrency();slots=new Semaphore(n);executor=new ThreadPoolExecutor(n,n,30,TimeUnit.SECONDS,new SynchronousQueue<>(),Thread.ofPlatform().name("muse-worker-",0).factory(),new ThreadPoolExecutor.AbortPolicy());}
    JobRunner(WorkbenchStore store,AppSettings settings,MuseClient muse,AssetService assets,JdbcTemplate jdbc,TransactionTemplate tx,MuseProvider provider){this.store=store;this.settings=settings;this.muse=muse;this.assets=assets;this.jdbc=jdbc;this.tx=tx;this.provider=provider;this.nativePool=null;this.browserWorker=null;this.channels=null;this.channelClient=null;int n=settings.workerConcurrency();slots=new Semaphore(n);executor=new ThreadPoolExecutor(n,n,30,TimeUnit.SECONDS,new SynchronousQueue<>(),Thread.ofPlatform().name("muse-worker-test-",0).factory(),new ThreadPoolExecutor.AbortPolicy());}
    @Scheduled(fixedDelay=1500,initialDelay=2500)
    public void dispatch(){
        if(!settings.schedulerEnabled())return;
        try{
            // A crashed submission without a durable provider ID is ambiguous: never replay a paid call.
            jdbc.update("UPDATE generation_job SET status=CASE WHEN provider_task_id IS NULL THEN 'unknown_external' ELSE 'waiting_provider' END,error_message=CASE WHEN provider_task_id IS NULL THEN '执行器中断，外部提交状态需核对；系统不会自动重复提交' ELSE NULL END,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP(3) WHERE status='running' AND lease_until<CURRENT_TIMESTAMP(3)");
            jdbc.update("UPDATE generation_job SET status='cancelled',error_message=CASE WHEN provider_task_id IS NOT NULL THEN '已停止本地追踪，供应商任务可能仍在运行并产生费用' ELSE NULL END,updated_at=CURRENT_TIMESTAMP(3) WHERE status='cancel_requested' AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP(3))");
            if(nativePool==null&&channels==null&&!provider.enabled())return;
            var ids=jdbc.queryForList("SELECT id FROM generation_job WHERE status IN ('queued','waiting_provider') AND next_run_at<=CURRENT_TIMESTAMP(3) AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP(3)) ORDER BY next_run_at,created_at LIMIT ?",String.class,settings.workerConcurrency()*2);
            for(String id:ids){
                if(!slots.tryAcquire())break;
                try{executor.execute(()->{try{execute(id);}finally{slots.release();}});}catch(RuntimeException e){slots.release();}
            }
        }catch(RuntimeException e){log.warn("Persistent job scheduler temporarily unavailable: {}",e.getClass().getSimpleName());}
    }
    void execute(String id){
        String token=UUID.randomUUID().toString();
        int leaseSeconds=nativePool==null?Math.max(180,settings.providerTimeout()*3+60):Math.max(720,settings.providerTimeout()*3+60);
        if(jdbc.update("UPDATE generation_job SET status='running',lease_token=?,lease_until=TIMESTAMPADD(SECOND,?,CURRENT_TIMESTAMP(3)),updated_at=CURRENT_TIMESTAMP(3) WHERE id=? AND status IN ('queued','waiting_provider') AND next_run_at<=CURRENT_TIMESTAMP(3) AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP(3))",token,leaseSeconds,id)!=1)return;
        Map<String,Object> job=jdbc.queryForObject("SELECT * FROM generation_job WHERE id=?",(rs,n)->JobService.internalRow(rs),id);
        if(ChannelService.custom((String)job.get("model"))){
            if(Instant.parse((String)job.get("createdAt")).isBefore(Instant.now().minusSeconds(7200))){finish(id,token,"unknown_external","任务已超过两小时追踪上限，请核对上游状态；系统不会自动重复提交");return;}
            executeChannel(id,token,job);return;
        }
        if(nativePool!=null){
            if(Instant.parse((String)job.get("createdAt")).isBefore(Instant.now().minusSeconds(7200))){finish(id,token,"unknown_external","任务已超过两小时追踪上限，请核对上游状态；系统不会自动重复提交");return;}
            executePool(id,token,job);return;
        }
        String provider=(String)job.get("providerTaskId");boolean submitted=provider!=null;
        if(Instant.parse((String)job.get("createdAt")).isBefore(Instant.now().minusSeconds(7200))){finish(id,token,"unknown_external","任务已超过两小时追踪上限，请核对上游状态；系统不会自动重复提交");return;}
        try{
            var request=Json.MAPPER.readValue((String)job.get("requestJson"),JobService.Request.class);
            MuseClient.Outcome outcome;
            if(provider==null){
                outcome=muse.submit(id,(String)job.get("ownerId"),request);
                submitted=true;
                provider=outcome.taskId();
                if(provider!=null)jdbc.update("UPDATE generation_job SET provider_task_id=? WHERE id=? AND lease_token=?",provider,id,token);
            }else outcome=muse.poll(request.kind(),provider);
            if(cancelRequested(id)){finish(id,token,"cancelled","已停止本地追踪，供应商任务可能仍在运行并产生费用");return;}
            if(outcome.failed()){finish(id,token,"failed",outcome.error()==null?"Muse 任务失败":outcome.error());return;}
            if(outcome.completed()){
                var media=muse.download(outcome,request.kind());var file=assets.writeGenerated(request.kind(),media.bytes(),media.mime());
                boolean saved=Boolean.TRUE.equals(tx.execute(s->{
                    var states=jdbc.queryForList("SELECT status FROM generation_job WHERE id=? AND lease_token=? FOR UPDATE",String.class,id,token);
                    if(states.isEmpty()||!states.getFirst().equals("running"))return false;
                    var asset=assets.commitGenerated((String)job.get("ownerId"),(String)job.get("projectId"),id,file);
                    jdbc.update("UPDATE generation_job SET status='succeeded',result_asset_id=?,error_message=NULL,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP(3) WHERE id=? AND lease_token=?",asset.get("id"),id,token);return true;
                }));
                if(!saved){assets.discard(file);if(cancelRequested(id))finish(id,token,"cancelled","已停止本地追踪，供应商任务可能已产生费用");}
            }else if(provider!=null){
                waitProvider(id,token);
            }else finish(id,token,"unknown_external","上游没有返回任务标识或生成资源，请核对上游任务，系统不会自动重复提交");
        }catch(MuseClient.Rejected|ApiException e){finish(id,token,"failed",e.getMessage());}
        catch(Exception e){
            log.warn("Generation stage {} interrupted: {}",id,e.getClass().getSimpleName());
            if(provider!=null)waitProvider(id,token);
            else finish(id,token,"unknown_external",submitted?"生成资源处理异常，请核对上游结果；系统不会重复生成":"外部提交状态不确定，请核对上游任务；系统不会自动重复提交");
        }
    }
    private void executeChannel(String id,String token,Map<String,Object> job){
        String taskId=(String)job.get("providerTaskId");boolean attempted=false;
        try{
            if(cancelRequested(id)){finish(id,token,"cancelled","任务已取消；已提交的供应商任务可能仍在运行");return;}
            if(channels==null||channelClient==null)throw ApiException.invalid("此执行器尚未启用自建渠道");
            var request=Json.MAPPER.readValue((String)job.get("requestJson"),JobService.Request.class);
            String owner=(String)job.get("ownerId");channels.validate(owner,request);var route=channels.route(owner,request.model());
            if(!route.channel().id().equals(job.get("providerAccountId"))||!ChannelService.fingerprint(route.channel()).equals(job.get("providerRoute"))){finish(id,token,taskId==null?"failed":"unknown_external","渠道地址或凭证已变更，已停止此任务；请核对原渠道生成历史");return;}
            MuseClient.Outcome outcome;
            if(taskId==null){
                attempted=true;outcome=channelClient.submit(id,route,request);taskId=outcome.taskId();
                if(taskId!=null){ChannelClient.safeId(taskId);if(jdbc.update("UPDATE generation_job SET provider_task_id=? WHERE id=? AND lease_token=?",taskId,id,token)!=1)return;}
            }else outcome=channelClient.poll(route,request.kind(),taskId);
            if(cancelRequested(id)){finish(id,token,"cancelled","已停止本地追踪，供应商任务可能仍在运行并产生费用");return;}
            if(outcome.failed()){finish(id,token,"failed",outcome.error()==null?"渠道任务失败，请核对供应商生成历史":outcome.error());return;}
            if(outcome.completed()){
                var media=channelClient.download(route,outcome,request.kind());var file=assets.writeGenerated(request.kind(),media.bytes(),media.mime());commitGenerated(id,token,job,file);
            }else if(taskId!=null&&request.kind().equals("video"))waitProvider(id,token);
            else finish(id,token,"unknown_external","兼容接口没有返回有效生成资源或视频任务标识，请核对上游历史；系统不会重复提交");
        }catch(MuseClient.Rejected|ApiException e){finish(id,token,taskId!=null||attempted?"unknown_external":"failed",e.getMessage());}
        catch(Exception e){
            log.warn("Custom channel stage {} interrupted: {}",id,e.getClass().getSimpleName());
            if(taskId!=null)waitProvider(id,token);
            else finish(id,token,attempted?"unknown_external":"failed",attempted?"渠道提交状态未确认，请核对供应商历史；系统不会自动重复提交":"渠道暂不可用，请检查配置后重新提交");
        }
    }
    private void executePool(String id,String jobToken,Map<String,Object> job){
        JobService.Request request;
        try{request=Json.MAPPER.readValue((String)job.get("requestJson"),JobService.Request.class);}catch(Exception e){finish(id,jobToken,"failed","持久化生成输入无效");return;}
        String route=(String)job.get("providerRoute");String accountId=(String)job.get("providerAccountId");
        String owner=(String)job.get("ownerId");
        try{
            if(route==null){route=nativePool.routeForModel(request.model());
                try(var selected=nativePool.acquireForQueuedGeneration(owner,route,660)){
                    if(selected==null){finish(id,jobToken,"failed","你的生成通道没有可用账号；请在流量池登录并启用账号");return;}accountId=selected.accountId();
                }
                if(jdbc.update("UPDATE generation_job SET provider_route=?,provider_account_id=? WHERE id=? AND lease_token=? AND provider_route IS NULL",route,accountId,id,jobToken)!=1){finish(id,jobToken,"unknown_external","任务路由状态发生冲突，请核对任务记录");return;}}
            try(NativePoolService.PoolLease accountLease=NativePoolService.MUSE_SERVICE.equals(route)
                ?nativePool.acquirePinnedService(owner,accountId,660):nativePool.acquirePinned(owner,route,accountId,660)){
                boolean cancelRequested=cancelRequested(id);if(cancelRequested){finish(id,jobToken,"cancelled","任务已取消");return;}
                if(NativePoolService.MUSE_SERVICE.equals(route))executeService(id,jobToken,job,request,accountLease);
                else executeBrowser(id,jobToken,job,request,accountLease);
            }
        }catch(ApiException e){
            if("ACCOUNT_BUSY".equals(e.code)){if(job.get("providerTaskId")==null)waitAccount(id,jobToken);else waitProvider(id,jobToken);return;}
            finish(id,jobToken,job.get("providerTaskId")!=null?"unknown_external":"failed",e.getMessage());
        }catch(RuntimeException e){
            log.warn("Native pool lease stage {} interrupted: {}",id,e.getClass().getSimpleName());
            boolean submitted=job.get("providerTaskId")!=null;
            finish(id,jobToken,submitted?"unknown_external":"failed",submitted
                ?"固定账号暂不可用，上游任务状态未确认；请核对后再决定是否重新提交"
                :"本机账号池暂不可用，请检查账号状态后重新提交");
        }
    }
    private void executeBrowser(String id,String jobToken,Map<String,Object> job,JobService.Request request,NativePoolService.PoolLease accountLease){
        try{
            var generated=nativePool.generate(accountLease,(String)job.get("ownerId"),request,assets,browserWorker);
            if(cancelRequested(id)){finish(id,jobToken,"cancelled","任务已取消；网页生成可能已产生供应商费用");return;}
            var file=assets.writeGenerated(request.kind(),generated.bytes(),generated.mimeType());
            commitGenerated(id,jobToken,job,file);
        }catch(BrowserWorkerClient.WorkerException e){
            nativePool.recordWorkerError(accountLease.accountId(),accountLease.token(),e);
            if("ACCOUNT_BUSY".equals(e.code())){waitProvider(id,jobToken);return;}
            finish(id,jobToken,e.submissionUncertain()?"unknown_external":"failed",e.getMessage());
        }catch(Exception e){
            log.warn("Browser generation {} interrupted: {}",id,e.getClass().getSimpleName());
            finish(id,jobToken,"unknown_external","浏览器生成状态不确定；请检查本机页面和生成历史，系统不会自动重复提交");
        }
    }
    private void executeService(String id,String jobToken,Map<String,Object> job,JobService.Request request,NativePoolService.PoolLease accountLease){
        String taskId=(String)job.get("providerTaskId");boolean submissionAttempted=false;
        try{
            String key=nativePool.decryptCredential(accountLease);MuseClient.Outcome outcome;
            if(taskId==null){submissionAttempted=true;var upstreamRequest=new JobService.Request(request.projectId(),request.nodeId(),request.kind(),request.prompt(),request.model().replace("muse-service-","muse-"),request.width(),request.height(),request.duration(),request.referenceAssetIds(),request.skillId(),request.skillVersion(),request.videoMode());outcome=muse.submit(id,(String)job.get("ownerId"),upstreamRequest,key);taskId=outcome.taskId();
                if(taskId!=null)jdbc.update("UPDATE generation_job SET provider_task_id=? WHERE id=? AND lease_token=?",taskId,id,jobToken);
            }else outcome=muse.poll(request.kind(),taskId,key);
            if(cancelRequested(id)){finish(id,jobToken,"cancelled","任务已取消；特殊 Muse 服务任务可能仍在上游运行并产生费用");return;}
            if(outcome.failed()){finish(id,jobToken,"failed",outcome.error()==null?"特殊 Muse 服务任务失败":outcome.error());return;}
            if(outcome.completed()){
                var media=muse.download(outcome,request.kind(),key);var file=assets.writeGenerated(request.kind(),media.bytes(),media.mime());commitGenerated(id,jobToken,job,file);
            }else if(taskId!=null)waitProvider(id,jobToken);
            else finish(id,jobToken,"unknown_external","上游没有返回任务标识或生成资源，请核对上游任务，系统不会自动重复提交");
        }catch(MuseClient.RequestRejected e){finish(id,jobToken,taskId==null?"failed":"unknown_external",e.getMessage());}
        catch(MuseClient.Rejected|ApiException e){finish(id,jobToken,taskId!=null||submissionAttempted?"unknown_external":"failed",e.getMessage());}
        catch(Exception e){log.warn("Muse service route {} interrupted: {}",id,e.getClass().getSimpleName());if(taskId!=null)waitProvider(id,jobToken);else finish(id,jobToken,submissionAttempted?"unknown_external":"failed","特殊 Muse 服务调用状态不确定，请核对上游任务；系统不会自动重试");}
    }
    private void commitGenerated(String id,String jobToken,Map<String,Object> job,AssetService.GeneratedFile file){
        boolean saved=Boolean.TRUE.equals(tx.execute(s->{var states=jdbc.queryForList("SELECT status FROM generation_job WHERE id=? AND lease_token=? FOR UPDATE",String.class,id,jobToken);if(states.isEmpty()||!states.getFirst().equals("running"))return false;var asset=assets.commitGenerated((String)job.get("ownerId"),(String)job.get("projectId"),id,file);jdbc.update("UPDATE generation_job SET status='succeeded',result_asset_id=?,error_message=NULL,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP(3) WHERE id=? AND lease_token=?",asset.get("id"),id,jobToken);return true;}));
        if(!saved){assets.discard(file);if(cancelRequested(id))finish(id,jobToken,"cancelled","已停止本地追踪，供应商任务可能已产生费用");}
    }
    private boolean cancelRequested(String id){return "cancel_requested".equals(jdbc.queryForObject("SELECT status FROM generation_job WHERE id=?",String.class,id));}
    private void waitAccount(String id,String token){jdbc.update("UPDATE generation_job SET status=CASE WHEN status='cancel_requested' THEN 'cancelled' ELSE 'queued' END,lease_token=NULL,lease_until=NULL,next_run_at=TIMESTAMPADD(SECOND,5,CURRENT_TIMESTAMP(3)),updated_at=CURRENT_TIMESTAMP(3) WHERE id=? AND lease_token=?",id,token);}
    private void waitProvider(String id,String token){jdbc.update("UPDATE generation_job SET status=CASE WHEN status='cancel_requested' THEN 'cancelled' ELSE 'waiting_provider' END,lease_token=NULL,lease_until=NULL,next_run_at=TIMESTAMPADD(SECOND,5,CURRENT_TIMESTAMP(3)),updated_at=CURRENT_TIMESTAMP(3) WHERE id=? AND lease_token=?",id,token);}
    private void finish(String id,String token,String status,String error){jdbc.update("UPDATE generation_job SET status=?,error_message=?,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP(3) WHERE id=? AND lease_token=?",status,error==null?null:error.substring(0,Math.min(error.length(),1800)),id,token);}
    @PreDestroy public void close(){executor.shutdownNow();}
}
