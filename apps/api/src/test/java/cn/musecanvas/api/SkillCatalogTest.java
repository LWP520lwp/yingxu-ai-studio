package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class SkillCatalogTest {
    @Test void executableRecipesOnlyDescribeTheSupportedJobRoute() {
        var catalog = new SkillCatalog();
        assertEquals(11, catalog.definitions().size());
        for (var definition : catalog.definitions()) {
            assertTrue(definition.inputSchema().isObject());
            assertFalse(definition.recipe().path("automaticExecutionOnInstall").asBoolean(true));
            if (definition.installable()) {
                assertEquals("/api/jobs", definition.recipe().path("path").asString());
                assertEquals("POST", definition.recipe().path("method").asString());
                assertEquals(definition.capability(), definition.recipe().path("kind").asString());
            }
        }
        var composition = catalog.require("storyboard-to-video");
        assertEquals("composition", composition.capability());
        assertEquals("planned", composition.status());
        assertFalse(composition.installable());
        assertFalse(composition.recipe().has("path"));
    }

    @Test void fightSkillUsesTextContextAndTheSupportedVideoRoute() {
        var skill = new SkillCatalog().require("fight-video");
        assertTrue(skill.installable());
        assertEquals("video", skill.capability());
        assertEquals("1.0.1", skill.recipeVersion());
        assertTrue(skill.recipe().path("promptTemplate").asString().contains("{{text}}"));
        assertTrue(skill.recipe().path("sourceTextRequired").asBoolean());
        assertFalse(skill.recipe().path("referenceSupportMustBeConfirmed").asBoolean());
    }

    @Test void creativeMethodsHaveDistinctTextRecipesAndTruthfulSingleOutputKinds() {
        var catalog = new SkillCatalog();
        for (String id : java.util.List.of("product-shot", "character-sheet", "cinema-camera", "cinema-vfx", "science-visual", "storybook-scene", "space-concept")) {
            var skill = catalog.require(id);
            assertTrue(skill.installable());
            assertEquals("1.0.0", skill.recipeVersion());
            assertTrue(skill.recipe().path("promptTemplate").asString().contains("{{text}}"));
            assertFalse(skill.inputSchema().path("properties").path("prompt").path("default").asString().isBlank());
            assertFalse(skill.recipe().path("automaticExecutionOnInstall").asBoolean(true));
        }
        assertEquals("video", catalog.require("product-shot").capability());
        assertEquals("image", catalog.require("science-visual").capability());
    }

    @Test void anAvailableRecipeCannotPointToAnArbitraryEndpoint() {
        String manifest = "{\"id\":\"unsafe\",\"recipeVersion\":\"1.0.0\",\"capability\":\"image\",\"status\":\"available\",\"inputSchema\":{},\"recipe\":{\"operation\":\"generation-job\",\"method\":\"POST\",\"path\":\"https://untrusted.example/run\",\"kind\":\"image\"}}";
        assertThrows(IllegalStateException.class, () -> SkillCatalog.parse(Json.read(manifest)));
    }
}
