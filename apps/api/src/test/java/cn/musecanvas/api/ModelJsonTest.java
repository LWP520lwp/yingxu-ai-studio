package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import java.util.List;
import org.junit.jupiter.api.Test;

class ModelJsonTest {
    private static final String OBJECT="{\"title\":\"仓库\",\"shots\":[{\"action\":\"推门\"}]}";

    @Test void acceptsPlainObjectBomWhitespaceAndASingleJsonFence(){
        for(String answer:List.of(OBJECT," \n\ufeff"+OBJECT+"\n ","```json\n"+OBJECT+"\n```","```JSON\r\n"+OBJECT+"\r\n```","```\n"+OBJECT+"\n```"))
            assertEquals(Json.read(OBJECT),ModelJson.object(answer));
    }
    @Test void acceptsAUniqueCompleteObjectWithChineseExplanationOutsideItsOptionalFence(){
        for(String answer:List.of("以下是分镜规划：\n"+OBJECT+"\n请核对角色。","已按原文整理：\n```json\n"+OBJECT+"\n```\n以上为完整结果。"))
            assertEquals("仓库",ModelJson.object(answer).path("title").asString());
    }
    @Test void bracesEscapedQuotesBackslashesAndFenceTextInsideStringsStayInsideTheObject(){
        String source=Json.write(java.util.Map.of("text","括号 { 内部 [ ] }，引号 \" 与反斜线 \\ 及 ```json 字样","nested",List.of(java.util.Map.of("value","\\\"}"))));
        assertEquals(Json.read(source),ModelJson.object("输出如下：\n"+source+"\n结束。"));
    }
    @Test void refusesMultipleObjectsArraysMultipleFencesAndUnknownFenceLanguages(){
        for(String answer:List.of(OBJECT+OBJECT,OBJECT+"\n说明\n{}","["+OBJECT+"]","```json\n"+OBJECT+"\n```\n```json\n{}\n```","```javascript\n"+OBJECT+"\n```","```json\n"+OBJECT,OBJECT+"\n```","```json\n"+OBJECT+"不要这个字段\n```"))
            assertThrows(IllegalArgumentException.class,()->ModelJson.object(answer),answer);
    }
    @Test void refusesTruncationMalformedSyntaxDuplicateFieldsAndUnfinishedSecondObjects(){
        for(String answer:List.of("{\"shots\":[{\"action\":\"推门\"}","{\"text\":\"未闭合}","{\"text\":\"结尾反斜线\\",OBJECT+"\n{\"unfinished\":","{\"title\":1,\"title\":2}","{\"x\":1,}","{invalid}","结果暂缺","null","", "{\"x\":[1,2}}"))
            assertThrows(IllegalArgumentException.class,()->ModelJson.object(answer),answer);
    }
    @Test void boundsInputAndDepthWithoutLeakingTheOriginalResponseInErrors(){
        assertThrows(IllegalArgumentException.class,()->ModelJson.object(null));
        var error=assertThrows(IllegalArgumentException.class,()->ModelJson.object("sensitive-content"+" ".repeat(ModelJson.MAX_CHARACTERS)));
        assertFalse(error.getMessage().contains("sensitive-content"));
        assertThrows(IllegalArgumentException.class,()->ModelJson.object("{\"x\":"+"[".repeat(129)+"0"+"]".repeat(129)+"}"));
    }
}
