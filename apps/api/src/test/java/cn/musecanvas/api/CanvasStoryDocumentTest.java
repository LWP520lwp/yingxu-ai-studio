package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

class CanvasStoryDocumentTest {
    private final CanvasStoryDocument documents = new CanvasStoryDocument();

    @Test void extractingProfilesLocksIdentityAndCreatesReviewableRealisticAssetPrompts() {
        JsonNode answer = archive();
        JsonNode extracted = documents.extracted(CanvasStoryDocument.empty(), answer);
        JsonNode character = extracted.path("characters").get(0);
        assertTrue(character.path("locked").asBoolean());
        assertEquals("char_1", character.path("id").asString());
        assertEquals("小陈", character.path("aliases").get(0).asString());
        assertEquals("自然沉稳的青年女声", character.path("voice").asString());
        assertTrue(character.path("imagePrompt").asString().contains("真人写实"));
        assertTrue(character.path("imagePrompt").asString().contains("纯白背景"));
        assertTrue(character.path("threeViewPrompt").asString().contains("正面、侧面、背面全身含鞋"));
        assertTrue(extracted.path("scenes").get(0).path("imagePrompt").asString().contains("不出现人物"));
        assertTrue(extracted.path("props").get(0).path("imagePrompt").asString().contains("纯白背景"));
        assertFalse(answer.path("characters").get(0).path("locked").asBoolean(), "the model answer must remain untouched");
    }

    @Test void lockedNamesAliasesCoreAndVoiceCannotBeChangedByEditingOrAnotherExtraction() {
        JsonNode document = document();
        String before = Json.write(document);
        for (String key : List.of("name", "aliases", "core", "voice")) {
            var edited = editFields(document);
            var character = CanvasStoryDocument.mutable(document.path("characters").get(0));
            character.put(key, switch (key) {
                case "name" -> "另一人";
                case "aliases" -> List.of("新代称");
                case "core" -> {
                    var core = CanvasStoryDocument.mutable(document.path("characters").get(0).path("core"));
                    core.put("hairColor", "金色");
                    yield core;
                }
                default -> "完全不同的音色";
            });
            edited.put("characters", List.of(character));
            var error = assertThrows(ApiException.class, () -> documents.edit(CanvasStoryDocument.node(edited), document), key);
            assertTrue(error.getMessage().contains("锁定角色"));
        }
        var modelArchive = CanvasStoryDocument.mutable(archive());
        var modelCharacter = CanvasStoryDocument.mutable(archive().path("characters").get(0));
        var core = CanvasStoryDocument.mutable(archive().path("characters").get(0).path("core"));
        core.put("age", "65岁"); modelCharacter.put("core", core);
        modelArchive.put("characters", List.of(modelCharacter));
        assertThrows(ApiException.class, () -> documents.extracted(document, CanvasStoryDocument.node(modelArchive)));
        var removed = editFields(document); removed.put("characters", List.of());
        assertThrows(ApiException.class, () -> documents.edit(CanvasStoryDocument.node(removed), document));
        assertEquals(before, Json.write(document), "rejected changes must preserve the existing document");
    }

    @Test void everySegmentRequiresExactlyFiveThreeSecondShotsWithFixedTimeCodes() {
        JsonNode document = document();
        JsonNode valid = answer("scene_1", "scene_1");
        JsonNode appended = documents.append(document, valid);
        JsonNode shots = appended.path("segments").get(0).path("shots");
        assertEquals(5, shots.size());
        for (int i = 0; i < 5; i++) {
            assertEquals(i * 3, shots.get(i).path("start").asInt());
            assertEquals((i + 1) * 3, shots.get(i).path("end").asInt());
            assertEquals(3, shots.get(i).path("duration").asInt());
        }
        var four = shotRows(valid); four.removeLast();
        assertThrows(ApiException.class, () -> documents.append(document, CanvasStoryDocument.node(Map.of("shots", four))));
        var six = shotRows(valid); six.add(six.getLast());
        assertThrows(ApiException.class, () -> documents.append(document, CanvasStoryDocument.node(Map.of("shots", six))));
        for (String key : List.of("start", "end")) {
            var rows = shotRows(valid); rows.get(2).put(key, 8);
            assertThrows(ApiException.class, () -> documents.append(document, CanvasStoryDocument.node(Map.of("shots", rows))));
        }
        assertTrue(document.path("segments").isEmpty());
    }

