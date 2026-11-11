package cn.musecanvas.api;

import java.util.*;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

/**
 * Server-side Function Calling registry. The model receives only these schemas;
 * execution is authenticated and routed to existing owner-scoped services.
 * No arbitrary HTTP, SQL, shell or file tool is exposed.
 */
@Service
public class AgentToolService {
    public record Call(String name, JsonNode arguments, String requestId) {}
    private final WorkbenchStore store;
    private final RagService rag;
    private final JobService jobs;

    public AgentToolService(WorkbenchStore store, RagService rag, JobService jobs) {
        this.store = store; this.rag = rag; this.jobs = jobs;
    }

    public List<Map<String, Object>> definitions() {
        return List.of(
            function("search_knowledge", "Search the authenticated project's indexed source material and return citation-bearing excerpts.", object(Map.of(
                "projectId", string("Project id", true), "query", string("Question or retrieval query", true), "topK", integer("Number of results, 1-20", false)
            ), List.of("projectId", "query"))),
            function("list_project_assets", "List media assets that belong to the authenticated project.", object(Map.of(
                "projectId", string("Project id", true)
            ), List.of("projectId"))),
            function("get_generation_job", "Read one generation task belonging to the authenticated user.", object(Map.of(
                "jobId", string("Generation job id", true)
            ), List.of("jobId"))),
            function("create_generation_job", "Create one idempotent image or video generation task using a configured model channel.", object(Map.ofEntries(
                Map.entry("projectId", string("Project id", true)), Map.entry("nodeId", string("Canvas node id", true)), Map.entry("kind", enumValue("image or video", List.of("image", "video"))),
                Map.entry("prompt", string("Generation prompt", true)), Map.entry("model", string("Configured model id", true)), Map.entry("width", integer("Output width", false)), Map.entry("height", integer("Output height", false)),
                Map.entry("duration", integer("Video duration in seconds", false)), Map.entry("referenceAssetIds", arrayOfStrings("Owned reference image ids")), Map.entry("skillId", string("Installed skill id", false)),
                Map.entry("skillVersion", string("Installed skill version", false)), Map.entry("videoMode", enumValue("Video reference mode", List.of("auto", "reference", "frames")))
            ), List.of("projectId", "nodeId", "kind", "prompt", "model")))
        );
    }

    public Map<String, Object> call(String owner, Call input) {
        if (owner == null || owner.isBlank() || input == null || input.name() == null || input.name().isBlank()) throw ApiException.invalid("工具名称必填");
        if (input.arguments() == null || !input.arguments().isObject() || Json.write(input.arguments()).length() > 32_768) throw ApiException.invalid("工具参数必须是 32KB 内的 JSON 对象");
        return switch (input.name()) {
            case "search_knowledge" -> { validateKeys(input.arguments(), Set.of("projectId", "query", "topK")); yield search(owner, input.arguments()); }
            case "list_project_assets" -> { validateKeys(input.arguments(), Set.of("projectId")); yield listAssets(owner, input.arguments()); }
            case "get_generation_job" -> { validateKeys(input.arguments(), Set.of("jobId")); yield Map.of("result", jobs.job(owner, required(input.arguments(), "jobId"))); }
            case "create_generation_job" -> { validateKeys(input.arguments(), Set.of("projectId", "nodeId", "kind", "prompt", "model", "width", "height", "duration", "referenceAssetIds", "skillId", "skillVersion", "videoMode")); yield createJob(owner, input.arguments(), input.requestId()); }
            default -> throw ApiException.invalid("工具未在白名单中：" + input.name());
        };
    }

