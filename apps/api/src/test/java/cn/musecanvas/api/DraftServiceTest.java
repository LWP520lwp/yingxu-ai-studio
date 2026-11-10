package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.DefaultTransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;

/** Real MySQL transaction and keyset tests; fixtures roll back and never create supplier jobs. */
@EnabledIfEnvironmentVariable(named="DB_PASSWORD", matches=".+")
class DraftServiceTest {
    private JdbcTemplate jdbc;
    private DataSourceTransactionManager manager;
    private TransactionStatus isolation;
    private DraftService drafts;
    private String owner;
    private String other;

    @BeforeEach void setup() {
        String url = System.getenv().getOrDefault("DB_URL", "jdbc:mysql://" + System.getenv().getOrDefault("DB_HOST", "127.0.0.1")
            + ":" + System.getenv().getOrDefault("DB_PORT", "3308") + "/" + System.getenv().getOrDefault("DB_NAME", "workbench") + "?serverTimezone=UTC");
        url += (url.contains("?") ? "&" : "?") + "connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true";
        var dataSource = new DriverManagerDataSource(url, System.getenv().getOrDefault("DB_USERNAME", "workbench"), System.getenv("DB_PASSWORD"));
        Flyway.configure().dataSource(dataSource).callbacks(new DatabaseCollationCompatibility()).load().migrate();
        jdbc = new JdbcTemplate(dataSource);
        manager = new DataSourceTransactionManager(dataSource);
        isolation = manager.getTransaction(new DefaultTransactionDefinition());
        drafts = new DraftService(jdbc, new TransactionTemplate(manager), mock(RedisSupport.class));
        owner = UUID.randomUUID().toString(); other = UUID.randomUUID().toString();
        for (String id : List.of(owner, other))
            jdbc.update("INSERT INTO app_user(id,provider,external_id,display_name) VALUES(?,'test',?,'draft test')", id, id);
    }

    @AfterEach void cleanup() { if (isolation != null) manager.rollback(isolation); }

    @Test void createsOnlyTheChosenNativeDraftAndListsOnlyTheOwnersSeparateSnapshots() {
        var canvas = drafts.create(owner, "canvas", "画布草稿");
        var science = drafts.create(owner, "science", "科普草稿");
        var foreign = drafts.create(other, "canvas", "不可见作品");
        String canvasId = (String) canvas.get("projectId"), scienceId = (String) science.get("projectId");
        assertEquals(0, count("project_science_video", canvasId));
        assertEquals(0, count("project_canvas_engine", scienceId));
        assertEquals(1, count("project_revision", canvasId));
        assertEquals(1L, canvas.get("revision"));
        JsonNode canvasDocument = Json.read(jdbc.queryForObject("SELECT document FROM project_canvas_engine WHERE project_id=?", String.class, canvasId));
        assertEquals(canvasId, canvasDocument.path("id").asString());
        assertTrue(canvasDocument.path("nodes").isArray());
        assertTrue(canvasDocument.path("connections").isArray());
        var canvasPage = page(owner, "canvas", "", 24, null);
        assertEquals(1, canvasPage.path("items").size());
        assertEquals(canvasId, canvasPage.path("items").get(0).path("projectId").asString());
        assertFalse(canvasPage.path("items").get(0).has("document"));
        assertEquals(foreign.get("projectId"), page(other, "canvas", "", 24, null).path("items").get(0).path("projectId").asString());

        jdbc.update("UPDATE project_science_video SET document=JSON_SET(document,'$.title','独立成片标题','$.scenes',JSON_ARRAY(JSON_OBJECT('id','one'))) WHERE project_id=?", scienceId);
        var sciencePage = page(owner, "science", "独立", 24, null);
        assertEquals(1, sciencePage.path("items").size());
        assertEquals("独立成片标题", sciencePage.path("items").get(0).path("title").asString());
        assertEquals(1, sciencePage.path("items").get(0).path("itemCount").asInt());
        assertEquals("画布草稿", page(owner, "canvas", "", 24, null).path("items").get(0).path("title").asString());
    }