    @Test void nonexistentCastScenesPropsAndOffscreenSpeakersAreRejectedBeforeSaving() {
        JsonNode document = document();
        for (String invalid : List.of("cast", "speaker", "scene", "prop")) {
            var rows = shotRows(answer("scene_1", "scene_1"));
            switch (invalid) {
                case "cast" -> rows.getFirst().put("characters", List.of(actor("missing_actor")));
                case "speaker" -> rows.getFirst().put("dialogue", List.of(Map.of("characterId", "missing_actor", "text", "稍等。")));
                case "scene" -> rows.getFirst().put("sceneId", "missing_scene");
                default -> rows.getFirst().put("propIds", List.of("missing_prop"));
            }
            assertThrows(ApiException.class, () -> documents.append(document, CanvasStoryDocument.node(Map.of("shots", rows))), invalid);
        }
        var noCast = shotRows(answer("scene_1", "scene_1"));
        noCast.getFirst().put("characters", List.of());
        assertThrows(ApiException.class, () -> documents.append(document, CanvasStoryDocument.node(Map.of("shots", noCast))));
        assertTrue(document.path("segments").isEmpty());
    }

    @Test void theNextFirstShotContinuesThePreviousFinalSceneAndKeepsItsExactEndState() {
        JsonNode first = documents.append(document(), answer("scene_1", "scene_2"));
        JsonNode previousEnd = first.path("lastState");
        assertEquals("scene_2", previousEnd.path("sceneId").asString());
        assertEquals("动作4", previousEnd.path("visibleAction").asString());
        var rejected = assertThrows(ApiException.class, () -> documents.append(first, answer("scene_1", "scene_1")));
        assertTrue(rejected.getMessage().contains("上一段末镜场景"));
        JsonNode second = documents.append(first, answer("scene_2", "scene_2"));
        assertEquals(2, second.path("segments").size());
        assertEquals(2, second.path("segments").get(1).path("number").asInt());
        assertEquals(previousEnd, second.path("segments").get(1).path("startState"));
        assertEquals(first.path("segments").get(0), second.path("segments").get(0));
        JsonNode modelInput = Json.read(documents.segmentInput(first));
        assertEquals(previousEnd, modelInput.path("previousEndState"));
        assertEquals(first.path("segments").get(0).path("script"),modelInput.path("recentSegments").get(0).path("script"));
        assertEquals(first.path("characters"),first.path("segments").get(0).path("archiveSnapshot").path("characters"));
    }

    @Test void pureStoryboardOutputKeepsTheFixedStyleFormatAndItsSourceParagraph() {
        JsonNode document = document();
        JsonNode result = documents.append(document, answer("scene_1", "scene_1"));
        JsonNode segment = result.path("segments").get(0);
        assertEquals("她接过钥匙，抬头看向门外。", segment.path("script").asString());
        assertEquals(1, segment.path("castIds").size());
        assertEquals("char_1", segment.path("castIds").get(0).asString());
        assertEquals(CanvasStoryDocument.STYLE, segment.path("style").asString());
        String formatted = segment.path("formattedPrompt").asString();
        assertTrue(formatted.startsWith("（" + CanvasStoryDocument.STYLE + "）\n出镜角色汇总：角色1：陈青"));
        assertEquals(7, formatted.lines().count());
        for (int i = 0; i < 5; i++) assertTrue(formatted.contains(i * 3 + "s–" + (i + 1) * 3 + "s｜镜头类型：中景"));
        assertEquals(5, formatted.split("旁白：无", -1).length - 1);
        assertTrue(formatted.contains("陈青的台词（音色参考：自然沉稳的青年女声）：慢一点。"));
        assertTrue(formatted.contains("｜角色动作：陈青（画面左侧，站立，接过钥匙）"));
        assertFalse(formatted.contains("```"));
        assertEquals(document.path("paragraph"), result.path("paragraph"));
    }

    @Test void multilineModelDescriptionsRemainExactlyFiveOutputRows() {
        var rows=shotRows(answer("scene_1","scene_1"));rows.getFirst().put("visibleAction","推开门\n再抬头");rows.getFirst().put("sound","脚步声\r\n门轴声");
        JsonNode result=documents.append(document(),CanvasStoryDocument.node(Map.of("shots",rows)));
        String output=result.path("segments").get(0).path("formattedPrompt").asString();
        assertEquals(7,output.lines().count());assertTrue(output.contains("推开门 再抬头"));assertTrue(output.contains("脚步声 门轴声"));
    }

