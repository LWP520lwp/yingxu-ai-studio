package cn.musecanvas.api;

import java.util.*;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

/** Shared, side-effect-free validation for generated video, narration and caption compositions. */
@Component
public class VideoCompositionDocument {
    private static final Set<String> DOCUMENT_FIELDS=Set.of("schemaVersion","aspectRatio","fps","clips");
    private static final Set<String> CLIP_FIELDS=Set.of("id","track","assetId","start","duration","inPoint","volume","text","name");
    private final WorkbenchStore store;
    public VideoCompositionDocument(WorkbenchStore store){this.store=store;}
    /** Validates generated compositions before rendering any owned media. */
    public JsonNode validate(String owner,String projectId,JsonNode document) {
        store.project(owner,projectId);
        if(document==null||!document.isObject())throw ApiException.invalid("合成 document 必须为对象");
        knownFields(document,DOCUMENT_FIELDS);
        if(!document.path("schemaVersion").isIntegralNumber()||document.path("schemaVersion").asDouble()!=1
            ||!document.path("fps").isIntegralNumber()||document.path("fps").asDouble()!=30||!Set.of("16:9","9:16","1:1").contains(document.path("aspectRatio").asString("")))
            throw ApiException.invalid("合成文档须使用 schemaVersion 1、30fps 和支持的画面比例");
        JsonNode clips=document.path("clips");
        if(!clips.isArray()||clips.size()>40)throw ApiException.invalid("合成最多包含40个片段");
        var ids=new HashSet<String>();var normalized=new ArrayList<Map<String,Object>>();var visuals=new ArrayList<double[]>();
        for(JsonNode clip:clips) {
            if(!clip.isObject())throw ApiException.invalid("片段必须为对象");
            knownFields(clip,CLIP_FIELDS);
            String id=clip.path("id").asString("");String track=clip.path("track").asString("");
            if(!id.matches("[A-Za-z0-9_-]{1,128}")||!ids.add(id)||!Set.of("video","audio","caption").contains(track))throw ApiException.invalid("片段标识或轨道无效");
            double start=frameNumber(clip.path("start"),false),duration=frameNumber(clip.path("duration"),true);
            double inPoint=clip.has("inPoint")?frameNumber(clip.path("inPoint"),false):0;
            double volume=clip.has("volume")?number(clip.path("volume")):1;
            if(volume<0||volume>1||start+duration>180+0.00001||inPoint>24*60*60)throw ApiException.invalid("时间线最长180秒，音量须在0–1之间");
            var row=new LinkedHashMap<String,Object>();row.put("id",id);row.put("track",track);row.put("start",start);row.put("duration",duration);row.put("inPoint",inPoint);row.put("volume",volume);
            if(clip.has("name")){String name=safeText(clip.path("name"),200);row.put("name",name);}
            if(track.equals("caption")) {
                if(clip.has("assetId"))throw ApiException.invalid("字幕片段不能引用媒体素材");
                if(inPoint!=0)throw ApiException.invalid("字幕片段的素材入点必须为0");
                row.put("text",safeText(clip.path("text"),2000));
            } else {
                String assetId=clip.path("assetId").asString("");if(!assetId.matches("[A-Za-z0-9_-]{1,128}"))throw ApiException.invalid("媒体片段必须引用已上传素材");
                var asset=store.asset(owner,assetId);String mime=String.valueOf(asset.get("mimeType"));Object sourceProject=asset.get("projectId");
                if(sourceProject!=null&&!projectId.equals(sourceProject))throw ApiException.invalid("片段素材不属于当前项目");
                if(track.equals("video")&&!mime.startsWith("image/")&&!mime.startsWith("video/")||track.equals("audio")&&!mime.startsWith("audio/"))throw ApiException.invalid("素材类型与轨道不匹配");
                if(mime.startsWith("image/")&&inPoint!=0)throw ApiException.invalid("静态图片的素材入点必须为0");
                row.put("assetId",assetId);
                if(track.equals("video"))visuals.add(new double[]{start,start+duration});
            }
            normalized.add(row);
        }
        visuals.sort(Comparator.comparingDouble(a->a[0]));
        for(int i=1;i<visuals.size();i++)if(visuals.get(i)[0]+0.00001<visuals.get(i-1)[1])throw ApiException.invalid("同一画面轨道不能重叠，请移动或裁切片段");
        return Json.read(Json.write(Map.of("schemaVersion",1,"fps",30,"aspectRatio",document.path("aspectRatio").asString(),"clips",normalized)));
    }
    private static void knownFields(JsonNode value,Set<String> allowed) {for(String field:value.propertyNames())if(!allowed.contains(field))throw ApiException.invalid("合成文档包含不支持的字段："+field.substring(0,Math.min(60,field.length())));}
    private static double number(JsonNode value) {if(!value.isNumber()||!Double.isFinite(value.asDouble()))throw ApiException.invalid("片段参数必须为有限数字");return value.asDouble();}
    private static double frameNumber(JsonNode value,boolean positive) {double v=number(value);if(v<0||positive&&v<1d/30-.000001)throw ApiException.invalid("片段时间无效，时长至少一帧");return Math.round(v*30)/30d;}
    private static String safeText(JsonNode value,int max) {if(!value.isString())throw ApiException.invalid("字幕或片段名称必须为文字");String text=value.asString().strip();if(text.isEmpty()||text.length()>max||text.codePoints().anyMatch(c->Character.isISOControl(c)&&c!='\n'&&c!='\t'))throw ApiException.invalid("字幕或片段名称为空、过长或包含控制字符");return text;}
}
