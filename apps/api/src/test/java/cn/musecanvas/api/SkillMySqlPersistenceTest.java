package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
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
import org.springframework.transaction.support.TransactionTemplate;

@EnabledIfEnvironmentVariable(named = "DB_PASSWORD", matches = ".+")
class SkillMySqlPersistenceTest {
    private JdbcTemplate jdbc;
    private TransactionTemplate tx;
    private SkillService skills;
    private String owner;
    private String other;
    private String temporarySkill;

    @BeforeEach void setup() {
        String url = System.getenv().getOrDefault("DB_URL", "jdbc:mysql://"
            + System.getenv().getOrDefault("DB_HOST", "127.0.0.1") + ":"
            + System.getenv().getOrDefault("DB_PORT", "3308") + "/"
            + System.getenv().getOrDefault("DB_NAME", "workbench") + "?serverTimezone=UTC");
        url += (url.contains("?") ? "&" : "?") + "connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true";
        var datasource = new DriverManagerDataSource(url, System.getenv().getOrDefault("DB_USERNAME", "workbench"), System.getenv("DB_PASSWORD"));
        Flyway.configure().dataSource(datasource).callbacks(new DatabaseCollationCompatibility()).load().migrate();
        jdbc = new JdbcTemplate(datasource);
        tx = new TransactionTemplate(new DataSourceTransactionManager(datasource));
        skills = new SkillService(jdbc, tx, new SkillCatalog());
        owner = UUID.randomUUID().toString();
        other = UUID.randomUUID().toString();
        for (String id : List.of(owner, other)) {
            jdbc.update("INSERT INTO app_user(id,provider,external_id,display_name) VALUES(?,'test',?,'skill test')", id, id);
        }
    }

    @AfterEach void cleanup() {
        if (jdbc == null || owner == null) return;
        jdbc.update("DELETE FROM user_skill_installation WHERE owner_id IN (?,?)", owner, other);
        jdbc.update("DELETE FROM user_skill_favorite WHERE owner_id IN (?,?)", owner, other);
        var imported = jdbc.queryForList("SELECT skill_id FROM user_skill_package WHERE owner_id IN (?,?)", String.class, owner, other);
        jdbc.update("DELETE FROM user_skill_package WHERE owner_id IN (?,?)", owner, other);
        for (String id : imported) jdbc.update("DELETE FROM skill_definition WHERE skill_id=?", id);
        jdbc.update("DELETE FROM app_user WHERE id IN (?,?)", owner, other);
        if (temporarySkill != null) jdbc.update("DELETE FROM skill_definition WHERE skill_id=?", temporarySkill);
    }

    @Test void installsAreDurableIdempotentAndScopedToTheSessionOwner() {
        skills.install(owner, "image-create", "1.0.0");
        skills.install(owner, "image-create", "1.0.0");
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM user_skill_installation WHERE owner_id=?", Integer.class, owner));
        assertEquals(false, skills.detail(other, "image-create").get("installed"));
        assertEquals(false, skills.detail(null, "image-create").get("installed"));
        var restored = new SkillService(jdbc, tx, new SkillCatalog());
        assertEquals(1, restored.workspace(owner).size());
        assertEquals("1.0.0", restored.workspace(owner).getFirst().get("installedVersion"));

        skills.install(other, "image-create", "1.0.0");
        skills.uninstall(owner, "image-create");
        skills.uninstall(owner, "image-create");
        assertTrue(skills.workspace(owner).isEmpty());
        assertEquals(true, skills.detail(other, "image-create").get("installed"));
    }

    @Test void plannedUnknownAndStaleRecipesCannotCreateAnInstallation() {
        assertEquals("SKILL_NOT_AVAILABLE", assertThrows(ApiException.class,
            () -> skills.install(owner, "storyboard-to-video", "0.1.0")).code);
        assertEquals("SKILL_VERSION_CHANGED", assertThrows(ApiException.class,
            () -> skills.install(owner, "image-create", "9.9.9")).code);
        assertEquals("NOT_FOUND", assertThrows(ApiException.class,
            () -> skills.install(owner, "remote-package", "1.0.0")).code);
        assertEquals("INVALID_REQUEST", assertThrows(ApiException.class,
            () -> skills.install(owner, "image-create", null)).code);
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM user_skill_installation WHERE owner_id=?", Integer.class, owner));
    }

    @Test void favoritesPersistAcrossProcessesAndRemainIndependentOfInstallationsAndOtherUsers() {
        skills.favorite(owner, "science-visual", true);
        skills.favorite(owner, "science-visual", true);
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM user_skill_favorite WHERE owner_id=?", Integer.class, owner));
        assertEquals(false, skills.detail(other, "science-visual").get("favorite"));
        assertEquals(false, skills.detail(null, "science-visual").get("favorite"));
        var restored = new SkillService(jdbc, tx, new SkillCatalog());
        assertEquals(true, restored.detail(owner, "science-visual").get("favorite"));
        assertEquals(true, restored.directory(owner).stream().filter(row -> "science-visual".equals(row.get("id"))).findFirst().orElseThrow().get("favorite"));
        assertTrue(restored.workspace(owner).isEmpty());
        skills.install(owner, "science-visual", "1.0.0");
        skills.favorite(other, "science-visual", true);
        skills.favorite(owner, "science-visual", false);
        skills.favorite(owner, "science-visual", false);
        assertEquals(false, skills.detail(owner, "science-visual").get("favorite"));
        assertEquals(true, skills.detail(other, "science-visual").get("favorite"));
        assertEquals(true, skills.detail(owner, "science-visual").get("installed"));
        assertEquals("NOT_FOUND", assertThrows(ApiException.class, () -> skills.favorite(owner, "unknown", true)).code);
    }

