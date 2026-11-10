package cn.musecanvas.api;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipInputStream;
import tools.jackson.databind.JsonNode;

/** Imports declarative prompt data only. Files are never extracted, executed, or fetched. */
public final class SkillPackageParser {
    public static final int MAX_UPLOAD = 2 * 1024 * 1024;
    private static final int MAX_ENTRY = 256 * 1024;
    private static final int MAX_TEXT = 64 * 1024;
    private static final int MAX_PROMPT = 12000;
    private static final Set<String> FIELDS = Set.of("id", "name", "displayName", "description", "category", "capability", "status", "recipeVersion", "version", "tags", "inputSchema", "recipe", "promptTemplate", "instructions", "defaults");
    private static final Set<String> INPUTS = Set.of("projectId", "nodeId", "prompt", "model", "width", "height", "duration", "referenceAssetIds");
    public record Parsed(String sourceId, String format, JsonNode manifest, int ignoredFiles, int includedDocuments) {}
    private SkillPackageParser() {}

    public static Parsed parse(String filename, InputStream input, String selectedCapability) {
        if (selectedCapability != null && !Set.of("image", "video").contains(selectedCapability)) throw ApiException.invalid("Skill 用途只能为 image 或 video");
        String name = filename == null ? "" : filename.toLowerCase(Locale.ROOT);
        try {
            byte[] bytes = bounded(input, MAX_UPLOAD);
            if (bytes.length == 0) throw ApiException.invalid("请选择非空的 Skill 文件");
            if (name.endsWith(".zip")) return zip(bytes, selectedCapability);
            if (name.endsWith(".json")) return normalize(json(bytes), "json", selectedCapability, 0);
            if (name.endsWith(".md")) return normalize(markdown(bytes), "markdown", selectedCapability, 0);
            throw ApiException.invalid("请上传 ZIP、JSON 或 SKILL.md 文件");
        } catch (ApiException e) { throw e; }
        catch (IOException | IllegalArgumentException e) { throw ApiException.invalid("Skill 文件无法读取，请检查编码与格式"); }
    }

    private static Parsed zip(byte[] bytes, String capability) throws IOException {
        if (bytes.length < 4 || bytes[0] != 'P' || bytes[1] != 'K') throw ApiException.invalid("ZIP 文件格式无效");
        byte[] json = null, markdown = null;
        String jsonPath = null, markdownPath = null;
        var markdownFiles = new LinkedHashMap<String, byte[]>();
        int count = 0, total = 0, ignored = 0;
        var names = new java.util.HashSet<String>();
        try (var zip = new ZipInputStream(new ByteArrayInputStream(bytes), StandardCharsets.UTF_8)) {
            for (var entry = zip.getNextEntry(); entry != null; entry = zip.getNextEntry()) {
                if (++count > 64) throw ApiException.invalid("Skill ZIP 最多包含 64 个条目");
                String path = entry.getName();
                if (path == null || path.length() > 240 || path.startsWith("/") || path.contains("\\") || path.contains(":") || path.chars().anyMatch(c -> c < 32) || List.of(path.split("/", -1)).contains("..") || List.of(path.split("/", -1)).contains(".")) throw ApiException.invalid("Skill ZIP 包含不安全的路径");
                if (!names.add(path.toLowerCase(Locale.ROOT))) throw ApiException.invalid("Skill ZIP 包含重复路径");
                if (entry.isDirectory()) continue;
                if (entry.getSize() > MAX_ENTRY) throw ApiException.invalid("Skill ZIP 单文件不得超过 256 KiB");
                byte[] content = bounded(zip, MAX_ENTRY);
                total += content.length;
                if (total > MAX_UPLOAD) throw ApiException.invalid("Skill ZIP 解压后的总内容不得超过 2 MiB");
                String leaf = path.substring(path.lastIndexOf('/') + 1).toLowerCase(Locale.ROOT);
                if (leaf.endsWith(".md")) markdownFiles.put(path, content);
                if (leaf.equals("skill.json") || leaf.equals("manifest.json")) {
                    if (json != null) throw ApiException.invalid("Skill ZIP 只能有一个 skill.json 或 manifest.json");
                    json = content;
                    jsonPath = path;
                } else if (leaf.equals("skill.md")) {
                    if (markdown != null) throw ApiException.invalid("Skill ZIP 只能有一个 SKILL.md");
                    markdown = content;
                    markdownPath = path;
                } else ignored++;
            }
        }
        if (json != null) {
            var documents = packageDocuments(jsonPath, markdownFiles);
            return normalize(json(json), "zip-json", capability, ignored + (markdown == null ? 0 : 1) - documents.size(), documents);
        }
        if (markdown != null) {
            var documents = packageDocuments(markdownPath, markdownFiles);
            return normalize(markdown(markdown), "zip-markdown", capability, ignored - documents.size(), documents);
        }
        throw ApiException.invalid("Skill ZIP 内需要一个 skill.json、manifest.json 或 SKILL.md");
    }

