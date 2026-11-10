package cn.musecanvas.api;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
public class AssetService {
    public static final long MAX_BYTES=100L*1024*1024;
    private static final Set<String> ALLOWED=Set.of("image/png","image/jpeg","image/webp","image/gif","video/mp4","video/webm","audio/mpeg","audio/mp3","audio/wav","audio/x-wav","audio/ogg","application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document","text/plain");
    private final AppSettings settings;
    private final WorkbenchStore store;
    public AssetService(AppSettings settings,WorkbenchStore store) {this.settings=settings;this.store=store;}
    public Map<String,Object> upload(String owner,String projectId,MultipartFile file) {
        if(projectId!=null&&!projectId.isBlank())store.project(owner,projectId);else projectId=null;
        if(file.isEmpty() || file.getSize()>MAX_BYTES)throw ApiException.invalid("素材不能为空，且不能超过 100MB");
        String mime=file.getContentType()==null?"application/octet-stream":file.getContentType().split(";")[0];
        if(!ALLOWED.contains(mime))throw ApiException.invalid("暂不支持此文件格式（支持图片、音视频、PDF、DOCX、TXT）");
        String id=UUID.randomUUID().toString();String storage=id+extension(mime);
        try {
            Files.createDirectories(settings.storageRoot());Path target=safePath(storage);file.transferTo(target);
            try {return store.insertAsset(id,owner,projectId,cleanName(file.getOriginalFilename()),mime,Files.size(target),storage,hashFile(target),null);}
            catch(RuntimeException e){Files.deleteIfExists(target);throw e;}
        } catch(java.io.IOException e){throw new ApiException(org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR,"STORAGE_ERROR","素材保存失败");}
    }
    public record GeneratedFile(String id,String storageName,String name,String mime,long size,String hash) {}
    public GeneratedFile writeGenerated(String kind,byte[] bytes,String mime) {
        if(bytes.length==0||bytes.length>MAX_BYTES)throw ApiException.invalid("生成资源为空或超过大小限制");
        String safeMime=generatedMime(kind,bytes);
        String id=UUID.randomUUID().toString();String storage=id+extension(safeMime);
        try{Files.createDirectories(settings.storageRoot());Files.write(safePath(storage),bytes);return new GeneratedFile(id,storage,"生成"+(kind.equals("video")?"视频":"图片")+extension(safeMime),safeMime,bytes.length,Json.hash(bytes));}
        catch(java.io.IOException e){throw new IllegalStateException("生成资源保存失败",e);}
    }
    static String generatedMime(String kind,byte[] bytes){
        String mime=null;
        if(bytes.length>=24){
            if((bytes[0]&255)==137&&bytes[1]==80&&bytes[2]==78&&bytes[3]==71&&bytes[4]==13&&bytes[5]==10&&bytes[6]==26&&bytes[7]==10)mime="image/png";
            else if((bytes[0]&255)==255&&(bytes[1]&255)==216&&(bytes[2]&255)==255)mime="image/jpeg";
            else if(new String(bytes,0,6,java.nio.charset.StandardCharsets.US_ASCII).matches("GIF8[79]a"))mime="image/gif";
            else if(new String(bytes,0,4,java.nio.charset.StandardCharsets.US_ASCII).equals("RIFF")&&new String(bytes,8,4,java.nio.charset.StandardCharsets.US_ASCII).equals("WEBP"))mime="image/webp";
            else if(new String(bytes,4,4,java.nio.charset.StandardCharsets.US_ASCII).equals("ftyp"))mime="video/mp4";
            else if((bytes[0]&255)==26&&(bytes[1]&255)==69&&(bytes[2]&255)==223&&(bytes[3]&255)==163)mime="video/webm";
        }
        if(mime==null||!mime.startsWith(kind+"/"))throw new MuseClient.Rejected("上游返回的资源不是有效的"+(kind.equals("video")?"视频":"图片")+"，任务未标记成功");
        return mime;
    }
    public Map<String,Object> commitGenerated(String owner,String projectId,String jobId,GeneratedFile file) {return store.insertAsset(file.id(),owner,projectId,file.name(),file.mime(),file.size(),file.storageName(),file.hash(),jobId);}
    public void discard(GeneratedFile file){try{Files.deleteIfExists(safePath(file.storageName()));}catch(java.io.IOException ignored){}}
    public Path content(String owner,String id){store.asset(owner,id);Path path=safePath(store.storageName(owner,id));if(!Files.isRegularFile(path))throw ApiException.notFound();return path;}
    public String referenceDataUrl(String owner,String id) {
        var asset=store.asset(owner,id);String mime=String.valueOf(asset.get("mimeType"));
        if(!mime.startsWith("image/"))throw ApiException.invalid("参考素材必须为图片");
        if(((Number)asset.get("size")).longValue()>8L*1024*1024)throw ApiException.invalid("参考图片不能超过 8MB");
        try{return "data:"+mime+";base64,"+java.util.Base64.getEncoder().encodeToString(Files.readAllBytes(content(owner,id)));}
        catch(java.io.IOException e){throw ApiException.invalid("参考图片暂不可读取");}
    }
    Path safePath(String storageName){Path root=settings.storageRoot();Path p=root.resolve(storageName).normalize();if(!p.startsWith(root))throw ApiException.invalid("非法素材路径");return p;}
    static String extension(String mime){return switch(mime){case "image/jpeg"->".jpg";case "image/webp"->".webp";case "image/gif"->".gif";case "video/mp4"->".mp4";case "video/webm"->".webm";case "audio/mpeg","audio/mp3"->".mp3";case "audio/wav","audio/x-wav"->".wav";case "audio/ogg"->".ogg";case "application/pdf"->".pdf";case "application/vnd.openxmlformats-officedocument.wordprocessingml.document"->".docx";case "text/plain"->".txt";default->".png";};}
    static String cleanName(String value){if(value==null||value.isBlank())return "素材";String name=value.replaceAll("[\\\\/\\p{Cntrl}]","_");return name.substring(0,Math.min(200,name.length()));}
    private String hashFile(Path path)throws java.io.IOException{try(InputStream in=Files.newInputStream(path)){var digest=MessageDigest.getInstance("SHA-256");byte[] buffer=new byte[16384];int n;while((n=in.read(buffer))!=-1)digest.update(buffer,0,n);return HexFormat.of().formatHex(digest.digest());}catch(java.security.NoSuchAlgorithmException e){throw new IllegalStateException(e);}}
}
