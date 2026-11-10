package cn.musecanvas.api;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.HashSet;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class SkillService {
    private record Installation(String version, String installedAt, String updatedAt) {}
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final SkillCatalog catalog;
    private volatile boolean published;

    public SkillService(JdbcTemplate jdbc, TransactionTemplate tx, SkillCatalog catalog) {
        this.jdbc = jdbc;
        this.tx = tx;
        this.catalog = catalog;
    }

    /** Publishes immutable release definitions once per process, after Flyway has run. */
    synchronized void publishDefinitions() {
        if (published) return;
        tx.executeWithoutResult(status -> {
            for (var definition : catalog.definitions()) {
                String manifest = Json.write(definition.manifest());
                String hash = Json.hash(manifest);
                jdbc.update("INSERT INTO skill_definition(skill_id,recipe_version,manifest,manifest_hash) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE recipe_version=VALUES(recipe_version)",
                    definition.id(), definition.recipeVersion(), manifest, hash);
                String existing = jdbc.queryForObject("SELECT manifest_hash FROM skill_definition WHERE skill_id=? AND recipe_version=?", String.class,
                    definition.id(), definition.recipeVersion());
                if (!hash.equals(existing)) throw new IllegalStateException("A published skill recipe is immutable; increment its recipeVersion before changing it");
            }
        });
        published = true;
    }

    public List<Map<String, Object>> directory(String owner) {
        publishDefinitions();
        Map<String, Installation> installed = installations(owner);
        Set<String> favorites = favorites(owner);
        var definitions = new java.util.ArrayList<>(catalog.definitions());
        if (owner != null) definitions.addAll(jdbc.query("SELECT d.manifest FROM user_skill_package p JOIN skill_definition d ON d.skill_id=p.skill_id AND d.recipe_version=p.recipe_version WHERE p.owner_id=? ORDER BY p.updated_at DESC,p.skill_id",
            (rs, n) -> SkillCatalog.parse(Json.read(rs.getString("manifest"))), owner));
        return definitions.stream().map(definition -> view(definition, installed.get(definition.id()), favorites.contains(definition.id()), false)).toList();
    }

    public Map<String, Object> detail(String owner, String id) {
        var definition = require(owner, id);
        publishDefinitions();
        return view(definition, installation(owner, id), favorites(owner).contains(id), true);
    }

    public List<Map<String, Object>> workspace(String owner) {
        publishDefinitions();
        Set<String> favorites = favorites(owner);
        return jdbc.query("SELECT d.manifest,i.recipe_version,i.installed_at,i.updated_at FROM user_skill_installation i JOIN skill_definition d ON d.skill_id=i.skill_id AND d.recipe_version=i.recipe_version WHERE i.owner_id=? ORDER BY i.installed_at DESC,i.skill_id",
            (rs, n) -> {
                var definition = SkillCatalog.parse(Json.read(rs.getString("manifest")));
                return view(definition, installationRow(rs), favorites.contains(definition.id()), false);
            }, owner);
    }

    public Map<String, Object> install(String owner, String id, String recipeVersion) {
        var definition = require(owner, id);
        if (!definition.installable()) throw new ApiException(HttpStatus.CONFLICT, "SKILL_NOT_AVAILABLE", "该技能仍在规划中，暂不能安装或执行");
        if (recipeVersion == null || recipeVersion.isBlank()) throw ApiException.invalid("recipeVersion 必填，请先读取技能详情");
        if (!definition.recipeVersion().equals(recipeVersion)) {
            throw new ApiException(HttpStatus.CONFLICT, "SKILL_VERSION_CHANGED", "技能版本已变化，请确认最新配方后安装", Map.of("currentVersion", definition.recipeVersion()));
        }
        publishDefinitions();
        return tx.execute(status -> {
            jdbc.update("INSERT INTO user_skill_installation(owner_id,skill_id,recipe_version) VALUES(?,?,?) ON DUPLICATE KEY UPDATE updated_at=IF(recipe_version<>VALUES(recipe_version),CURRENT_TIMESTAMP(3),updated_at),recipe_version=VALUES(recipe_version)",
                owner, id, recipeVersion);
            return view(definition, installation(owner, id), favorites(owner).contains(id), true);
        });
    }

    public Map<String, Object> uninstall(String owner, String id) {
        require(owner, id);
        jdbc.update("DELETE FROM user_skill_installation WHERE owner_id=? AND skill_id=?", owner, id);
        return Map.of("ok", true, "id", id, "installed", false);
    }

    public Map<String, Object> favorite(String owner, String id, boolean favorite) {
        var definition = require(owner, id);
        publishDefinitions();
        return tx.execute(status -> {
            if (favorite) jdbc.update("INSERT INTO user_skill_favorite(owner_id,skill_id) VALUES(?,?) ON DUPLICATE KEY UPDATE skill_id=VALUES(skill_id)", owner, id);
            else jdbc.update("DELETE FROM user_skill_favorite WHERE owner_id=? AND skill_id=?", owner, id);
            return view(definition, installation(owner, id), favorite, true);
        });
    }

    private Set<String> favorites(String owner) {
        if (owner == null) return Set.of();
        return new HashSet<>(jdbc.queryForList("SELECT skill_id FROM user_skill_favorite WHERE owner_id=?", String.class, owner));
    }

    private SkillCatalog.Definition require(String owner, String id) {
        var builtIn = catalog.find(id);
        if (builtIn != null) return builtIn;
        if (owner == null || id == null || !id.matches("[a-z][a-z0-9-]{0,63}")) throw ApiException.notFound();
        return jdbc.query("SELECT d.manifest FROM user_skill_package p JOIN skill_definition d ON d.skill_id=p.skill_id AND d.recipe_version=p.recipe_version WHERE p.owner_id=? AND p.skill_id=?",
            (rs, n) -> SkillCatalog.parse(Json.read(rs.getString("manifest"))), owner, id).stream().findFirst().orElseThrow(ApiException::notFound);
    }

    public Map<String, Object> importPackage(String owner, SkillPackageParser.Parsed parsed) {
        if (owner == null) throw ApiException.notFound();
        publishDefinitions();
        String id = "private-" + Json.hash(owner + ":" + parsed.sourceId()).substring(0, 48);
        var fields = new LinkedHashMap<String, Object>();
        for (String key : parsed.manifest().propertyNames()) fields.put(key, parsed.manifest().path(key));
        fields.put("id", id);
        fields.put("sourceId", parsed.sourceId());
        var definition = SkillCatalog.parse(Json.read(Json.write(fields)));
        String manifest = Json.write(canonical(definition.manifest())), hash = Json.hash(manifest);
        return tx.execute(status -> {
            jdbc.queryForObject("SELECT id FROM app_user WHERE id=? FOR UPDATE", String.class, owner);
            Integer known = jdbc.queryForObject("SELECT COUNT(*) FROM user_skill_package WHERE owner_id=? AND skill_id=?", Integer.class, owner, id);
            Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM user_skill_package WHERE owner_id=?", Integer.class, owner);
            if (known == 0 && count >= 100) throw new ApiException(HttpStatus.CONFLICT, "SKILL_LIBRARY_FULL", "最多导入 100 个个人 Skill");
            jdbc.update("INSERT INTO skill_definition(skill_id,recipe_version,manifest,manifest_hash) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE recipe_version=VALUES(recipe_version)", id, definition.recipeVersion(), manifest, hash);
            String existing = jdbc.queryForObject("SELECT manifest_hash FROM skill_definition WHERE skill_id=? AND recipe_version=?", String.class, id, definition.recipeVersion());
            if (!hash.equals(existing)) throw new ApiException(HttpStatus.CONFLICT, "SKILL_VERSION_CONFLICT", "此 Skill 的同版本配方已存在且内容不同，请提高版本号后再导入");
            jdbc.update("INSERT INTO user_skill_package(skill_id,owner_id,source_id,recipe_version,source_format) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE recipe_version=VALUES(recipe_version),source_format=VALUES(source_format),updated_at=CURRENT_TIMESTAMP(3)", id, owner, parsed.sourceId(), definition.recipeVersion(), parsed.format());
            jdbc.update("INSERT INTO user_skill_installation(owner_id,skill_id,recipe_version) VALUES(?,?,?) ON DUPLICATE KEY UPDATE recipe_version=VALUES(recipe_version),updated_at=CURRENT_TIMESTAMP(3)", owner, id, definition.recipeVersion());
            var result = view(definition, installation(owner, id), favorites(owner).contains(id), true);
            result.put("sourceFormat", parsed.format());
            result.put("ignoredFiles", parsed.ignoredFiles());
            result.put("includedDocuments", parsed.includedDocuments());
            return result;
        });
    }

    /** Optional task provenance is validated against the authenticated owner's pinned installation. */
    public void validateJob(String owner, JobService.Request request) {
        if (request.skillId() == null && request.skillVersion() == null) return;
        if (request.skillId() == null || request.skillVersion() == null) throw ApiException.invalid("skillId 与 skillVersion 必须一起提供");
        var current = require(owner, request.skillId());
        var installed = installation(owner, request.skillId());
        if (installed == null || !installed.version().equals(request.skillVersion())) throw new ApiException(HttpStatus.CONFLICT, "SKILL_NOT_INSTALLED", "请先安装所选版本的 Skill");
        var pinned = jdbc.query("SELECT manifest FROM skill_definition WHERE skill_id=? AND recipe_version=?", (rs, n) -> SkillCatalog.parse(Json.read(rs.getString("manifest"))), request.skillId(), request.skillVersion()).stream().findFirst().orElseThrow(ApiException::notFound);
        if (!pinned.installable() || !pinned.capability().equals(request.kind()) || !current.recipeVersion().equals(request.skillVersion())) throw new ApiException(HttpStatus.CONFLICT, "SKILL_VERSION_CHANGED", "Skill 用途或版本已变化，请重新选择");
        for (var required : pinned.inputSchema().path("required")) {
            if (required.asString().equals("referenceAssetIds") && request.referenceAssetIds().isEmpty()) throw ApiException.invalid("此 Skill 需要至少一张参考图");
        }
    }

    private static Object canonical(tools.jackson.databind.JsonNode node) {
        if (node.isObject()) {
            var fields = new java.util.TreeMap<String, Object>();
            for (String key : node.propertyNames()) fields.put(key, canonical(node.path(key)));
            return fields;
        }
        if (node.isArray()) {
            var values = new java.util.ArrayList<Object>();
            for (var value : node) values.add(canonical(value));
            return values;
        }
        return node;
    }

    private Map<String, Installation> installations(String owner) {
        var result = new LinkedHashMap<String, Installation>();
        if (owner == null) return result;
        jdbc.query("SELECT skill_id,recipe_version,installed_at,updated_at FROM user_skill_installation WHERE owner_id=?", rs -> {
            result.put(rs.getString("skill_id"), installationRow(rs));
        }, owner);
        return result;
    }

    private Installation installation(String owner, String id) {
        if (owner == null) return null;
        return jdbc.query("SELECT recipe_version,installed_at,updated_at FROM user_skill_installation WHERE owner_id=? AND skill_id=?",
            (rs, n) -> installationRow(rs), owner, id).stream().findFirst().orElse(null);
    }

    private static Installation installationRow(ResultSet rs) throws SQLException {
        return new Installation(rs.getString("recipe_version"), WorkbenchStore.iso(rs, "installed_at"), WorkbenchStore.iso(rs, "updated_at"));
    }

    private Map<String, Object> view(SkillCatalog.Definition definition, Installation installed, boolean favorite, boolean detail) {
        var result = new LinkedHashMap<String, Object>();
        result.put("id", definition.id());
        result.put("name", definition.name());
        boolean imported = catalog.find(definition.id()) == null;
        result.put("author", imported ? "我的导入" : "映序");
        result.put("source", imported ? "imported" : "builtin");
        result.put("visibility", imported ? "private" : "public");
        if (imported) {
            result.put("sourceId", definition.manifest().path("sourceId").asString(""));
        }
        result.put("description", definition.description());
        result.put("category", definition.category());
        result.put("capability", definition.capability());
        result.put("status", definition.status());
        result.put("recipeVersion", definition.recipeVersion());
        result.put("tags", definition.tags());
        result.put("inputSchema", definition.inputSchema());
        result.put("installationSupported", definition.installable());
        result.put("installed", installed != null);
        result.put("favorite", favorite);
        result.put("installedVersion", installed == null ? null : installed.version());
        result.put("installedAt", installed == null ? null : installed.installedAt());
        result.put("updatedAt", installed == null ? null : installed.updatedAt());
        var latest = imported ? definition : catalog.find(definition.id());
        result.put("updateAvailable", installed != null && latest != null && !latest.recipeVersion().equals(installed.version()));
        result.put("latestVersion", latest == null ? null : latest.recipeVersion());
        if (detail) result.put("recipe", definition.recipe());
        return result;
    }
}