    /** Keep only inert, UTF-8 Markdown adjacent to the selected entry point. */
    private static Map<String, String> packageDocuments(String entrypoint, Map<String, byte[]> files) {
        String directory = entrypoint.substring(0, entrypoint.lastIndexOf('/') + 1);
        var documents = new java.util.TreeMap<String, String>();
        for (var file : files.entrySet()) {
            if (!file.getKey().startsWith(directory)) continue;
            String relative = file.getKey().substring(directory.length());
            if (isReferencePath(relative)) documents.put(relative, utf8(file.getValue()));
        }
        return documents;
    }

    private static boolean isReferencePath(String path) {
        return path != null && path.length() <= 240 && !path.contains("\\") && !path.contains(":")
            && path.chars().noneMatch(c -> c < 32) && !List.of(path.split("/", -1)).contains("..")
            && !List.of(path.split("/", -1)).contains(".") && !List.of(path.split("/", -1)).contains("")
            && (path.startsWith("references/") || path.startsWith("templates/")) && path.toLowerCase(Locale.ROOT).endsWith(".md");
    }

    private static byte[] bounded(InputStream input, int limit) throws IOException {
        byte[] bytes = input.readNBytes(limit + 1);
        if (bytes.length > limit) throw ApiException.invalid("Skill 文件超过大小限制（上传 2 MiB；ZIP 单文件 256 KiB）");
        return bytes;
    }

    private static String utf8(byte[] bytes) {
        if (bytes.length > MAX_TEXT) throw ApiException.invalid("Skill 配方或 Markdown 不得超过 64 KiB");
        try { return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString().replaceFirst("^\\uFEFF", ""); }
        catch (CharacterCodingException e) { throw ApiException.invalid("Skill 文本必须使用 UTF-8 编码"); }
    }

    private static JsonNode json(byte[] bytes) {
        try {
            JsonNode root = Json.read(utf8(bytes));
            if (root == null || !root.isObject()) throw ApiException.invalid("Skill JSON 顶层必须为对象");
            checkTree(root, 0, new int[]{0});
            return root;
        } catch (ApiException e) { throw e; }
        catch (RuntimeException e) { throw ApiException.invalid("Skill JSON 格式无效"); }
    }

    private static void checkTree(JsonNode node, int depth, int[] count) {
        if (depth > 12 || ++count[0] > 1000) throw ApiException.invalid("Skill JSON 层级或字段数量过多");
        for (JsonNode child : node) checkTree(child, depth + 1, count);
    }

