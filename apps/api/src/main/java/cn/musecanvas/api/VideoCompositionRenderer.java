package cn.musecanvas.api;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

/** Bounded local FFmpeg composition. Media inputs are owned files, never URLs. */
@Component
public class VideoCompositionRenderer {
    public static class RenderFailure extends RuntimeException { RenderFailure(String message){super(message);} }
    private record Input(JsonNode clip,int index,String mime,boolean hasAudio) {}
    public record MediaInfo(double duration,boolean hasAudio,boolean hasVideo) {}
    private final String ffmpeg;
    private final String ffprobe;
    private volatile long checkedAt;
    private volatile boolean toolsAvailable;
    public VideoCompositionRenderer(Environment env) {
        this.ffmpeg=env.getProperty("app.ffmpeg-bin",env.getProperty("FFMPEG_BIN","ffmpeg"));
        this.ffprobe=env.getProperty("app.ffprobe-bin",env.getProperty("FFPROBE_BIN","ffprobe"));
    }
    public synchronized boolean available() {
        if(System.nanoTime()-checkedAt<Duration.ofSeconds(60).toNanos()&&checkedAt!=0)return toolsAvailable;
        toolsAvailable=version(ffmpeg)&&version(ffprobe);checkedAt=System.nanoTime();return toolsAvailable;
    }
    private boolean version(String tool) {
        Process process=null;
        try {process=new ProcessBuilder(tool,"-version").redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD).start();return process.waitFor(4,TimeUnit.SECONDS)&&process.exitValue()==0;}
        catch(Exception unavailable){if(unavailable instanceof InterruptedException)Thread.currentThread().interrupt();return false;}
        finally {if(process!=null&&process.isAlive())process.destroyForcibly();}
    }
    public byte[] render(String owner,JsonNode document,AssetService assets,WorkbenchStore store) {
        if(!available())throw new RenderFailure("当前部署未找到 FFmpeg/ffprobe，暂不能导出MP4");
        Path scratch=null;
        try {
            // The storage parent is trusted deployment configuration. Each export
            // has its own directory; FFmpeg only sees fixed local output names.
            scratch=Files.createTempDirectory(assets.safePath(".video-render-").getParent(),".video-render-");
            return renderIn(owner,document,assets,store,scratch);
        } catch(RenderFailure failure){throw failure;}
        catch(InterruptedException cancelled){Thread.currentThread().interrupt();throw new RenderFailure("成片导出已中断，时间线与素材仍然保留");}
        catch(Exception failure){throw new RenderFailure("媒体解码或成片写入失败，请检查素材后重新导出");}
        finally {if(scratch!=null)clean(scratch);}
    }
    public MediaInfo inspect(Path source){
        JsonNode metadata=probe(source);boolean video=false;double visualDuration=Double.NaN;
        for(JsonNode stream:metadata.path("streams"))if("video".equals(stream.path("codec_type").asString())){
            video=true;try{double value=Double.parseDouble(stream.path("duration").asString("NaN"));if(Double.isFinite(value)&&value>0)visualDuration=Double.isFinite(visualDuration)?Math.min(visualDuration,value):value;}catch(NumberFormatException ignored){}
        }
        // Container duration can include a longer audio tail; compose only available picture frames.
        return new MediaInfo(Double.isFinite(visualDuration)?visualDuration:duration(metadata),hasAudio(metadata),video);
    }
    private byte[] renderIn(String owner,JsonNode document,AssetService assets,WorkbenchStore store,Path scratch)throws Exception {
        double total=0;for(JsonNode clip:document.path("clips"))total=Math.max(total,clip.path("start").asDouble()+clip.path("duration").asDouble());
        if(total<=0||total>180.00001)throw new RenderFailure("有效时间线应在一帧到180秒之间");
        int width=1280,height=720;
        if("9:16".equals(document.path("aspectRatio").asString())){width=720;height=1280;}
        if("1:1".equals(document.path("aspectRatio").asString())){width=720;height=720;}
        var command=new ArrayList<>(List.of(ffmpeg,"-hide_banner","-v","warning","-nostdin","-y","-filter_complex_threads","1",
            "-f","lavfi","-i","color=c=black:s="+width+"x"+height+":r=30:d="+decimal(total),
            "-f","lavfi","-t",decimal(total),"-i","anullsrc=r=48000:cl=stereo"));
        var inputs=new ArrayList<Input>();int inputIndex=2;
        var sourceDurations=new HashMap<String,JsonNode>();
        for(JsonNode clip:document.path("clips")) {
            if("caption".equals(clip.path("track").asString()))continue;
            String assetId=clip.path("assetId").asString();var asset=store.asset(owner,assetId);
            String mime=String.valueOf(asset.get("mimeType"));Path path=assets.content(owner,assetId);
            JsonNode metadata=sourceDurations.computeIfAbsent(assetId,ignored->probe(path));
            boolean image=mime.startsWith("image/");boolean audio=hasAudio(metadata);
            if(!image){double sourceDuration=duration(metadata);if(!Double.isFinite(sourceDuration)||clip.path("inPoint").asDouble()+clip.path("duration").asDouble()>sourceDuration+.05)throw new RenderFailure("片段裁切超出原素材时长，请调整素材入点或片段长度");}
            command.addAll(List.of("-protocol_whitelist","file,pipe"));
            if(image)command.addAll(List.of("-loop","1","-framerate","30","-f","image2"));
            else command.addAll(List.of("-ss",decimal(clip.path("inPoint").asDouble()),"-f",inputFormat(mime)));
            command.addAll(List.of("-t",decimal(clip.path("duration").asDouble()),"-i",path.toString()));
            inputs.add(new Input(clip,inputIndex++,mime,audio));
        }
        var filter=new StringBuilder("[0:v]setpts=PTS-STARTPTS[background];[1:a]atrim=duration="+decimal(total)+",asetpts=PTS-STARTPTS[silence];");
        String video="background";var audioLabels=new ArrayList<String>();audioLabels.add("silence");int visualIndex=0,audioIndex=0;
        for(Input input:inputs) {
            JsonNode clip=input.clip();double start=clip.path("start").asDouble(),length=clip.path("duration").asDouble();
            if("video".equals(clip.path("track").asString())) {
                String source="visual"+visualIndex,next="composite"+visualIndex++;
                filter.append('[').append(input.index()).append(":v]scale=").append(width).append(':').append(height)
                    .append(":force_original_aspect_ratio=decrease,pad=").append(width).append(':').append(height)
                    .append(":(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,setpts=PTS-STARTPTS+").append(decimal(start)).append("/TB[").append(source).append("];")
                    .append('[').append(video).append("][").append(source).append("]overlay=eof_action=pass:repeatlast=0:enable='gte(t,").append(decimal(start)).append(")*lt(t,").append(decimal(start+length)).append(")'[").append(next).append("];");
                video=next;
            }
            if(input.hasAudio()&&clip.path("volume").asDouble()>0) {
                String label="audio"+audioIndex++;audioLabels.add(label);
                filter.append('[').append(input.index()).append(":a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,atrim=duration=")
                    .append(decimal(length)).append(",volume=").append(decimal(clip.path("volume").asDouble())).append(",adelay=").append(Math.round(start*1000)).append(":all=1[").append(label).append("];");
            }
        }
        boolean captions=writeCaptions(document,scratch.resolve("captions.srt"));
        filter.append('[').append(video).append(']');
        if(captions)filter.append("subtitles=filename=captions.srt:force_style='FontName=Microsoft YaHei,FontSize=24,Outline=1,Shadow=0,MarginV=24',");
        filter.append("format=yuv420p[vout];");
        for(String label:audioLabels)filter.append('[').append(label).append(']');
        filter.append("amix=inputs=").append(audioLabels.size()).append(":duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95,apad,atrim=duration=").append(decimal(total)).append("[aout]");
        Files.writeString(scratch.resolve("filters.txt"),filter,StandardCharsets.UTF_8);
        command.addAll(List.of("-filter_complex_script","filters.txt","-map","[vout]","-map","[aout]","-r","30","-c:v","libx264","-preset","veryfast","-crf","23","-threads","2","-c:a","aac","-b:a","128k","-movflags","+faststart","-t",decimal(total),"-fs",String.valueOf(AssetService.MAX_BYTES),"output.mp4"));
        run(command,scratch,Math.min(720,45+(int)Math.ceil(total*4)));
        Path result=scratch.resolve("output.mp4");
        if(!Files.isRegularFile(result)||Files.size(result)==0||Files.size(result)>AssetService.MAX_BYTES)throw new RenderFailure("导出文件为空或超过100MB，请缩短时间线");
        double actual=duration(probe(result));if(actual+.08<total)throw new RenderFailure("导出未覆盖完整时间线，可能超过100MB限制，请缩短后重试");
        return Files.readAllBytes(result);
    }
    private static String inputFormat(String mime) {return switch(mime){case "video/mp4"->"mov";case "video/webm"->"matroska";case "audio/mpeg","audio/mp3"->"mp3";case "audio/wav","audio/x-wav"->"wav";case "audio/ogg"->"ogg";default->throw new RenderFailure("此素材格式暂不能用于成片导出");};}
    private JsonNode probe(Path source) {
        Path log=null;
        try {
            log=Files.createTempFile(source.getParent(),".video-probe-",".json");
            var command=List.of(ffprobe,"-v","error","-protocol_whitelist","file,pipe","-format_whitelist","mov,matroska,mp3,wav,ogg,png_pipe,jpeg_pipe,webp_pipe,gif","-show_entries","format=duration:stream=codec_type,width,height,duration","-of","json",source.toString());
            Process process=new ProcessBuilder(command).redirectOutput(log.toFile()).redirectError(ProcessBuilder.Redirect.DISCARD).start();
            try {if(!process.waitFor(8,TimeUnit.SECONDS)||process.exitValue()!=0)throw new RenderFailure("素材无法解码或时长检查超时，请检查文件后重试");}
            finally {if(process.isAlive())process.destroyForcibly();}
            if(Files.size(log)>1024*1024)throw new RenderFailure("素材元数据异常");
            return Json.read(Files.readString(log));
        } catch(RenderFailure error){throw error;}
        catch(InterruptedException error){Thread.currentThread().interrupt();throw new RenderFailure("素材检查已中断");}
        catch(Exception error){throw new RenderFailure("无法读取素材信息，请检查文件是否完整");}
        finally {if(log!=null)try{Files.deleteIfExists(log);}catch(IOException ignored){}}
    }
    private static boolean hasAudio(JsonNode probe) {for(JsonNode stream:probe.path("streams"))if("audio".equals(stream.path("codec_type").asString()))return true;return false;}
    private static double duration(JsonNode probe) {try{return Double.parseDouble(probe.path("format").path("duration").asString("NaN"));}catch(Exception error){return Double.NaN;}}
    private static boolean writeCaptions(JsonNode document,Path target)throws IOException {
        var captions=new ArrayList<JsonNode>();for(JsonNode clip:document.path("clips"))if("caption".equals(clip.path("track").asString()))captions.add(clip);
        if(captions.isEmpty())return false;captions.sort(Comparator.comparingDouble(c->c.path("start").asDouble()));
        var content=new StringBuilder();int index=0;for(JsonNode clip:captions)content.append(++index).append('\n').append(srtTime(clip.path("start").asDouble())).append(" --> ").append(srtTime(clip.path("start").asDouble()+clip.path("duration").asDouble())).append('\n')
            .append(clip.path("text").asString().replace('{','｛').replace('}','｝').replace("\r","")).append("\n\n");
        Files.writeString(target,content,StandardCharsets.UTF_8);return true;
    }
    private static String srtTime(double seconds) {long ms=Math.round(seconds*1000);return String.format(Locale.ROOT,"%02d:%02d:%02d,%03d",ms/3600000,(ms/60000)%60,(ms/1000)%60,ms%1000);}
    private static String decimal(double value) {return String.format(Locale.ROOT,"%.6f",value);}
    private static void run(List<String> command,Path directory,int timeoutSeconds)throws IOException,InterruptedException {
        Process process=new ProcessBuilder(command).directory(directory.toFile()).redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
        try {if(!process.waitFor(timeoutSeconds,TimeUnit.SECONDS))throw new RenderFailure("成片渲染超时，请缩短时间线后重试");if(process.exitValue()!=0)throw new RenderFailure("成片渲染失败，请检查字幕、音视频素材和裁切范围");}
        finally {if(process.isAlive())process.destroyForcibly();}
    }
    private static void clean(Path directory) {try(var files=Files.walk(directory)){for(Path file:files.sorted(Comparator.reverseOrder()).toList())try{Files.deleteIfExists(file);}catch(IOException ignored){}}catch(IOException ignored){}}
}
