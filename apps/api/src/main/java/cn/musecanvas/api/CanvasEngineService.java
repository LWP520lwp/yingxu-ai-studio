package cn.musecanvas.api;

import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;

/** Stores native CanvasProject JSON without reshaping its metadata or the legacy document. */
@Service
public class CanvasEngineService {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final AppSettings settings;

    public CanvasEngineService(JdbcTemplate jdbc, TransactionTemplate transactions, AppSettings settings) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.settings = settings;
    }

    public Map<String, Object> get(String owner, String projectId) {
        return jdbc.query("SELECT p.id AS project_id,c.revision,c.document,c.updated_at FROM project p LEFT JOIN project_canvas_engine c ON c.project_id=p.id WHERE p.id=? AND p.owner_id=?",
            (rs, n) -> snapshot(rs), projectId, owner).stream().findFirst().orElseThrow(ApiException::notFound);
    }

    public Map<String, Object> save(String owner, String projectId, Long baseRevision, JsonNode document) {
        if (baseRevision == null || baseRevision < 0) throw ApiException.invalid("baseRevision 必须为非负整数");
        String json = validateDocument(document);
        return transactions.execute(status -> {
            // The owning project row also serializes two first saves before a snapshot exists.
            var owned = jdbc.queryForList("SELECT id FROM project WHERE id=? AND owner_id=? FOR UPDATE", String.class, projectId, owner);
            if (owned.isEmpty()) throw ApiException.notFound();
            var revisions = jdbc.queryForList("SELECT revision FROM project_canvas_engine WHERE project_id=? FOR UPDATE", Long.class, projectId);
            long revision = revisions.isEmpty() ? 0 : revisions.getFirst();
            if (baseRevision != revision)
                throw new ApiException(HttpStatus.CONFLICT, "CANVAS_ENGINE_REVISION_CONFLICT", "画布引擎快照已更新，请读取最新版本后保存", Map.of("currentRevision", revision));
            if (revision == 0) {
                jdbc.update("INSERT INTO project_canvas_engine(project_id,revision,document) VALUES(?,1,?)", projectId, json);
            } else {
                jdbc.update("UPDATE project_canvas_engine SET document=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP(3) WHERE project_id=?", json, projectId);
            }
            return get(owner, projectId);
        });
    }

    String validateDocument(JsonNode document) {
        if (document == null || !document.isObject()) throw ApiException.invalid("document 必须为 CanvasProject JSON 对象");
        String json = Json.write(document);
        if (json.getBytes(StandardCharsets.UTF_8).length > settings.maxDocumentBytes())
            throw ApiException.invalid("项目文档超过 2MB，请减少节点或媒体内嵌数据");
        JsonNode nodes = document.path("nodes"), connections = document.path("connections");
        if (!nodes.isArray() || !connections.isArray()) throw ApiException.invalid("画布快照必须包含 nodes 和 connections 数组");
        var ids = new HashSet<String>();
        for (JsonNode node : nodes) {
            if (!node.isObject() || !nonempty(node.path("id")) || !ids.add(node.path("id").asString())
                || !nonempty(node.path("type")) || !node.path("title").isString()
                || !node.path("position").isObject() || !finite(node.path("position").path("x"))
                || !finite(node.path("position").path("y")) || !positive(node.path("width")) || !positive(node.path("height")))
                throw ApiException.invalid("画布包含无效节点或重复节点标识");
            if (node.has("metadata") && !node.path("metadata").isObject())
                throw ApiException.invalid("节点 metadata 必须为 JSON 对象");
        }
        var connectionIds = new HashSet<String>();
        for (JsonNode connection : connections) {
            if (!connection.isObject() || !nonempty(connection.path("id")) || !connectionIds.add(connection.path("id").asString())
                || !nonempty(connection.path("fromNodeId")) || !nonempty(connection.path("toNodeId"))
                || !ids.contains(connection.path("fromNodeId").asString()) || !ids.contains(connection.path("toNodeId").asString()))
                throw ApiException.invalid("画布包含无效连接、重复连接标识或不存在的节点引用");
        }
        if (document.has("viewport")) {
            JsonNode viewport = document.path("viewport");
            if (!viewport.isObject() || !finite(viewport.path("x")) || !finite(viewport.path("y")) || !positive(viewport.path("k")))
                throw ApiException.invalid("画布视口必须包含有效的 x、y 和 k");
        }
        return json;
    }

    private static boolean nonempty(JsonNode value) { return value.isString() && !value.asString().isBlank(); }
    private static boolean finite(JsonNode value) { return value.isNumber() && Double.isFinite(value.asDouble()); }
    private static boolean positive(JsonNode value) { return finite(value) && value.asDouble() > 0; }

    private static Map<String, Object> snapshot(ResultSet rs) throws SQLException {
        var result = new LinkedHashMap<String, Object>();
        result.put("projectId", rs.getString("project_id"));
        result.put("revision", rs.getObject("revision") == null ? 0L : rs.getLong("revision"));
        String document = rs.getString("document");
        result.put("document", document == null ? null : Json.read(document));
        result.put("updatedAt", WorkbenchStore.iso(rs, "updated_at"));
        return result;
    }
}
