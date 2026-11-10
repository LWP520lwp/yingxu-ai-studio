package cn.musecanvas.api;

import jakarta.annotation.PreDestroy;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;

/** Durable canvas-only story context. Paid text requests are never replayed after an execution lease expires. */
@Service
public class CanvasStoryWorkflowService implements AutoCloseable {
    private final JdbcTemplate jdbc;private final TransactionTemplate tx;private final WorkbenchStore store;
    private final CanvasStoryDocument documents;private final CanvasStoryModelClient models;private final AppSettings settings;
    private final Semaphore capacity=new Semaphore(2);private final ExecutorService executor=Executors.newVirtualThreadPerTaskExecutor();
    private final ConcurrentMap<String,Future<?>> running=new ConcurrentHashMap<>();
    public CanvasStoryWorkflowService(JdbcTemplate jdbc,TransactionTemplate tx,WorkbenchStore store,CanvasStoryDocument documents,CanvasStoryModelClient models,AppSettings settings){this.jdbc=jdbc;this.tx=tx;this.store=store;this.documents=documents;this.models=models;this.settings=settings;}
    public Map<String,Object> get(String owner,String project){store.project(owner,project);return snapshot(project);}
    private Map<String,Object> snapshot(String project){return jdbc.query("SELECT revision,document,updated_at FROM project_canvas_story WHERE project_id=?",(rs,n)->Map.<String,Object>of("revision",rs.getLong("revision"),"document",Json.read(rs.getString("document")),"updatedAt",rs.getTimestamp("updated_at").toInstant().toString()),project).stream().findFirst().orElseGet(()->Map.of("revision",0L,"document",CanvasStoryDocument.empty()));}
    public Map<String,Object> save(String owner,String project,Long base,JsonNode input){
        if(base==null||base<0)throw ApiException.invalid("baseRevision 必须为非负整数");
        return tx.execute(status->{lock(owner,project);var current=snapshot(project);long revision=((Number)current.get("revision")).longValue();if(revision!=base)throw conflict(revision);JsonNode next=documents.edit(input,(JsonNode)current.get("document"));write(project,revision,next);return snapshot(project);});
    }
    public List<Map<String,Object>> tasks(String owner,String project){store.project(owner,project);return jdbc.query("SELECT * FROM canvas_story_task WHERE owner_id=? AND project_id=? ORDER BY created_at DESC LIMIT 20",(rs,n)->taskRow(rs),owner,project);}
    public Map<String,Object> task(String owner,String project,String id){store.project(owner,project);return jdbc.query("SELECT * FROM canvas_story_task WHERE owner_id=? AND project_id=? AND id=?",(rs,n)->taskRow(rs),owner,project,id).stream().findFirst().orElseThrow(ApiException::notFound);}
    public Map<String,Object> create(String owner,String project,Long base,String operation){
        if(base==null||base<1||!Set.of("extract","segment","first").contains(operation==null?"":operation))throw ApiException.invalid("请先保存工作流，再选择提取档案、生成下一段或一键首段");
        var value=get(owner,project);if(((Number)value.get("revision")).longValue()!=base)throw conflict(((Number)value.get("revision")).longValue());
        JsonNode document=(JsonNode)value.get("document");String model=CanvasStoryDocument.text(document.path("model"),180,false);String fingerprint=models.fingerprint(owner,model);
        if(!operation.equals("extract"))CanvasStoryDocument.text(document.path("paragraph"),6000,false);
        if(!operation.equals("segment")&&document.path("novel").asString().isBlank()&&document.path("paragraph").asString().isBlank())throw ApiException.invalid("请提供小说全文或当前剧本段落，不能从空白输入生成档案");
        if(operation.equals("segment")&&(document.path("characters").isEmpty()||document.path("scenes").isEmpty()))throw ApiException.invalid("先提取并核对角色与场景档案，或使用一键档案与首段");
        if(operation.equals("segment"))for(JsonNode person:document.path("characters"))if(!person.path("locked").asBoolean())throw ApiException.invalid("请先核对并锁定角色核心形象，再生成下一段");
        return tx.execute(status->{
            jdbc.queryForObject("SELECT id FROM app_user WHERE id=? FOR UPDATE",String.class,owner);lock(owner,project);long revision=((Number)snapshot(project).get("revision")).longValue();if(revision!=base)throw conflict(revision);
            if(jdbc.queryForObject("SELECT COUNT(*) FROM canvas_story_task WHERE owner_id=? AND status IN ('queued','running')",Integer.class,owner)>0)throw new ApiException(HttpStatus.TOO_MANY_REQUESTS,"STORY_TASK_ACTIVE","当前已有一个连续剧本任务，请等待完成或取消后再提交");
            String id=UUID.randomUUID().toString();jdbc.update("INSERT INTO canvas_story_task(id,project_id,owner_id,base_revision,operation,model,model_fingerprint,input_document) VALUES(?,?,?,?,?,?,?,?)",id,project,owner,base,operation,model,fingerprint,Json.write(document));return task(owner,project,id);
        });
    }
    public Map<String,Object> cancel(String owner,String project,String id){
        task(owner,project,id);jdbc.update("UPDATE canvas_story_task SET status='cancelled',stage='cancelled',lease_token=NULL,lease_until=NULL WHERE id=? AND owner_id=? AND project_id=? AND status IN ('queued','running')",id,owner,project);
        var future=running.get(id);if(future!=null)future.cancel(true);return task(owner,project,id);
    }
    @Scheduled(fixedDelay=1500,initialDelay=4000) public void dispatch(){
        if(!settings.schedulerEnabled())return;
        while(capacity.tryAcquire()){
            String id;
            try{id=tx.execute(status->{
                jdbc.queryForObject("SELECT id FROM canvas_story_dispatch_lock WHERE id=1 FOR UPDATE",Integer.class);
                recoverExpired();
                if(jdbc.queryForObject("SELECT COUNT(*) FROM canvas_story_task WHERE status='running'",Integer.class)>=8)return null;
                var rows=jdbc.queryForList("SELECT id FROM canvas_story_task WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE",String.class);if(rows.isEmpty())return null;String next=rows.getFirst();jdbc.update("UPDATE canvas_story_task SET status='running',stage='starting',lease_token=?,lease_until=TIMESTAMPADD(SECOND,300,CURRENT_TIMESTAMP(3)) WHERE id=? AND status='queued'",UUID.randomUUID().toString(),next);return next;
            });}catch(RuntimeException unavailable){capacity.release();return;}
            if(id==null){capacity.release();return;}
            var future=new FutureTask<Void>(()->{execute(id);return null;});
            running.put(id,future);try{executor.execute(()->{try{future.run();}finally{running.remove(id,future);capacity.release();}});}catch(RejectedExecutionException stopped){running.remove(id);capacity.release();jdbc.update("UPDATE canvas_story_task SET status='failed',stage='failed',error_message='服务正在关闭，请重新提交',lease_token=NULL,lease_until=NULL WHERE id=? AND status='running'",id);}
        }
    }
    void recoverExpired(){jdbc.update("UPDATE canvas_story_task SET status='failed',stage='failed',error_message='执行服务中断或超时；已保留原草稿，未自动重发模型请求',lease_token=NULL,lease_until=NULL WHERE status='running' AND lease_until<CURRENT_TIMESTAMP(3)");}
    void execute(String id){
        var rows=jdbc.queryForList("SELECT * FROM canvas_story_task WHERE id=? AND status='running'",id);if(rows.isEmpty())return;var task=rows.getFirst();String token=(String)task.get("lease_token");String owner=(String)task.get("owner_id"),project=(String)task.get("project_id"),operation=(String)task.get("operation"),model=(String)task.get("model");
        try{
            JsonNode document=Json.read(databaseText(task.get("input_document")));String fingerprint=String.valueOf(task.get("model_fingerprint"));
            if(!operation.equals("segment")){if(!stage(id,token,"extracting"))return;document=documents.extracted(document,answer(models.complete(owner,model,fingerprint,CanvasStoryDocument.EXTRACT_SYSTEM,documents.extractInput(document))));}
            if(!operation.equals("extract")){if(!stage(id,token,"planning"))return;document=documents.append(document,answer(models.complete(owner,model,fingerprint,CanvasStoryDocument.SEGMENT_SYSTEM,documents.segmentInput(document))));}
            if(!stage(id,token,"validating"))return;JsonNode result=document;
            tx.executeWithoutResult(status->{
                lock(owner,project);var active=jdbc.queryForList("SELECT id FROM canvas_story_task WHERE id=? AND status='running' AND lease_token=? FOR UPDATE",String.class,id,token);if(active.isEmpty())return;
                long revision=((Number)snapshot(project).get("revision")).longValue();if(revision!=((Number)task.get("base_revision")).longValue())throw conflict(revision);
                write(project,revision,result);jdbc.update("UPDATE canvas_story_task SET status='succeeded',stage='completed',result_revision=?,lease_token=NULL,lease_until=NULL WHERE id=? AND status='running' AND lease_token=?",revision+1,id,token);
            });
        }catch(Exception failure){String reason=failure instanceof ApiException?failure.getMessage():"模型输出不符合工作流格式；原档案与分镜未被覆盖，请检查模型后重试";if(reason.length()>390)reason=reason.substring(0,390);jdbc.update("UPDATE canvas_story_task SET status='failed',stage='failed',error_message=?,lease_token=NULL,lease_until=NULL WHERE id=? AND status='running' AND lease_token=?",reason,id,token);}
    }
    private static String databaseText(Object value){return value instanceof byte[] bytes?new String(bytes,java.nio.charset.StandardCharsets.UTF_8):String.valueOf(value);}
    private boolean stage(String id,String token,String stage){if(Thread.currentThread().isInterrupted())return false;return jdbc.update("UPDATE canvas_story_task SET stage=? WHERE id=? AND status='running' AND lease_token=?",stage,id,token)==1;}
    private static JsonNode answer(String raw){try{return ModelJson.object(raw);}catch(RuntimeException invalid){throw ApiException.invalid("模型未返回唯一且完整的JSON；原档案与分镜未被覆盖，请重试");}}
    private void write(String project,long revision,JsonNode document){if(Json.write(document).getBytes(java.nio.charset.StandardCharsets.UTF_8).length>2*1024*1024)throw ApiException.invalid("连续剧本工作流超过2MiB，请导出并分拆到新画布");if(revision==0)jdbc.update("INSERT INTO project_canvas_story(project_id,revision,document) VALUES(?,1,?)",project,Json.write(document));else jdbc.update("UPDATE project_canvas_story SET revision=revision+1,document=? WHERE project_id=?",Json.write(document),project);}
    private void lock(String owner,String project){if(jdbc.queryForList("SELECT id FROM project WHERE id=? AND owner_id=? FOR UPDATE",String.class,project,owner).isEmpty())throw ApiException.notFound();}
    private static ApiException conflict(long revision){return new ApiException(HttpStatus.CONFLICT,"STORY_REVISION_CONFLICT","连续剧本已在其他窗口修改，请重新读取后再操作；现有内容没有被覆盖",Map.of("currentRevision",revision));}
    private static Map<String,Object> taskRow(ResultSet rs)throws SQLException{var row=new LinkedHashMap<String,Object>();for(String key:List.of("id","operation","model","status","stage"))row.put(key,rs.getString(key));row.put("createdAt",rs.getTimestamp("created_at").toInstant().toString());row.put("updatedAt",rs.getTimestamp("updated_at").toInstant().toString());String error=rs.getString("error_message");if(error!=null)row.put("error",error);long revision=rs.getLong("result_revision");if(!rs.wasNull())row.put("resultRevision",revision);return row;}
    @Override @PreDestroy public void close(){for(var task:running.values())task.cancel(true);executor.shutdownNow();}
}
