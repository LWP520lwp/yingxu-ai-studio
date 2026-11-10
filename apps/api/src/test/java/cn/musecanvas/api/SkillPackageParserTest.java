package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

class SkillPackageParserTest {
    static String example() { return """
        {"id":"orbit-explainer","name":"轨道科普镜头","description":"保持尺度与运动连贯","capability":"video","version":"1.0.0","promptTemplate":"按科学示意表现：{{text}}","defaults":{"width":1280,"height":720,"duration":8},"tags":["科普"]}
        """; }
    static SkillPackageParser.Parsed parse(String file, String text) { return SkillPackageParser.parse(file, new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)), "video"); }

    @Test void importsJsonAsAnInertVersionedGenerationRecipe() {
        var parsed = parse("skill.json", example());
        assertEquals("orbit-explainer", parsed.sourceId());
        var manifest = parsed.manifest();
        assertEquals("video", manifest.path("capability").asString());
        assertEquals(8, manifest.path("inputSchema").path("properties").path("duration").path("default").asInt());
        assertEquals("/api/jobs", manifest.path("recipe").path("path").asString());
        assertFalse(manifest.path("recipe").path("automaticExecutionOnInstall").asBoolean());
        assertEquals("按科学示意表现：{{text}}", manifest.path("recipe").path("promptTemplate").asString());
    }

    @Test void markdownFrontmatterAndBodyBecomePromptDataIncludingUserText() {
        var parsed = parse("SKILL.md", "---\nname: orbit-explainer\ndisplayName: 轨道镜头\ndescription: 保持尺度和轴线\nversion: 2.1.0\n---\n# 编排\n先建立空间，再缓慢跟随主体。\n脚本命令只作为正文，不执行。\n");
        assertEquals("orbit-explainer", parsed.sourceId());
        assertEquals("轨道镜头", parsed.manifest().path("name").asString());
        assertEquals("2.1.0", parsed.manifest().path("recipeVersion").asString());
        String template = parsed.manifest().path("recipe").path("promptTemplate").asString();
        assertTrue(template.contains("先建立空间")); assertTrue(template.contains("{{text}}"));
        var image = SkillPackageParser.parse("SKILL.md", new ByteArrayInputStream("# 光照\n柔和侧光".getBytes(StandardCharsets.UTF_8)), "image");
        assertEquals("image", image.manifest().path("capability").asString());
        assertEquals("保持比例 保持方向", parse("SKILL.md", "---\nname: orbit\ndescription: >-\n  保持比例\n  保持方向\n---\n轨道镜头：{{text}}\n").manifest().path("description").asString());
    }

    @Test void readsNestedZipWithoutExtractingOrExecutingOtherFiles() throws Exception {
        byte[] zip = zip(Map.of("orbit/skill.json", example().getBytes(StandardCharsets.UTF_8), "orbit/scripts/test.py", "raise RuntimeError('must never run')".getBytes(StandardCharsets.UTF_8)));
        var parsed = SkillPackageParser.parse("skill.zip", new ByteArrayInputStream(zip), "video");
        assertEquals("zip-json", parsed.format()); assertEquals(1, parsed.ignoredFiles());
    }

    @Test void keepsACompleteDirectorWorkflowAndItsMarkdownReferenceLibraryWithoutExecutingAdapters() throws Exception {
        String workflow = "汽车导演工作流\n" + "保持人物车辆与空间连续。".repeat(800) + "\n详见：`references/摄影与色彩.md`\n用户内容：{{text}}";
        assertTrue(workflow.length() > 8000);
        String reference = "# 摄影与色彩\n先判断光线来源，再选择镜头。\n脚本代码只作为原文：run('never-execute')";
        var archive = zip(Map.of(
            "director/SKILL.md", ("---\nname: auto-director\ndescription: 汽车导演方法\n---\n" + workflow).getBytes(StandardCharsets.UTF_8),
            "director/references/摄影与色彩.md", reference.getBytes(StandardCharsets.UTF_8),
            "director/templates/项目需求卡.md", "# 项目卡\n主车：\n场景：".getBytes(StandardCharsets.UTF_8),
            "director/agents/openai.yaml", "entrypoint: '../SKILL.md'\ncommand: never-run".getBytes(StandardCharsets.UTF_8),
            "director/scripts/run.py", "raise RuntimeError('must never run')".getBytes(StandardCharsets.UTF_8),
            "unrelated/references/其他.md", "must not enter the recipe".getBytes(StandardCharsets.UTF_8)
        ));
        var parsed = SkillPackageParser.parse("汽车导演.zip", new ByteArrayInputStream(archive), "video");
        assertEquals(workflow, parsed.manifest().path("recipe").path("promptTemplate").asString());
        assertEquals(reference, parsed.manifest().path("recipe").path("referenceDocuments").path("references/摄影与色彩.md").asString());
        assertEquals(2, parsed.includedDocuments()); assertEquals(3, parsed.ignoredFiles());
        assertFalse(parsed.manifest().toString().contains("must not enter the recipe"));
        assertFalse(parsed.manifest().toString().contains("must never run"));
        // The normalized declaration can be moved to another deployment without losing its documents.
        var exported = parse("skill.json", Json.write(parsed.manifest()));
        assertEquals(2, exported.includedDocuments());
        assertEquals(parsed.manifest().path("recipe"), exported.manifest().path("recipe"));
    }

    @Test void enforcesTheFinalPromptAndDocumentBoundsWithoutSilentlyTruncatingContent() throws Exception {
        assertThrows(ApiException.class, () -> parse("SKILL.md", "# 工作流\n" + "字".repeat(12000)));
        // Appending the mandatory user placeholder must fit the same generation limit.
        assertThrows(ApiException.class, () -> parse("SKILL.md", "字".repeat(11999)));
        for (String path : new String[]{"../unsafe.md", "references/../unsafe.md", "scripts/run.py", "references/remote:note.md"}) {
            String supplied = example().replace("\"tags\":[\"科普\"]", "\"recipe\":{\"referenceDocuments\":{" + Json.write(path) + ":\"text\"}}");
            assertThrows(ApiException.class, () -> parse("skill.json", supplied));
        }
        var tooLargeReference = zip(Map.of("SKILL.md", "# 测试\n保持连续。".getBytes(StandardCharsets.UTF_8), "references/large.md", new byte[64 * 1024 + 1]));
        assertThrows(ApiException.class, () -> SkillPackageParser.parse("skill.zip", new ByteArrayInputStream(tooLargeReference), "video"));
    }

    @Test
    @EnabledIfEnvironmentVariable(named = "SKILL_PACKAGE_VERIFY_PATH", matches = ".+")
    void importsTheAuthorizedLocalDirectorPackageWithoutChangingItsCoreOrReferenceText() throws Exception {
        Path archive = Path.of(System.getenv("SKILL_PACKAGE_VERIFY_PATH"));
        SkillPackageParser.Parsed parsed;
        try (var input = Files.newInputStream(archive)) { parsed = SkillPackageParser.parse(archive.getFileName().toString(), input, "video"); }
        assertEquals("ayu-cinematic-auto-visual", parsed.sourceId());
        assertEquals("1.0.0", parsed.manifest().path("recipeVersion").asString());
        assertEquals(13, parsed.includedDocuments()); assertEquals(2, parsed.ignoredFiles());
        String core = parsed.manifest().path("recipe").path("promptTemplate").asString();
        assertTrue(core.contains("STEP 8｜复核与返工"));
        assertTrue(core.contains("{{text}}")); assertTrue(core.length() > 8000 && core.length() <= 12000);
        assertTrue(parsed.manifest().path("recipe").path("referenceDocuments").path("references/05A_十台电影摄影机与视觉风格.md").asString().contains("ARRI"));
    }

    @Test void rejectsTraversalAmbiguousPackagesAndZipBombs() throws Exception {
        for (String path : new String[]{"../SKILL.md", "/SKILL.md", "C:/SKILL.md", "a\\SKILL.md", "a/../SKILL.md"}) {
            byte[] zip = zip(Map.of(path, "# demo\nvalid body".getBytes(StandardCharsets.UTF_8)));
            assertThrows(ApiException.class, () -> SkillPackageParser.parse("skill.zip", new ByteArrayInputStream(zip), "video"));
        }
        byte[] duplicate = zip(Map.of("a/skill.json", example().getBytes(StandardCharsets.UTF_8), "b/manifest.json", example().getBytes(StandardCharsets.UTF_8)));
        assertThrows(ApiException.class, () -> SkillPackageParser.parse("skill.zip", new ByteArrayInputStream(duplicate), "video"));
        byte[] bomb = zip(Map.of("SKILL.md", new byte[300 * 1024]));
        assertThrows(ApiException.class, () -> SkillPackageParser.parse("skill.zip", new ByteArrayInputStream(bomb), "video"));
        assertThrows(ApiException.class, () -> SkillPackageParser.parse("skill.json", new ByteArrayInputStream(new byte[SkillPackageParser.MAX_UPLOAD + 1]), "video"));
    }

    @Test void rejectsExecutableRecipesExternalSchemasAndInvalidParameters() {
        for (String bad : new String[]{
            example().replace("\"tags\":[\"科普\"]", "\"scripts\":[\"run.sh\"]"),
            example().replace("\"duration\":8", "\"duration\":99"),
            example().replace("{{text}}", "{{env.SECRET}}"),
            example().replace("\"capability\":\"video\"", "\"capability\":\"shell\""),
            example().replace("\"tags\":[\"科普\"]", "\"recipe\":{\"path\":\"https://attacker.test\"}"),
            example().replace("\"tags\":[\"科普\"]", "\"inputSchema\":{\"$ref\":\"https://attacker.test\"}"),
            example().replace("\"tags\":[\"科普\"]", "\"inputSchema\":{\"required\":[\"callbackUrl\"]}"),
            "[]", "{broken"
        }) assertThrows(ApiException.class, () -> parse("skill.json", bad), bad);
        assertThrows(ApiException.class, () -> parse("run.exe", example()));
        assertThrows(ApiException.class, () -> parse("SKILL.md", "---\nname: test\ndescription: !exec dangerous\n---\nbody"));
        assertThrows(ApiException.class, () -> SkillPackageParser.parse("SKILL.md", new ByteArrayInputStream(new byte[]{(byte)0xff}), "video"));
    }

    private static byte[] zip(Map<String, byte[]> entries) throws Exception {
        var bytes = new ByteArrayOutputStream();
        try (var zip = new ZipOutputStream(bytes)) {
            for (var entry : entries.entrySet()) {
                zip.putNextEntry(new ZipEntry(entry.getKey())); zip.write(entry.getValue()); zip.closeEntry();
            }
        }
        return bytes.toByteArray();
    }
}