    @Test void paginatesEqualTimestampsWithoutDuplicatesAndTreatsSearchWildcardsLiterally() {
        var ids = new ArrayList<String>();
        for (String name : List.of("第一稿", "第二稿", "100%_完成")) {
            String id = (String) drafts.create(owner, "canvas", name).get("projectId");
            ids.add(id);
            jdbc.update("UPDATE project_canvas_engine SET updated_at='2026-11-10 12:00:00.123' WHERE project_id=?", id);
        }
        ids.sort(Comparator.reverseOrder());
        JsonNode first = page(owner, "canvas", "", 2, null);
        assertEquals(2, first.path("items").size());
        String cursor = first.path("nextCursor").asString();
        assertFalse(cursor.isBlank());
        JsonNode second = page(owner, "canvas", "", 2, cursor);
        assertEquals(1, second.path("items").size());
        assertTrue(second.path("nextCursor").isNull());
        var seen = new ArrayList<String>();
        for (JsonNode item : first.path("items")) seen.add(item.path("projectId").asString());
        for (JsonNode item : second.path("items")) seen.add(item.path("projectId").asString());
        assertEquals(ids, seen);
        assertEquals(1, page(owner, "canvas", "%_", 24, null).path("items").size());
        assertThrows(ApiException.class, () -> drafts.list(owner, "science", "", 2, cursor));
        assertThrows(ApiException.class, () -> drafts.list(owner, "canvas", "changed", 2, cursor));
    }

    @Test void rejectsInvalidOrUnboundedRequestsBeforeCreatingAnyProject() {
        for (String kind : List.of("", "Canvas", "video", "project_canvas_engine"))
            assertThrows(ApiException.class, () -> drafts.create(owner, kind, "invalid"));
        assertThrows(ApiException.class, () -> drafts.create(owner, "canvas", "x".repeat(201)));
        assertThrows(ApiException.class, () -> drafts.create(owner, "science", "invalid\nname"));
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM project WHERE owner_id=?", Integer.class, owner));
        assertThrows(ApiException.class, () -> drafts.list(owner, "canvas", "x".repeat(121), 24, null));
        assertThrows(ApiException.class, () -> drafts.list(owner, "canvas", "", 0, null));
        assertThrows(ApiException.class, () -> drafts.list(owner, "canvas", "", 61, null));
        assertThrows(ApiException.class, () -> drafts.list(owner, "canvas", "", 24, "not-a-json-cursor"));
        assertThrows(ApiException.class, () -> drafts.list(owner, "canvas", "", 24, "a".repeat(2049)));
    }

    @Test void renamesOnlyTheChosenNativeTitleAndPreservesBothDocumentsAndLegacyRevision() {
        String id = (String) drafts.create(owner, "canvas", "原画布").get("projectId");
        jdbc.update("UPDATE project_canvas_engine SET document=JSON_SET(document,'$.metadata',JSON_OBJECT('note','保留节点与聊天'),'$.nodes',JSON_ARRAY(JSON_OBJECT('id','node-1','text','不能被名称请求覆盖'))) WHERE project_id=?", id);
        jdbc.update("INSERT INTO project_science_video(project_id,revision,document) VALUES(?,7,?)", id, "{\"title\":\"独立科普\",\"scenes\":[{\"id\":\"scene-1\",\"narration\":\"原始讲稿\"}],\"sources\":[{\"id\":\"source-1\"}]}");
        String canvasContent = withoutTitle("project_canvas_engine", id), scienceContent = withoutTitle("project_science_video", id);
        String legacy = jdbc.queryForObject("SELECT JSON_OBJECT('title',title,'revision',revision,'document',document) FROM project WHERE id=?", String.class, id);

        var canvas = drafts.rename(owner, id, "canvas", "  新的画布名称  ", 1L);
        assertEquals("新的画布名称", canvas.get("title"));
        assertEquals(2L, canvas.get("revision"));
        assertEquals(1, canvas.get("itemCount"));
        assertEquals(canvasContent, withoutTitle("project_canvas_engine", id));
        assertEquals("独立科普", page(owner, "science", "", 24, null).path("items").get(0).path("title").asString());
        assertEquals(7L, page(owner, "science", "", 24, null).path("items").get(0).path("revision").asLong());

        var science = drafts.rename(owner, id, "science", "科普 \"引号\" 与\\字符", 7L);
        assertEquals("科普 \"引号\" 与\\字符", science.get("title"));
        assertEquals(8L, science.get("revision"));
        assertEquals(scienceContent, withoutTitle("project_science_video", id));
        assertEquals("新的画布名称", page(owner, "canvas", "新的画布", 24, null).path("items").get(0).path("title").asString());
        assertEquals(0, page(owner, "science", "独立科普", 24, null).path("items").size());
        assertEquals(legacy, jdbc.queryForObject("SELECT JSON_OBJECT('title',title,'revision',revision,'document',document) FROM project WHERE id=?", String.class, id));
        assertEquals(1, count("project_revision", id));
    }

