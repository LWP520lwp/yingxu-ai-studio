package cn.musecanvas.api;

import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;

@Repository
public class WorkbenchStore {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final RedisSupport redis;
    private final AppSettings settings;
    public WorkbenchStore(JdbcTemplate jdbc,TransactionTemplate tx,RedisSupport redis,AppSettings settings) {this.jdbc=jdbc;this.tx=tx;this.redis=redis;this.settings=settings;}
    public JsonNode projects(String owner) {
        String cached=redis.cachedProjects(owner); if(cached!=null) return Json.read(cached);
        var list=jdbc.query("SELECT id,title,revision,created_at,updated_at FROM project WHERE owner_id=? ORDER BY updated_at DESC,id DESC LIMIT 200",(rs,n)-> projectRow(rs,false),owner);
        String json=Json.write(list);redis.cacheProjects(owner,json);return Json.read(json);
    }
    public Map<String,Object> project(String owner,String id) {
        return jdbc.query("SELECT * FROM project WHERE id=? AND owner_id=?",(rs,n)->projectRow(rs,true),id,owner).stream().findFirst().orElseThrow(ApiException::notFound);
    }
    public Map<String,Object> createProject(String owner,String title,JsonNode document) {
        String json=validateDocument(document);String name=validateTitle(title);String id=UUID.randomUUID().toString();
        tx.executeWithoutResult(s->{
            jdbc.update("INSERT INTO project(id,owner_id,title,document) VALUES(?,?,?,?)",id,owner,name,json);
            jdbc.update("INSERT INTO project_revision(project_id,revision,title,document) VALUES(?,1,?,?)",id,name,json);
        });
        redis.evictProjects(owner);return project(owner,id);
    }
    public Map<String,Object> saveProject(String owner,String id,long baseRevision,String title,JsonNode document) {
        String json=validateDocument(document);String name=validateTitle(title);
        tx.executeWithoutResult(s->{
            int changed=jdbc.update("UPDATE project SET title=?,document=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP(3) WHERE id=? AND owner_id=? AND revision=?",name,json,id,owner,baseRevision);
            if(changed==0) {
                var current=project(owner,id);
                throw new ApiException(HttpStatus.CONFLICT,"REVISION_CONFLICT","项目已更新，请比较最新版本后保存",Map.of("currentRevision",current.get("revision")));
            }
            jdbc.update("INSERT INTO project_revision(project_id,revision,title,document) VALUES(?,?,?,?)",id,baseRevision+1,name,json);
        });
        redis.evictProjects(owner);return project(owner,id);
    }
    private String validateDocument(JsonNode document) {
        if(document==null || !document.isObject()) throw ApiException.invalid("document 必须为 JSON 对象");
        String json=Json.write(document);
        if(json.getBytes(StandardCharsets.UTF_8).length>settings.maxDocumentBytes()) throw ApiException.invalid("项目文档超过 2MB，请减少节点或媒体内嵌数据");
        return json;
    }
    private String validateTitle(String title) { if(title==null || title.isBlank()) return "未命名创作";if(title.length()>200) throw ApiException.invalid("标题不能超过 200 字");return title.trim(); }
    static Map<String,Object> projectRow(ResultSet rs,boolean detail) throws SQLException {
        var m=new LinkedHashMap<String,Object>();m.put("id",rs.getString("id"));m.put("title",rs.getString("title"));m.put("revision",rs.getLong("revision"));
        if(detail)m.put("document",Json.read(rs.getString("document")));m.put("createdAt",iso(rs,"created_at"));m.put("updatedAt",iso(rs,"updated_at"));return m;
    }
    static String iso(ResultSet rs,String column) throws SQLException {var ts=rs.getTimestamp(column);return ts==null?null:ts.toInstant().toString();}
    public List<Map<String,Object>> assets(String owner,String projectId) {
        if(projectId!=null)project(owner,projectId);
        return projectId==null?jdbc.query("SELECT * FROM asset WHERE owner_id=? ORDER BY created_at DESC LIMIT 200",(rs,n)->assetRow(rs),owner):jdbc.query("SELECT * FROM asset WHERE owner_id=? AND project_id=? ORDER BY created_at DESC LIMIT 200",(rs,n)->assetRow(rs),owner,projectId);
    }
    public Map<String,Object> asset(String owner,String id) {return jdbc.query("SELECT * FROM asset WHERE id=? AND owner_id=?",(rs,n)->assetRow(rs),id,owner).stream().findFirst().orElseThrow(ApiException::notFound);}
    public Map<String,Object> insertAsset(String id,String owner,String project,String name,String mime,long size,String storageName,String hash,String jobId) {
        jdbc.update("INSERT INTO asset(id,owner_id,project_id,display_name,mime_type,size_bytes,storage_name,content_hash,source_job_id) VALUES(?,?,?,?,?,?,?,?,?)",id,owner,project,name,mime,size,storageName,hash,jobId);return asset(owner,id);
    }
    static Map<String,Object> assetRow(ResultSet rs) throws SQLException {
        var m=new LinkedHashMap<String,Object>();String id=rs.getString("id");m.put("id",id);m.put("projectId",rs.getString("project_id"));m.put("name",rs.getString("display_name"));m.put("mimeType",rs.getString("mime_type"));m.put("size",rs.getLong("size_bytes"));m.put("url","/api/assets/"+id+"/content");m.put("createdAt",iso(rs,"created_at"));return m;
    }
    public String storageName(String owner,String assetId) {return jdbc.query("SELECT storage_name FROM asset WHERE id=? AND owner_id=?",(rs,n)->rs.getString(1),assetId,owner).stream().findFirst().orElseThrow(ApiException::notFound);}
}
