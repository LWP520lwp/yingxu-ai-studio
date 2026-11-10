package cn.musecanvas.api;

import java.net.URI;
import java.util.*;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

/** User-controlled educational material; source association never certifies scientific truth. */
@Component
public class ScienceVideoDocument {
    private final WorkbenchStore store;
    public ScienceVideoDocument(WorkbenchStore store){this.store=store;}
    public static JsonNode empty(){return Json.read("{\"schemaVersion\":1,\"topic\":\"\",\"title\":\"\",\"audience\":\"general\",\"structure\":\"explain\",\"aspectRatio\":\"16:9\",\"sources\":[],\"scenes\":[]}");}
    public JsonNode validate(String owner,String project,JsonNode doc){
        store.project(owner,project);fields(doc,Set.of("schemaVersion","topic","title","audience","structure","aspectRatio","models","sources","scenes"));
        if(!doc.path("schemaVersion").isIntegralNumber()||doc.path("schemaVersion").asDouble()!=1)throw ApiException.invalid("科普文档版本必须为1");
        var result=new LinkedHashMap<String,Object>();result.put("schemaVersion",1);result.put("topic",text(doc.path("topic"),200,true));result.put("title",text(doc.path("title"),200,true));
        result.put("audience",choice(doc.path("audience"),Set.of("children","teen","general")));result.put("structure",choice(doc.path("structure"),Set.of("misconception","experiment","explain")));result.put("aspectRatio",choice(doc.path("aspectRatio"),Set.of("16:9","9:16","1:1")));
        // Persist model IDs with the draft, without storing provider credentials or requiring a still-existing channel.
        if(doc.has("models")){
            JsonNode selected=doc.path("models");fields(selected,Set.of("text","image","video"));var models=new LinkedHashMap<String,String>();
            for(String kind:List.of("text","image","video"))if(selected.has(kind))models.put(kind,text(selected.path(kind),120,true));
            result.put("models",models);
        }
        if(!doc.path("sources").isArray()||doc.path("sources").size()>12)throw ApiException.invalid("参考来源最多12条");
        var sourceIds=new HashSet<String>();var sources=new ArrayList<Map<String,Object>>();
        for(JsonNode source:doc.path("sources")){
            fields(source,Set.of("id","title","url","excerpt"));String id=id(source.path("id"));if(!sourceIds.add(id))throw ApiException.invalid("来源标识重复");
            // URLs are inert draft text here; a partially typed address must autosave.
            String url=text(source.path("url"),2000,true);
            sources.add(Map.of("id",id,"title",text(source.path("title"),200,true),"url",url,"excerpt",text(source.path("excerpt"),3000,true)));
        }
        result.put("sources",sources);if(!doc.path("scenes").isArray()||doc.path("scenes").size()>6)throw ApiException.invalid("科普短片最多6幕");
        var ids=new HashSet<String>();var scenes=new ArrayList<Map<String,Object>>();int total=0;
        for(JsonNode scene:doc.path("scenes")){
            fields(scene,Set.of("id","role","narration","visualPrompt","videoPrompt","assetId","videoAssetId","sourceIds","verified"));String id=id(scene.path("id"));if(!ids.add(id))throw ApiException.invalid("分幕标识重复");
            var row=new LinkedHashMap<String,Object>();row.put("id",id);row.put("role",choice(scene.path("role"),Set.of("hook","explain","experiment","question")));String narration=text(scene.path("narration"),400,true);total+=narration.length();row.put("narration",narration);row.put("visualPrompt",text(scene.path("visualPrompt"),2000,true));
            if(scene.has("videoPrompt"))row.put("videoPrompt",text(scene.path("videoPrompt"),3000,true));
            if(!scene.path("sourceIds").isArray()||scene.path("sourceIds").size()>12)throw ApiException.invalid("请为每幕选择参考来源");var refs=new LinkedHashSet<String>();for(JsonNode ref:scene.path("sourceIds")){String value=id(ref);if(!sourceIds.contains(value)||!refs.add(value))throw ApiException.invalid("分幕引用了不存在或重复的来源");}row.put("sourceIds",refs);
            if(!scene.path("verified").isBoolean())throw ApiException.invalid("每幕须包含用户核对状态");row.put("verified",scene.path("verified").asBoolean());
            if(scene.has("assetId")&&!scene.path("assetId").isNull()&&!scene.path("assetId").asString("").isBlank()){
                String assetId=id(scene.path("assetId"));var asset=store.asset(owner,assetId);String mime=String.valueOf(asset.get("mimeType"));if(!mime.startsWith("image/")&&!mime.startsWith("video/"))throw ApiException.invalid("分幕画面须使用图片或视频");if(asset.get("projectId")!=null&&!project.equals(asset.get("projectId")))throw ApiException.invalid("画面素材不属于当前项目");row.put("assetId",assetId);
            }
            if(scene.has("videoAssetId")&&!scene.path("videoAssetId").isNull()&&!scene.path("videoAssetId").asString("").isBlank()){
                String assetId=id(scene.path("videoAssetId"));var asset=store.asset(owner,assetId);
                if(!String.valueOf(asset.get("mimeType")).startsWith("video/"))throw ApiException.invalid("动态分幕须选择真正的视频素材，图片不能作为成片片段");
                if(asset.get("projectId")!=null&&!project.equals(asset.get("projectId")))throw ApiException.invalid("分幕视频不属于当前项目");
                row.put("videoAssetId",assetId);
            }
            scenes.add(row);
        }
        if(total>1400)throw ApiException.invalid("科普讲稿总计最多1400字符，实际配音总时长仍须不超过180秒");result.put("scenes",scenes);return Json.read(Json.write(result));
    }
    public void requireReady(JsonNode doc,boolean generate){
        requireSources(doc);
        for(JsonNode scene:doc.path("scenes")){
            if(!scene.has("assetId")&&!generate)throw ApiException.invalid("部分分幕缺少画面，请选择现有图片/视频，或明确勾选生成缺失图片");
            if(!scene.has("assetId")&&scene.path("visualPrompt").asString("").isBlank())throw ApiException.invalid("生成缺失图片前请填写该幕画面提示词");
        }
        int sentenceCount=0;for(JsonNode scene:doc.path("scenes"))sentenceCount+=sentences(scene.path("narration").asString(),80).size();if(sentenceCount>24)throw ApiException.invalid("讲稿拆分超过24句，请精简至24句以内以保证字幕可编辑");
    }
    public void requireDynamicReady(JsonNode doc,boolean generate,int duration){
        requireSources(doc);
        int limit=Math.min(45,duration*3);
        for(JsonNode scene:doc.path("scenes")){
            if(scene.path("narration").asString().length()>limit)throw ApiException.invalid("每幕"+duration+"秒原生讲解最多"+limit+"字，请精简讲稿以留出自然停顿");
            if(!scene.has("videoAssetId")&&!generate)throw ApiException.invalid("部分分幕缺少动态视频，请绑定现有视频，或明确开启生成缺失视频");
            if(!scene.has("videoAssetId")&&videoPrompt(scene).isBlank())throw ApiException.invalid("请为每幕填写视频动作、过程与运镜提示词");
        }
    }
    static String videoPrompt(JsonNode scene){String prompt=scene.path("videoPrompt").asString("");return prompt.isBlank()?scene.path("visualPrompt").asString(""):prompt;}
    private void requireSources(JsonNode doc){
        if(doc.path("scenes").isEmpty())throw ApiException.invalid("先添加或规划至少一幕讲稿");
        for(JsonNode scene:doc.path("scenes")){
            if(scene.path("narration").asString().isBlank())throw ApiException.invalid("制作前请补齐每幕讲稿");
            if(!scene.path("verified").asBoolean()||scene.path("sourceIds").isEmpty())throw ApiException.invalid("请逐幕关联来源并勾选本人已核对；这表示用户确认，不代表机器完成事实认证");
            for(JsonNode ref:scene.path("sourceIds"))for(JsonNode source:doc.path("sources"))if(ref.asString().equals(source.path("id").asString())){
                if(source.path("title").asString().isBlank()||source.path("excerpt").asString().isBlank())throw ApiException.invalid("制作前请补齐所引用来源的标题与原文摘录");
                String address=source.path("url").asString();if(!address.isBlank())try{URI uri=URI.create(address);if(!Set.of("https","http").contains(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null)throw new IllegalArgumentException();}catch(Exception e){throw ApiException.invalid("参考网址可留空；填写时须为不含凭据的完整HTTP(S)网址");}
            }
        }
    }
    public static List<String> sentences(String input,int max){
        var out=new ArrayList<String>();for(String part:input.split("(?<=[。！？!?；;])|[\\r\\n]+")){String s=part.strip();while(!s.isEmpty()){int end=Math.min(max,s.length());if(end<s.length()&&Character.isHighSurrogate(s.charAt(end-1)))end--;out.add(s.substring(0,end));s=s.substring(end).strip();}}return out;
    }
    static void fields(JsonNode value,Set<String> fields){if(value==null||!value.isObject())throw ApiException.invalid("科普文档或分幕必须为对象");for(String key:value.propertyNames())if(!fields.contains(key))throw ApiException.invalid("科普文档包含不支持的字段");}
    static String text(JsonNode node,int max,boolean blank){if(!node.isString())throw ApiException.invalid("科普文案须为文字");String s=node.asString().strip();if(!blank&&s.isEmpty()||s.length()>max||s.codePoints().anyMatch(c->Character.isISOControl(c)&&c!='\n'&&c!='\t'))throw ApiException.invalid("科普文案为空、过长或包含控制字符");return s;}
    private static String id(JsonNode node){String id=text(node,128,false);if(!id.matches("[A-Za-z0-9_-]{1,128}"))throw ApiException.invalid("来源、分幕或素材标识无效");return id;}
    private static String choice(JsonNode node,Set<String> values){String value=text(node,40,false);if(!values.contains(value))throw ApiException.invalid("受众、结构、分幕角色或比例无效");return value;}
}
