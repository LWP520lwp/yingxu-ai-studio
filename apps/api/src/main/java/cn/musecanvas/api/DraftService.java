package cn.musecanvas.api;

import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/** Lists independent native snapshots without loading their large JSON documents into the API. */
@Service
public class DraftService {
    private enum Kind {
        canvas("project_canvas_engine", "nodes", "画布草稿"),
        science("project_science_video", "scenes", "科普短视频草稿");

        final String table;
        final String items;
        final String defaultTitle;
        Kind(String table, String items, String defaultTitle) {
            this.table = table;
            this.items = items;
            this.defaultTitle = defaultTitle;
        }
        static Kind read(String value) {
            try { return Kind.valueOf(value == null ? "" : value); }
            catch (IllegalArgumentException error) { throw ApiException.invalid("草稿类型须为 canvas 或 science"); }
        }
        String titleSql() {
            return "COALESCE(NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(d.document,'$.title'))),''),p.title)";
        }
    }

    private record Cursor(Instant time, String projectId) {}
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final RedisSupport redis;

    public DraftService(JdbcTemplate jdbc, TransactionTemplate transactions, RedisSupport redis) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.redis = redis;
    }

    public Map<String, Object> list(String owner, String requestedKind, String query, Integer requestedLimit, String cursor) {
        Kind kind = Kind.read(requestedKind);
        String search = query == null ? "" : query.strip();
        if (search.length() > 120 || search.codePoints().anyMatch(Character::isISOControl))
            throw ApiException.invalid("草稿搜索词最多120字符，且不能包含控制字符");
        int limit = requestedLimit == null ? 24 : requestedLimit;
        if (limit < 1 || limit > 60) throw ApiException.invalid("每页草稿数量须为1至60");
        Cursor after = readCursor(cursor, kind, search);
        StringBuilder sql = new StringBuilder("SELECT d.project_id,d.revision,d.updated_at,")
            .append(kind.titleSql()).append(" AS draft_title,COALESCE(JSON_LENGTH(JSON_EXTRACT(d.document,'$.")
            .append(kind.items).append("')),0) AS item_count FROM ").append(kind.table)
            .append(" d JOIN project p ON p.id=d.project_id WHERE p.owner_id=?");
        List<Object> parameters = new ArrayList<>();
        parameters.add(owner);
        if (!search.isEmpty()) {
            sql.append(" AND ").append(kind.titleSql()).append(" LIKE ? ESCAPE '!'");
            parameters.add("%" + search.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%");
        }
        if (after != null) {
            sql.append(" AND (d.updated_at<? OR (d.updated_at=? AND d.project_id<?))");
            parameters.add(Timestamp.from(after.time()));
            parameters.add(Timestamp.from(after.time()));
            parameters.add(after.projectId());
        }
        sql.append(" ORDER BY d.updated_at DESC,d.project_id DESC LIMIT ?");
        parameters.add(limit + 1);
        List<Map<String, Object>> rows = jdbc.query(sql.toString(), (rs, index) -> summary(rs, kind), parameters.toArray());
        boolean more = rows.size() > limit;
        List<Map<String, Object>> items = more ? List.copyOf(rows.subList(0, limit)) : List.copyOf(rows);
        var result = new LinkedHashMap<String, Object>();
        result.put("items", items);
        result.put("nextCursor", more ? encodeCursor(kind, search, items.getLast()) : null);
        return result;
    }

    /** Project, legacy revision, and exactly one native snapshot commit together. */
    public Map<String, Object> create(String owner, String requestedKind, String requestedTitle) {
        Kind kind = Kind.read(requestedKind);
        String title = requestedTitle == null || requestedTitle.isBlank() ? kind.defaultTitle : requestedTitle.strip();
        if (title.length() > 200 || title.codePoints().anyMatch(Character::isISOControl))
            throw ApiException.invalid("草稿标题最多200字符，且不能包含控制字符");
        String id = UUID.randomUUID().toString();
        String legacy = "{\"schemaVersion\":1,\"nodes\":[],\"edges\":[],\"viewport\":{\"x\":0,\"y\":0,\"zoom\":1}}";
        String document;
        if (kind == Kind.science) {
            var empty = ScienceVideoDocument.empty();
            var fields = new LinkedHashMap<String, Object>();
            for (String key : empty.propertyNames()) fields.put(key, empty.get(key));
            fields.put("title", title);
            document = Json.write(fields);
        } else {
            var fields = new LinkedHashMap<String, Object>();
            fields.put("id", id); fields.put("title", title);
            fields.put("nodes", List.of()); fields.put("connections", List.of());
            fields.put("chatSessions", List.of()); fields.put("activeChatId", null);
            fields.put("backgroundMode", "dots"); fields.put("showImageInfo", false);
            fields.put("viewport", Map.of("x", 0, "y", 0, "k", 1));
            fields.put("createdAt", Instant.now().toString()); fields.put("updatedAt", fields.get("createdAt"));
            document = Json.write(fields);
        }
        Map<String, Object> created = transactions.execute(status -> {
            jdbc.update("INSERT INTO project(id,owner_id,title,document) VALUES(?,?,?,?)", id, owner, title, legacy);
            jdbc.update("INSERT INTO project_revision(project_id,revision,title,document) VALUES(?,1,?,?)", id, title, legacy);
            jdbc.update("INSERT INTO " + kind.table + "(project_id,revision,document) VALUES(?,1,?)", id, document);
            return jdbc.query("SELECT d.project_id,d.revision,d.updated_at," + kind.titleSql()
                + " AS draft_title,0 AS item_count FROM " + kind.table + " d JOIN project p ON p.id=d.project_id WHERE d.project_id=? AND p.owner_id=?",
                (rs, index) -> summary(rs, kind), id, owner).getFirst();
        });
        redis.evictProjects(owner);
        return created;
    }

    /** Patch only the selected snapshot title; never replay a client copy of its document. */
    public Map<String, Object> rename(String owner, String projectId, String requestedKind, String requestedTitle, Long baseRevision) {
        Kind kind = Kind.read(requestedKind);
        String title = requestedTitle == null ? "" : requestedTitle.strip();
        if (title.isEmpty() || title.length() > 200 || title.codePoints().anyMatch(Character::isISOControl))
            throw ApiException.invalid("草稿名称须为1至200字符，且不能包含控制字符");
        if (baseRevision == null || baseRevision < 1) throw ApiException.invalid("baseRevision 必须为正整数");
        Map<String, Object> renamed = transactions.execute(status -> {
            // Use the same lock order as the native editors and hide foreign snapshots as 404.
            if (jdbc.queryForList("SELECT id FROM project WHERE id=? AND owner_id=? FOR UPDATE", String.class, projectId, owner).isEmpty())
                throw ApiException.notFound();
            var revisions = jdbc.queryForList("SELECT revision FROM " + kind.table + " WHERE project_id=? FOR UPDATE", Long.class, projectId);
            if (revisions.isEmpty()) throw ApiException.notFound();
            long current = revisions.getFirst();
            if (baseRevision != current)
                throw new ApiException(HttpStatus.CONFLICT, "DRAFT_REVISION_CONFLICT", "草稿已更新，请刷新列表后重新命名", Map.of("kind", kind.name(), "currentRevision", current));
            jdbc.update("UPDATE " + kind.table + " SET document=JSON_SET(document,'$.title',?),revision=revision+1,updated_at=CURRENT_TIMESTAMP(3) WHERE project_id=?", title, projectId);
            return jdbc.query("SELECT d.project_id,d.revision,d.updated_at," + kind.titleSql()
                + " AS draft_title,COALESCE(JSON_LENGTH(JSON_EXTRACT(d.document,'$." + kind.items + "')),0) AS item_count FROM "
                + kind.table + " d JOIN project p ON p.id=d.project_id WHERE d.project_id=? AND p.owner_id=?",
                (rs, index) -> summary(rs, kind), projectId, owner).getFirst();
        });
        redis.evictProjects(owner);
        return renamed;
    }

    private static Map<String, Object> summary(ResultSet rs, Kind kind) throws SQLException {
        var row = new LinkedHashMap<String, Object>();
        row.put("projectId", rs.getString("project_id"));
        row.put("kind", kind.name());
        row.put("title", rs.getString("draft_title"));
        row.put("revision", rs.getLong("revision"));
        row.put("updatedAt", WorkbenchStore.iso(rs, "updated_at"));
        row.put("itemCount", rs.getInt("item_count"));
        return row;
    }

    private static Cursor readCursor(String value, Kind kind, String query) {
        if (value == null || value.isBlank()) return null;
        if (value.length() > 2048 || !value.matches("[A-Za-z0-9_-]+")) throw ApiException.invalid("草稿分页游标无效");
        try {
            var data = Json.read(new String(Base64.getUrlDecoder().decode(value), StandardCharsets.UTF_8));
            if (data.path("version").asInt() != 1 || !kind.name().equals(data.path("kind").asString())
                || !query.equals(data.path("query").asString())) throw new IllegalArgumentException();
            String id = data.path("projectId").asString();
            UUID.fromString(id);
            Instant time = Instant.parse(data.path("time").asString());
            if (time.isBefore(Instant.parse("2000-01-01T00:00:00Z")) || time.isAfter(Instant.parse("2100-01-01T00:00:00Z")))
                throw new IllegalArgumentException();
            return new Cursor(time, id);
        } catch (Exception error) { throw ApiException.invalid("草稿分页游标无效或已更换搜索条件"); }
    }

    private static String encodeCursor(Kind kind, String query, Map<String, Object> last) {
        String json = Json.write(Map.of("version", 1, "kind", kind.name(), "query", query,
            "projectId", last.get("projectId"), "time", last.get("updatedAt")));
        return Base64.getUrlEncoder().withoutPadding().encodeToString(json.getBytes(StandardCharsets.UTF_8));
    }
}