    @Test void aNewReleasePreservesPinnedRecipesUntilAnExplicitUpgrade() {
        temporarySkill = "test-" + UUID.randomUUID();
        var first = fixture(temporarySkill, "1.0.0", "Original");
        first.install(owner, temporarySkill, "1.0.0");
        var latest = fixture(temporarySkill, "1.1.0", "Improved");
        var workspace = latest.workspace(owner).getFirst();
        assertEquals("1.0.0", workspace.get("recipeVersion"));
        assertEquals("1.0.0", workspace.get("installedVersion"));
        assertEquals("1.1.0", workspace.get("latestVersion"));
        assertEquals(true, workspace.get("updateAvailable"));
        assertEquals("SKILL_VERSION_CHANGED", assertThrows(ApiException.class,
            () -> latest.install(owner, temporarySkill, "1.0.0")).code);
        latest.install(owner, temporarySkill, "1.1.0");
        assertEquals("1.1.0", latest.workspace(owner).getFirst().get("installedVersion"));
        assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM skill_definition WHERE skill_id=?", Integer.class, temporarySkill));

        var changedWithoutVersion = fixture(temporarySkill, "1.1.0", "Changed without a version bump");
        assertThrows(IllegalStateException.class, () -> changedWithoutVersion.directory(null));
    }

    @Test void importsArePrivateDurableVersionedAndAcceptedByRealJobValidation() {
        var parsed = SkillPackageParserTest.parse("skill.json", SkillPackageParserTest.example());
        var imported = skills.importPackage(owner, parsed);
        String id = String.valueOf(imported.get("id"));
        assertTrue(id.startsWith("private-")); assertEquals(true, imported.get("installed"));
        assertEquals("imported", imported.get("source"));
        assertEquals(id, skills.importPackage(owner, parsed).get("id"));
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM user_skill_package WHERE owner_id=?", Integer.class, owner));
        assertThrows(ApiException.class, () -> skills.detail(other, id));
        assertThrows(ApiException.class, () -> skills.detail(null, id));
        assertThrows(ApiException.class, () -> skills.install(other, id, "1.0.0"));
        assertThrows(ApiException.class, () -> skills.favorite(other, id, true));
        assertFalse(skills.directory(other).stream().anyMatch(row -> id.equals(row.get("id"))));
        assertFalse(skills.directory(null).stream().anyMatch(row -> id.equals(row.get("id"))));
        var restarted = new SkillService(jdbc, tx, new SkillCatalog());
        assertEquals(id, restarted.workspace(owner).getFirst().get("id"));
        assertTrue(String.valueOf(restarted.detail(owner, id).get("recipe")).contains("按科学示意表现"));
        var request = new JobService.Request("project", "node", "video", "按科学示意表现：卫星运动", "muse-video", 1280, 720, 8, List.of(), id, "1.0.0");
        assertDoesNotThrow(() -> restarted.validateJob(owner, request));
        assertThrows(ApiException.class, () -> restarted.validateJob(other, request));
        assertThrows(ApiException.class, () -> restarted.validateJob(owner, new JobService.Request("p", "n", "image", "text", "muse-image", 1024, 1024, 5, List.of(), id, "1.0.0")));
        skills.uninstall(owner, id);
        assertThrows(ApiException.class, () -> restarted.validateJob(owner, request));
        skills.install(owner, id, "1.0.0");
        var conflict = SkillPackageParserTest.parse("skill.json", SkillPackageParserTest.example().replace("保持尺度与运动连贯", "不同内容"));
        assertEquals("SKILL_VERSION_CONFLICT", assertThrows(ApiException.class, () -> skills.importPackage(owner, conflict)).code);
        var next = SkillPackageParserTest.parse("skill.json", SkillPackageParserTest.example().replace("1.0.0", "1.1.0"));
        skills.importPackage(owner, next);
        assertEquals("1.1.0", skills.detail(owner, id).get("installedVersion"));
        assertThrows(ApiException.class, () -> restarted.validateJob(owner, request));
        var otherImport = skills.importPackage(other, parsed);
        assertNotEquals(id, otherImport.get("id"));
        assertThrows(ApiException.class, () -> skills.detail(owner, String.valueOf(otherImport.get("id"))));
    }

    private SkillService fixture(String id, String version, String name) {
        var manifest = Json.read(Json.write(Map.of("id", id, "name", name, "recipeVersion", version,
            "capability", "image", "status", "available", "inputSchema", Map.of("type", "object"),
            "recipe", Map.of("operation", "generation-job", "method", "POST", "path", "/api/jobs", "kind", "image"))));
        var definition = SkillCatalog.parse(manifest);
        var catalog = mock(SkillCatalog.class);
        when(catalog.definitions()).thenReturn(List.of(definition));
        when(catalog.find(id)).thenReturn(definition);
        when(catalog.require(id)).thenReturn(definition);
        return new SkillService(jdbc, tx, catalog);
    }
}