    @Test void staleRenamesAndStaleEditorSavesCannotOverwriteANameOrDocument() {
        String id = (String) drafts.create(owner, "canvas", "原名称").get("projectId");
        JsonNode before = Json.read(jdbc.queryForObject("SELECT document FROM project_canvas_engine WHERE project_id=?", String.class, id));
        drafts.rename(owner, id, "canvas", "新名称", 1L);
        var conflict = assertThrows(ApiException.class, () -> drafts.rename(owner, id, "canvas", "旧列表提交", 1L));
        assertEquals(HttpStatus.CONFLICT, conflict.status);
        assertEquals("DRAFT_REVISION_CONFLICT", conflict.code);
        assertEquals(2L, conflict.details.get("currentRevision"));
        AppSettings settings = mock(AppSettings.class);when(settings.maxDocumentBytes()).thenReturn(2097152);
        var canvas = new CanvasEngineService(jdbc, new TransactionTemplate(manager), settings);
        assertEquals(HttpStatus.CONFLICT, assertThrows(ApiException.class, () -> canvas.save(owner, id, 1L, before)).status);
        assertEquals("新名称", page(owner, "canvas", "", 24, null).path("items").get(0).path("title").asString());
        assertEquals(2L, page(owner, "canvas", "", 24, null).path("items").get(0).path("revision").asLong());
    }

    @Test void renameHidesForeignOrMissingNativeDraftsAndRejectsInvalidNamesAndRevisions() {
        String id = (String) drafts.create(owner, "science", "原科普").get("projectId");
        assertEquals(HttpStatus.NOT_FOUND, assertThrows(ApiException.class, () -> drafts.rename(other, id, "science", "越权名称", 1L)).status);
        assertEquals(HttpStatus.NOT_FOUND, assertThrows(ApiException.class, () -> drafts.rename(owner, id, "canvas", "不存在的画布", 1L)).status);
        for (String title : List.of("", "   ", "名称\n包含换行", "x".repeat(201)))
            assertEquals(HttpStatus.BAD_REQUEST, assertThrows(ApiException.class, () -> drafts.rename(owner, id, "science", title, 1L)).status);
        assertThrows(ApiException.class, () -> drafts.rename(owner, id, "science", null, 1L));
        assertThrows(ApiException.class, () -> drafts.rename(owner, id, "science", "新名", null));
        assertThrows(ApiException.class, () -> drafts.rename(owner, id, "science", "新名", 0L));
        assertThrows(ApiException.class, () -> drafts.rename(owner, id, "other", "新名", 1L));
        assertEquals("原科普", page(owner, "science", "", 24, null).path("items").get(0).path("title").asString());
        assertEquals(1L, page(owner, "science", "", 24, null).path("items").get(0).path("revision").asLong());
    }

    private JsonNode page(String user, String kind, String query, int limit, String cursor) {
        return Json.read(Json.write(drafts.list(user, kind, query, limit, cursor)));
    }
    private int count(String table, String project) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE project_id=?", Integer.class, project);
    }
    private String withoutTitle(String table, String project) {
        return jdbc.queryForObject("SELECT JSON_REMOVE(document,'$.title') FROM " + table + " WHERE project_id=?", String.class, project);
    }
}