    private JsonNode document() {
        var fields = editFields(documents.extracted(CanvasStoryDocument.empty(), archive()));
        fields.put("paragraph", "她接过钥匙，抬头看向门外。");
        fields.put("world", "现代城市，人物与车辆外观保持连续。");
        fields.put("novel", "陈青在仓库接过钥匙，随后走向院门。");
        return documents.edit(CanvasStoryDocument.node(fields), documents.extracted(CanvasStoryDocument.empty(), archive()));
    }

    private static Map<String, Object> editFields(JsonNode document) {
        var result = new LinkedHashMap<String, Object>();
        for (String key : CanvasStoryDocument.EDITABLE) result.put(key, document.path(key));
        return result;
    }

    private static JsonNode archive() {
        var core = new LinkedHashMap<String, Object>();
        for (String key : List.of("age", "country", "era", "gender", "features", "face", "hairColor", "hairStyle", "eyeColor", "build")) {
            core.put(key, switch (key) {
                case "age" -> "25岁"; case "country" -> "中国"; case "era" -> "现代"; case "gender" -> "女性";
                case "features" -> "自然五官"; case "face" -> "椭圆脸"; case "hairColor" -> "黑色";
                case "hairStyle" -> "短发"; case "eyeColor" -> "棕色"; default -> "中等身型";
            });
        }
        var character = new LinkedHashMap<String, Object>();
        character.put("id", "char_1"); character.put("name", "陈青"); character.put("aliases", List.of("小陈")); character.put("locked", false);
        character.put("core", core); character.put("clothing", Map.of("upper", "灰色夹克", "lower", "深色长裤", "shoes", "白色运动鞋", "accessories", "银色手表"));
        character.put("personality", "沉稳"); character.put("voice", "自然沉稳的青年女声"); character.put("assumptions", List.of("外观为拍摄拟定，需创作者核对"));
        return CanvasStoryDocument.node(Map.of("characters", List.of(character), "scenes", List.of(scene("scene_1", "仓库"), scene("scene_2", "院门")),
            "props", List.of(Map.of("id", "prop_1", "name", "车钥匙", "material", "金属和塑料", "size", "手掌大小", "appearance", "黑色外壳"))));
    }

    private static Map<String, Object> scene(String id, String name) {
        return Map.of("id", id, "name", name, "aliases", List.of(), "time", "清晨", "weather", "晴朗", "lighting", "自然侧光", "space", "门口与通道连通", "elements", "水泥地面和金属门");
    }

    private static Map<String, Object> actor(String id) {
        return Map.of("characterId", id, "position", "画面左侧", "posture", "站立", "action", "接过钥匙", "wardrobe", "灰色夹克与深色长裤");
    }

    private static JsonNode answer(String firstScene, String finalScene) {
        var shots = new ArrayList<Map<String, Object>>();
        for (int i = 0; i < 5; i++) {
            var shot = new LinkedHashMap<String, Object>();
            shot.put("start", i * 3); shot.put("end", (i + 1) * 3);
            shot.put("shotType", "中景"); shot.put("camera", "缓慢平移"); shot.put("visibleAction", "动作" + i);
            shot.put("sound", "脚步声与钥匙碰撞声"); shot.put("sceneDetail", "清晨自然侧光，金属门与水泥地面");
            shot.put("sceneId", i == 0 ? firstScene : i == 4 ? finalScene : "scene_1");
            shot.put("characters", List.of(actor("char_1"))); shot.put("dialogue", i == 0 ? List.of(Map.of("characterId", "char_1", "text", "慢一点。")) : List.of());
            shot.put("propIds", List.of("prop_1")); shots.add(shot);
        }
        return CanvasStoryDocument.node(Map.of("shots", shots));
    }

    private static ArrayList<Map<String, Object>> shotRows(JsonNode answer) {
        var result = new ArrayList<Map<String, Object>>();
        for (JsonNode shot : answer.path("shots")) result.add(CanvasStoryDocument.mutable(shot));
        return result;
    }
}