    /** A deliberately small scalar frontmatter reader; YAML tags, aliases and code have no semantics. */
    private static JsonNode markdown(byte[] bytes) {
        String text = utf8(bytes).replace("\r\n", "\n");
        var values = new LinkedHashMap<String, Object>();
        if (text.startsWith("---\n")) {
            int end = text.indexOf("\n---\n", 4);
            if (end < 0 || end > 4096) throw ApiException.invalid("SKILL.md frontmatter 需要以 --- 结束，且不超过 4096 字符");
            String[] lines = text.substring(4, end).split("\n");
            for (int index = 0; index < lines.length; index++) {
                String line = lines[index];
                if (line.isBlank() || line.stripLeading().startsWith("#")) continue;
                int colon = line.indexOf(':');
                if (colon <= 0 || Character.isWhitespace(line.charAt(0))) continue;
                String key = line.substring(0, colon).trim();
                if (!Set.of("name", "id", "displayName", "description", "capability", "version", "recipeVersion").contains(key)) continue;
                String value = line.substring(colon + 1).trim();
                if (value.startsWith("\"") && value.endsWith("\"")) {
                    try { value = Json.read(value).asString(); } catch (RuntimeException e) { throw ApiException.invalid("SKILL.md 的引号字段无效"); }
                } else if (value.startsWith("'") && value.endsWith("'")) value = value.substring(1, value.length() - 1).replace("''", "'");
                if (value.matches("[|>][-+]?")) {
                    boolean folded = value.startsWith(">");
                    var block = new ArrayList<String>();
                    while (index + 1 < lines.length && (lines[index + 1].isBlank() || Character.isWhitespace(lines[index + 1].charAt(0)))) block.add(lines[++index].strip());
                    value = String.join(folded ? " " : "\n", block).strip();
                }
                if (value.startsWith("!")) throw ApiException.invalid("SKILL.md 元信息仅支持普通文本");
                if (values.putIfAbsent(key, value) != null) throw ApiException.invalid("SKILL.md frontmatter 字段重复");
            }
            text = text.substring(end + 5);
        }
        String heading = text.lines().filter(line -> line.startsWith("# ")).findFirst().map(line -> line.substring(2).trim()).orElse("我的创作 Skill");
        values.putIfAbsent("name", heading);
        values.putIfAbsent("description", "从 SKILL.md 导入的个人创作方法");
        values.put("instructions", text.trim());
        return Json.read(Json.write(values));
    }

    private static Parsed normalize(JsonNode root, String format, String selectedCapability, int ignored) {
        return normalize(root, format, selectedCapability, ignored, Map.of());
    }