    private Map<String, Object> search(String owner, JsonNode args) {
        String project = required(args, "projectId"); String query = required(args, "query"); Integer topK = optionalInt(args, "topK");
        return Map.of("result", rag.search(owner, project, query, topK));
    }
    private Map<String, Object> listAssets(String owner, JsonNode args) {
        String project = required(args, "projectId"); return Map.of("result", store.assets(owner, project));
    }
    private Map<String, Object> createJob(String owner, JsonNode args, String requestId) {
        String project = required(args, "projectId"), node = required(args, "nodeId"), kind = required(args, "kind"), prompt = required(args, "prompt"), model = required(args, "model");
        if (!Set.of("image", "video").contains(kind)) throw ApiException.invalid("kind 必须为 image 或 video");
        List<String> references = strings(args.path("referenceAssetIds"), "referenceAssetIds");
        String skillId = optionalText(args, "skillId"), skillVersion = optionalText(args, "skillVersion"), videoMode = optionalText(args, "videoMode");
        JobService.Request request = new JobService.Request(project, node, kind, prompt, model, optionalInt(args, "width"), optionalInt(args, "height"), optionalInt(args, "duration"), references, skillId, skillVersion, videoMode);
        String key = requestId == null || requestId.isBlank() ? "agent-" + Json.hash(inputFingerprint(inputMap(args))).substring(0, 48) : requestId.strip();
        if (!key.matches("[A-Za-z0-9._:-]{1,128}")) throw ApiException.invalid("requestId 只能包含字母、数字、点、下划线、冒号和短横线");
        return Map.of("result", jobs.submit(owner, key, request));
    }
    private static String inputFingerprint(Map<String, Object> values) { return Json.write(values); }
    private static Map<String, Object> inputMap(JsonNode args) { return Json.MAPPER.readValue(Json.write(args), LinkedHashMap.class); }

    private static String required(JsonNode node, String key) { String value = optionalText(node, key); if (value == null) throw ApiException.invalid("缺少工具参数：" + key); return value; }
    private static void validateKeys(JsonNode node, Set<String> allowed) { for (String key : node.propertyNames()) if (!allowed.contains(key)) throw ApiException.invalid("工具参数未定义：" + key); }
    private static String optionalText(JsonNode node, String key) { JsonNode value = node.path(key); if (!value.isTextual()) return null; String text = value.asString().strip(); return text.isBlank() ? null : text; }
    private static Integer optionalInt(JsonNode node, String key) { JsonNode value = node.path(key); if (value.isMissingNode() || value.isNull()) return null; if (!value.isInt() && !value.isLong()) throw ApiException.invalid("工具参数 " + key + " 必须为整数"); long number = value.asLong(); if (number < Integer.MIN_VALUE || number > Integer.MAX_VALUE) throw ApiException.invalid("工具参数 " + key + " 超出整数范围"); return (int) number; }
    private static List<String> strings(JsonNode value, String key) { if (value.isMissingNode() || value.isNull()) return List.of(); if (!value.isArray() || value.size() > 4) throw ApiException.invalid(key + " 必须是最多4项的数组"); var out = new ArrayList<String>(); for (JsonNode item : value) { if (!item.isTextual() || item.asString().isBlank()) throw ApiException.invalid(key + " 只能包含非空文本"); out.add(item.asString().strip()); } return List.copyOf(out); }

    private static Map<String, Object> function(String name, String description, Map<String, Object> parameters, List<String> required) {
        return Map.of("type", "function", "function", Map.of("name", name, "description", description, "parameters", parametersWithRequired(parameters, required)));
    }
    /** Convenience overload for callers that already supplied a JSON Schema object. */
    private static Map<String, Object> function(String name, String description, Map<String, Object> schema) {
        return Map.of("type", "function", "function", Map.of("name", name, "description", description, "parameters", schema));
    }
    private static Map<String, Object> parametersWithRequired(Map<String, Object> properties, List<String> required) { return Map.of("type", "object", "additionalProperties", false, "properties", properties, "required", required); }
    private static Map<String, Object> object(Map<String, Object> properties, List<String> required) { return parametersWithRequired(properties, required); }
    private static Map<String, Object> string(String description, boolean required) { return Map.of("type", "string", "description", description); }
    private static Map<String, Object> integer(String description, boolean required) { return Map.of("type", "integer", "description", description); }
    private static Map<String, Object> enumValue(String description, List<String> values) { return Map.of("type", "string", "description", description, "enum", values); }
    private static Map<String, Object> arrayOfStrings(String description) { return Map.of("type", "array", "description", description, "items", Map.of("type", "string")); }
}
