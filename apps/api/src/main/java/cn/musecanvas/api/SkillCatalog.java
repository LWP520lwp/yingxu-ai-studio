package cn.musecanvas.api;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

/** Release-bundled catalog. Private imports are validated separately and never inserted here. */
@Component
public class SkillCatalog {
    public record Definition(String id, String name, String description, String category,
                             String capability, String status, String recipeVersion,
                             List<String> tags, JsonNode inputSchema, JsonNode recipe,
                             JsonNode manifest) {
        public boolean installable() { return "available".equals(status); }
    }

    private final Map<String, Definition> definitions;

    public SkillCatalog() {
        try (var input = new ClassPathResource("skills/catalog.json").getInputStream()) {
            JsonNode root = Json.read(new String(input.readAllBytes(), StandardCharsets.UTF_8));
            if (!root.isArray() || root.isEmpty()) throw new IllegalStateException("Built-in skill catalog must be a nonempty array");
            var loaded = new LinkedHashMap<String, Definition>();
            for (JsonNode manifest : root) {
                Definition definition = parse(manifest);
                if (loaded.putIfAbsent(definition.id(), definition) != null) throw new IllegalStateException("Duplicate built-in skill id");
            }
            definitions = Collections.unmodifiableMap(loaded);
        } catch (IOException e) {
            throw new IllegalStateException("Unable to load the built-in skill catalog", e);
        }
    }

    public List<Definition> definitions() { return List.copyOf(definitions.values()); }
    public Definition find(String id) { return definitions.get(id); }
    public Definition require(String id) {
        Definition result = find(id);
        if (result == null) throw ApiException.notFound();
        return result;
    }

    static Definition parse(JsonNode manifest) {
        String id = manifest.path("id").asString("");
        String version = manifest.path("recipeVersion").asString("");
        String capability = manifest.path("capability").asString("");
        String status = manifest.path("status").asString("");
        if (!id.matches("[a-z][a-z0-9-]{0,63}") || !version.matches("[0-9]+\\.[0-9]+\\.[0-9]+")
            || !List.of("image", "video", "composition").contains(capability)
            || !List.of("available", "planned").contains(status)
            || !manifest.path("inputSchema").isObject() || !manifest.path("recipe").isObject()) {
            throw new IllegalStateException("Invalid built-in skill manifest");
        }
        JsonNode recipe = manifest.path("recipe");
        if ("available".equals(status) && (!List.of("image", "video").contains(capability)
            || !"generation-job".equals(recipe.path("operation").asString(""))
            || !"POST".equals(recipe.path("method").asString(""))
            || !"/api/jobs".equals(recipe.path("path").asString(""))
            || !capability.equals(recipe.path("kind").asString("")))) {
            throw new IllegalStateException("Available skills may only describe the supported generation job endpoint");
        }
        var tags = new ArrayList<String>();
        for (JsonNode tag : manifest.path("tags")) tags.add(tag.asString());
        return new Definition(id, manifest.path("name").asString(""), manifest.path("description").asString(""),
            manifest.path("category").asString(""), capability, status, version, List.copyOf(tags),
            manifest.path("inputSchema"), recipe, manifest);
    }
}