    private static Parsed normalize(JsonNode root, String format, String selectedCapability, int ignored, Map<String, String> packageDocuments) {
        for (String key : root.propertyNames()) if (!FIELDS.contains(key)) throw ApiException.invalid("不支持的 Skill 字段：" + key + "；仅支持声明式生成配方");
        String name = text(root, root.has("displayName") ? "displayName" : "name", 100, true);
        String description = text(root, "description", 1200, false);
        if (description.isBlank()) description = "个人导入的创作 Skill";
        String id = root.path("id").asString("");
        if (id.isBlank()) {
            String possible = root.path("name").asString("");
            id = possible.matches("[a-z][a-z0-9-]{0,63}") ? possible : "skill-" + Json.hash(name).substring(0, 24);
        }
        if (!id.matches("[a-z][a-z0-9-]{0,63}")) throw ApiException.invalid("Skill id 需为 1–64 位小写字母、数字或连字符，且以字母开头");
        String version = root.path("recipeVersion").asString(root.path("version").asString("1.0.0"));
        if (!version.matches("[0-9]{1,6}\\.[0-9]{1,6}\\.[0-9]{1,6}")) throw ApiException.invalid("Skill 版本请使用 1.0.0 这样的三段数字");
        String capability = root.path("capability").asString(selectedCapability == null ? "video" : selectedCapability);
        if (!Set.of("image", "video").contains(capability)) throw ApiException.invalid("导入 Skill 仅支持 image 或 video");
        JsonNode recipe = root.path("recipe");
        if (!recipe.isMissingNode() && !recipe.isObject()) throw ApiException.invalid("recipe 必须为对象");
        if (recipe.isObject()) {
            Set<String> allowed = Set.of("schemaVersion", "operation", "method", "path", "kind", "promptTemplate", "authentication", "requiredHeaders", "resultHandling", "providerConfigurationRequired", "automaticExecutionOnInstall", "referenceSupportMustBeConfirmed", "referenceDocuments");
            for (String key : recipe.propertyNames()) if (!allowed.contains(key)) throw ApiException.invalid("recipe 不支持字段：" + key);
            if ((recipe.has("operation") && !recipe.path("operation").asString().equals("generation-job")) || (recipe.has("method") && !recipe.path("method").asString().equals("POST")) || (recipe.has("path") && !recipe.path("path").asString().equals("/api/jobs")) || (recipe.has("kind") && !recipe.path("kind").asString().equals(capability)) || (recipe.has("schemaVersion") && recipe.path("schemaVersion").asInt() != 1) || recipe.path("automaticExecutionOnInstall").asBoolean(false)) throw ApiException.invalid("Skill 仅可准备 /api/jobs 的图像或视频配方，不能自动执行");
        }
        String prompt = recipe.path("promptTemplate").asString(root.path("promptTemplate").asString(root.path("instructions").asString("")));
        if (prompt.isBlank() || prompt.length() > MAX_PROMPT || prompt.indexOf('\0') >= 0) throw ApiException.invalid("Skill 需要 1–12000 字符的 promptTemplate 或 Markdown 正文");
        if (prompt.replace("{{text}}", "").matches("(?s).*\\{\\{.*")) throw ApiException.invalid("Skill 提示词仅支持 {{text}} 占位符");
        if (!prompt.contains("{{text}}")) prompt += "\n\n用户创作内容：\n{{text}}";
        if (prompt.length() > MAX_PROMPT) throw ApiException.invalid("Skill 核心配方与用户文字占位符合计不得超过 12000 字符，请精简核心方法；参考文档可放入 references 或 templates 目录");
        var referenceDocuments = new java.util.TreeMap<String, String>(packageDocuments);
        JsonNode suppliedDocuments = recipe.path("referenceDocuments");
        if (!suppliedDocuments.isMissingNode() && !suppliedDocuments.isObject()) throw ApiException.invalid("Skill referenceDocuments 必须为 Markdown 路径与文字组成的对象");
        int referenceBytes = 0;
        for (String path : suppliedDocuments.propertyNames()) {
            JsonNode value = suppliedDocuments.path(path);
            if (!isReferencePath(path) || !value.isString()) throw ApiException.invalid("Skill 参考文档仅支持 references/ 或 templates/ 内的 Markdown 文字");
            String body = value.asString();
            if (body.indexOf('\0') >= 0 || body.getBytes(StandardCharsets.UTF_8).length > MAX_TEXT) throw ApiException.invalid("Skill 每份参考文档不得超过 64 KiB，且不能包含空字符");
            String existing = referenceDocuments.putIfAbsent(path, body);
            if (existing != null && !existing.equals(body)) throw ApiException.invalid("Skill ZIP 与 JSON 中的参考文档内容冲突：" + path);
        }
        for (var document : referenceDocuments.entrySet()) {
            if (document.getValue().indexOf('\0') >= 0) throw ApiException.invalid("Skill 参考文档不能包含空字符");
            referenceBytes += document.getValue().getBytes(StandardCharsets.UTF_8).length;
        }
        if (referenceDocuments.size() > 63 || referenceBytes > MAX_UPLOAD) throw ApiException.invalid("Skill 参考文档最多 63 份，合计不得超过 2 MiB");
        JsonNode schema = root.path("inputSchema");
        if (!schema.isMissingNode() && (!schema.isObject() || (schema.has("type") && !schema.path("type").asString().equals("object")))) throw ApiException.invalid("inputSchema 必须描述一个对象");
        if (schema.has("$ref") || schema.has("allOf") || schema.has("oneOf") || schema.has("anyOf")) throw ApiException.invalid("Skill 输入不支持外部或组合 schema");
        var defaults = new LinkedHashMap<String, Object>();
        JsonNode properties = schema.path("properties");
        if (!properties.isMissingNode() && !properties.isObject()) throw ApiException.invalid("inputSchema.properties 必须为对象");
        for (String key : properties.propertyNames()) {
            if (!INPUTS.contains(key) || !properties.path(key).isObject()) throw ApiException.invalid("不支持的 Skill 输入：" + key);
            if (properties.path(key).has("$ref")) throw ApiException.invalid("Skill 不支持外部 schema 引用");
            if (properties.path(key).has("default")) defaults.put(key, properties.path(key).path("default"));
        }
        JsonNode simpleDefaults = root.path("defaults");
        if (!simpleDefaults.isMissingNode() && !simpleDefaults.isObject()) throw ApiException.invalid("defaults 必须为对象");
        for (String key : simpleDefaults.propertyNames()) {
            if (!Set.of("model", "width", "height", "duration").contains(key)) throw ApiException.invalid("不支持的 Skill 默认参数：" + key);
            defaults.put(key, simpleDefaults.path(key));
        }
        var required = new ArrayList<String>(List.of("projectId", "nodeId", "prompt"));
        JsonNode suppliedRequired = schema.path("required");
        if (!suppliedRequired.isMissingNode() && !suppliedRequired.isArray()) throw ApiException.invalid("inputSchema.required 必须为数组");
        for (JsonNode value : suppliedRequired) {
            String key = value.asString("");
            if (!INPUTS.contains(key)) throw ApiException.invalid("不支持的 Skill 必填参数：" + key);
            if (!required.contains(key)) required.add(key);
        }
        var normalizedProperties = new LinkedHashMap<String, Object>();
        normalizedProperties.put("projectId", Map.of("type", "string", "minLength", 1));
        normalizedProperties.put("nodeId", Map.of("type", "string", "minLength", 1, "maxLength", 128));
        normalizedProperties.put("prompt", Map.of("type", "string", "minLength", 1, "maxLength", 12000));
        normalizedProperties.put("referenceAssetIds", Map.of("type", "array", "maxItems", capability.equals("video") ? 2 : 4, "items", Map.of("type", "string")));
        for (String key : List.of("width", "height", "duration", "model")) {
            Object raw = defaults.get(key);
            if (raw == null) continue;
            JsonNode value = raw instanceof JsonNode node ? node : Json.read(Json.write(raw));
            if (key.equals("model")) {
                if (!value.isString() || value.asString().isBlank() || value.asString().length() > 120 || value.asString().contains("://")) throw ApiException.invalid("Skill 默认模型必须是平台模型标识");
                normalizedProperties.put(key, Map.of("type", "string", "default", value.asString()));
            } else {
                int minimum = key.equals("duration") ? 2 : 64, maximum = key.equals("duration") ? 20 : 4096;
                if (!value.isIntegralNumber() || value.asLong() < minimum || value.asLong() > maximum) throw ApiException.invalid("Skill 默认宽高需在 64–4096；时长需在 2–20 秒");
                normalizedProperties.put(key, Map.of("type", "integer", "default", value.asInt(), "minimum", minimum, "maximum", maximum));
            }
        }
        var tags = new ArrayList<String>();
        if (root.has("tags") && !root.path("tags").isArray()) throw ApiException.invalid("tags 必须为数组");
        for (JsonNode tag : root.path("tags")) {
            if (!tag.isString() || tag.asString().isBlank() || tag.asString().length() > 40 || tags.size() >= 12) throw ApiException.invalid("Skill 最多 12 个标签，每个 1–40 字符");
            tags.add(tag.asString());
        }
        var manifest = new LinkedHashMap<String, Object>();
        manifest.put("id", id); manifest.put("name", name); manifest.put("description", description);
        manifest.put("category", text(root, "category", 60, false)); manifest.put("capability", capability);
        manifest.put("status", "available"); manifest.put("recipeVersion", version); manifest.put("tags", tags);
        manifest.put("inputSchema", Map.of("type", "object", "additionalProperties", false, "required", required, "properties", normalizedProperties));
        var normalizedRecipe = new LinkedHashMap<String, Object>();
        normalizedRecipe.put("schemaVersion", 1); normalizedRecipe.put("operation", "generation-job"); normalizedRecipe.put("method", "POST"); normalizedRecipe.put("path", "/api/jobs"); normalizedRecipe.put("kind", capability); normalizedRecipe.put("promptTemplate", prompt);
        normalizedRecipe.put("automaticExecutionOnInstall", false); normalizedRecipe.put("referenceSupportMustBeConfirmed", required.contains("referenceAssetIds"));
        if (!referenceDocuments.isEmpty()) normalizedRecipe.put("referenceDocuments", referenceDocuments);
        manifest.put("recipe", normalizedRecipe);
        JsonNode normalized = Json.read(Json.write(manifest));
        SkillCatalog.parse(normalized);
        return new Parsed(id, format, normalized, ignored, referenceDocuments.size());
    }

    private static String text(JsonNode root, String field, int limit, boolean required) {
        JsonNode value = root.path(field);
        if (!value.isMissingNode() && !value.isString()) throw ApiException.invalid(field + " 必须为文本");
        String text = value.asString("").trim();
        if ((required && text.isBlank()) || text.length() > limit || text.indexOf('\0') >= 0) throw ApiException.invalid(field + " 长度无效（最多 " + limit + " 字符）");
        return text;
    }
}
