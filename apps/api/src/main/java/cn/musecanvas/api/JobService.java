package cn.musecanvas.api;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;
import com.fasterxml.jackson.annotation.JsonInclude;

@Service
public class JobService {
    public record Request(String projectId,String nodeId,String kind,String prompt,String model,Integer width,Integer height,Integer duration,List<String> referenceAssetIds,
                          @JsonInclude(JsonInclude.Include.NON_NULL) String skillId, @JsonInclude(JsonInclude.Include.NON_NULL) String skillVersion,
                          @JsonInclude(JsonInclude.Include.NON_NULL) String videoMode) {
        public Request(String projectId,String nodeId,String kind,String prompt,String model,Integer width,Integer height,Integer duration,List<String> referenceAssetIds) {
            this(projectId,nodeId,kind,prompt,model,width,height,duration,referenceAssetIds,null,null,null);
        }
        public Request(String projectId,String nodeId,String kind,String prompt,String model,Integer width,Integer height,Integer duration,List<String> referenceAssetIds,String skillId,String skillVersion) {
            this(projectId,nodeId,kind,prompt,model,width,height,duration,referenceAssetIds,skillId,skillVersion,null);
        }
    }
    private final WorkbenchStore store;
    private final AppSettings settings;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final MuseProvider provider;
    private final NativePoolService nativePool;
    private final ChannelService channels;
    private final SkillService skills;
    @Autowired
    public JobService(WorkbenchStore store,AppSettings settings,JdbcTemplate jdbc,TransactionTemplate tx,MuseProvider provider,NativePoolService nativePool,ChannelService channels,SkillService skills){this.store=store;this.settings=settings;this.jdbc=jdbc;this.tx=tx;this.provider=provider;this.nativePool=nativePool;this.channels=channels;this.skills=skills;}
    JobService(WorkbenchStore store,AppSettings settings,JdbcTemplate jdbc,TransactionTemplate tx,MuseProvider provider,NativePoolService nativePool,ChannelService channels){this(store,settings,jdbc,tx,provider,nativePool,channels,null);}
    JobService(WorkbenchStore store,AppSettings settings,JdbcTemplate jdbc,TransactionTemplate tx,MuseProvider provider){this(store,settings,jdbc,tx,provider,null,null,null);}
    public Map<String,Object> submit(String owner,String key,Request raw) {
        Request request=normalize(raw);if(key==null||key.isBlank()||key.length()>128)throw ApiException.invalid("请提供不超过 128 字符的 Idempotency-Key");
        String json=Json.write(request);String hash=Json.hash(json);
        var existing=byKey(owner,key);if(existing!=null)return matchIdempotency(existing,hash);
        if(skills!=null)skills.validateJob(owner,request);else if(request.skillId()!=null)throw ApiException.invalid("Skill 校验服务尚未启用");
        if(ChannelService.custom(request.model())){if(channels==null)throw ApiException.invalid("自建渠道尚未启用");channels.validate(owner,request);}
        else if(nativePool==null)provider.validate(request);else nativePool.validate(owner,request);
        ChannelService.Route customRoute=ChannelService.custom(request.model())?channels.route(owner,request.model()):null;
        var project=store.project(owner,request.projectId());
        for(String asset:request.referenceAssetIds()) {var a=store.asset(owner,asset);if(!String.valueOf(a.get("mimeType")).startsWith("image/"))throw ApiException.invalid("参考素材必须为图片");}
        String id=UUID.randomUUID().toString();
        try {
            tx.executeWithoutResult(s->{
                // Serialize per-user queue admission so concurrent tabs cannot exceed this limit.
                jdbc.queryForObject("SELECT id FROM app_user WHERE id=? FOR UPDATE",String.class,owner);
                Long active=jdbc.queryForObject("SELECT COUNT(*) FROM generation_job WHERE owner_id=? AND status IN ('queued','running','waiting_provider','cancel_requested')",Long.class,owner);
                if(active!=null&&active>=20)throw new ApiException(HttpStatus.TOO_MANY_REQUESTS,"QUEUE_FULL","待处理任务已达 20 个，请等待后再提交");
                jdbc.update("INSERT INTO generation_job(id,owner_id,project_id,node_id,input_revision,kind,prompt,model,request_json,request_hash,idempotency_key,provider_route,provider_account_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",id,owner,request.projectId(),request.nodeId(),project.get("revision"),request.kind(),request.prompt(),request.model(),json,hash,key,customRoute==null?null:ChannelService.fingerprint(customRoute.channel()),customRoute==null?null:customRoute.channel().id());
            });
        } catch(DuplicateKeyException e){var prior=byKey(owner,key);if(prior!=null)return matchIdempotency(prior,hash);throw e;}
        return job(owner,id);
    }
    static Request normalize(Request r) {
        if(r==null||r.projectId()==null||r.projectId().isBlank()||r.nodeId()==null||r.nodeId().isBlank()||r.nodeId().length()>128)throw ApiException.invalid("projectId 与 nodeId 必填");
        if(r.kind()==null||!List.of("image","video").contains(r.kind()))throw ApiException.invalid("kind 必须为 image 或 video");
        if(r.prompt()==null||r.prompt().isBlank()||r.prompt().length()>12000)throw ApiException.invalid("提示词必填，且不超过 12000 字符");
        int width=r.width()==null?(r.kind().equals("video")?1280:1024):r.width();int height=r.height()==null?(r.kind().equals("video")?720:1024):r.height();
        if(width<64||width>4096||height<64||height>4096)throw ApiException.invalid("宽高应在 64–4096 之间");
        String model=r.model()==null||r.model().isBlank()?(r.kind().equals("video")?"muse-video":"muse-image"):r.model().trim();
        int duration=r.duration()==null?(model.equals("doubao-video")?10:5):r.duration();if(duration<2||duration>20)throw ApiException.invalid("视频时长应在 2–20 秒之间");
        if(model.length()>120)throw ApiException.invalid("模型名称过长");
        List<String> refs=r.referenceAssetIds()==null?List.of():r.referenceAssetIds();if(refs.stream().anyMatch(s->s==null||s.isBlank()))throw ApiException.invalid("参考素材标识不能为空");refs=List.copyOf(refs);if(refs.size()>4)throw ApiException.invalid("最多支持 4 张参考图");
        String mode=r.videoMode();
        if(mode!=null&&(!r.kind().equals("video")||!List.of("auto","reference","frames").contains(mode)))throw ApiException.invalid("videoMode 仅用于视频，须为 auto、reference 或 frames");
        if(r.kind().equals("video")&&"frames".equals(mode)&&refs.size()>2)throw ApiException.invalid("首尾帧模式最多支持 2 张参考图，多图请使用参考模式");
        if("frames".equals(mode)&&refs.isEmpty())throw ApiException.invalid("首尾帧模式需要至少一张首帧图片");
        if(r.kind().equals("video")&&mode==null)mode="reference";
        if((r.skillId()==null)!=(r.skillVersion()==null) || (r.skillId()!=null && (!r.skillId().matches("[a-z][a-z0-9-]{0,63}") || !r.skillVersion().matches("[0-9]{1,6}\\.[0-9]{1,6}\\.[0-9]{1,6}"))))throw ApiException.invalid("skillId 与 skillVersion 格式无效，且须一起提供");
        return new Request(r.projectId(),r.nodeId(),r.kind(),r.prompt().trim(),model,width,height,duration,refs,r.skillId(),r.skillVersion(),mode);
    }
    private Map<String,Object> byKey(String owner,String key){return jdbc.query("SELECT * FROM generation_job WHERE owner_id=? AND idempotency_key=?",(rs,n)->internalRow(rs),owner,key).stream().findFirst().orElse(null);}
    private Map<String,Object> matchIdempotency(Map<String,Object> existing,String hash){if(!hash.equals(existing.get("requestHash")))throw new ApiException(HttpStatus.CONFLICT,"IDEMPOTENCY_CONFLICT","同一幂等键不能用于不同的生成请求");return publicView(existing);}
    public List<Map<String,Object>> jobs(String owner,String projectId){
        if(projectId!=null)store.project(owner,projectId);
        return projectId==null?jdbc.query("SELECT * FROM generation_job WHERE owner_id=? ORDER BY created_at DESC LIMIT 100",(rs,n)->publicView(internalRow(rs)),owner):jdbc.query("SELECT * FROM generation_job WHERE owner_id=? AND project_id=? ORDER BY created_at DESC LIMIT 100",(rs,n)->publicView(internalRow(rs)),owner,projectId);
    }
    public Map<String,Object> job(String owner,String id){return jdbc.query("SELECT * FROM generation_job WHERE owner_id=? AND id=?",(rs,n)->publicView(internalRow(rs)),owner,id).stream().findFirst().orElseThrow(ApiException::notFound);}
    public Map<String,Object> cancel(String owner,String id){
        job(owner,id);
        jdbc.update("UPDATE generation_job SET status=CASE WHEN status='queued' THEN 'cancelled' ELSE 'cancel_requested' END,updated_at=CURRENT_TIMESTAMP(3) WHERE id=? AND owner_id=? AND status IN ('queued','running','waiting_provider')",id,owner);
        return job(owner,id);
    }
    static Map<String,Object> internalRow(ResultSet rs)throws SQLException{
        var m=new LinkedHashMap<String,Object>();m.put("id",rs.getString("id"));m.put("status",rs.getString("status"));m.put("kind",rs.getString("kind"));m.put("prompt",rs.getString("prompt"));m.put("model",rs.getString("model"));m.put("projectId",rs.getString("project_id"));m.put("nodeId",rs.getString("node_id"));m.put("inputRevision",rs.getLong("input_revision"));String asset=rs.getString("result_asset_id");m.put("resultAssetId",asset);m.put("resultUrl",asset==null?null:"/api/assets/"+asset+"/content");m.put("error",rs.getString("error_message"));m.put("createdAt",WorkbenchStore.iso(rs,"created_at"));m.put("updatedAt",WorkbenchStore.iso(rs,"updated_at"));
        m.put("ownerId",rs.getString("owner_id"));m.put("requestHash",rs.getString("request_hash"));m.put("requestJson",rs.getString("request_json"));m.put("providerTaskId",rs.getString("provider_task_id"));m.put("providerRoute",rs.getString("provider_route"));m.put("providerAccountId",rs.getString("provider_account_id"));m.put("leaseToken",rs.getString("lease_token"));return m;
    }
    static Map<String,Object> publicView(Map<String,Object> m){var result=new LinkedHashMap<>(m);result.put("canRecover",m.get("providerTaskId")!=null&&List.of("failed","unknown_external","cancelled").contains(String.valueOf(m.get("status"))));for(String key:List.of("ownerId","requestHash","requestJson","providerTaskId","providerRoute","providerAccountId","leaseToken"))result.remove(key);return result;}
}
