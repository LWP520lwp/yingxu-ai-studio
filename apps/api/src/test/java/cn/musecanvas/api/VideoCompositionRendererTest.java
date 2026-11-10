package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.List;
import java.util.concurrent.TimeUnit;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.env.MockEnvironment;

class VideoCompositionRendererTest {
    @TempDir Path storage;
    private VideoCompositionRenderer renderer;
    @BeforeEach void setup(){renderer=new VideoCompositionRenderer(new MockEnvironment());Assumptions.assumeTrue(renderer.available(),"FFmpeg/ffprobe not installed");}
    @Test void realImageAudioAndChineseCaptionsProduceValidPrivateMp4()throws Exception {
        Path image=storage.resolve("image.png"),audio=storage.resolve("audio.wav");
        var bitmap=new BufferedImage(80,48,BufferedImage.TYPE_INT_RGB);var graphics=bitmap.createGraphics();graphics.setColor(Color.BLUE);graphics.fillRect(0,0,80,48);graphics.dispose();ImageIO.write(bitmap,"png",image.toFile());
        makeAudio(audio);
        var store=mock(WorkbenchStore.class);var assets=mock(AssetService.class);
        when(store.asset("owner","image")).thenReturn(Map.of("mimeType","image/png"));when(store.asset("owner","audio")).thenReturn(Map.of("mimeType","audio/wav"));
        when(assets.content("owner","image")).thenReturn(image);when(assets.content("owner","audio")).thenReturn(audio);when(assets.safePath(".video-render-")).thenReturn(storage.resolve(".video-render-"));
        var clips=List.of(Map.of("id","image","track","video","assetId","image","start",0,"duration",0.8,"inPoint",0,"volume",0),Map.of("id","sound","track","audio","assetId","audio","start",0,"duration",0.8,"inPoint",0,"volume",0.6),Map.of("id","caption","track","caption","text","科普剪辑 · 中文字幕","start",0,"duration",0.8));
        var document=Json.read(Json.write(Map.of("aspectRatio","16:9","clips",clips)));
        byte[] result=renderer.render("owner",document,assets,store);assertEquals("video/mp4",AssetService.generatedMime("video",result));Path exported=storage.resolve("test-result.mp4");Files.write(exported,result);
        var command=new ProcessBuilder("ffprobe","-v","error","-show_entries","format=duration:stream=codec_type,codec_name,width,height","-of","json",exported.toString()).redirectError(ProcessBuilder.Redirect.DISCARD).start();String metadata=new String(command.getInputStream().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);assertTrue(command.waitFor(10,TimeUnit.SECONDS));assertEquals(0,command.exitValue());var probe=Json.read(metadata);
        assertEquals(0.8,Double.parseDouble(probe.path("format").path("duration").asString()),0.08);assertTrue(metadata.contains("h264"));assertTrue(metadata.contains("aac"));assertTrue(metadata.contains("1280"));
        try(var files=Files.list(storage)){assertFalse(files.anyMatch(path->path.getFileName().toString().startsWith(".video-")),"render scratch files must be removed");}
    }
    @Test void rejectsTrimBeyondSourceDuration()throws Exception {
        Path audio=storage.resolve("audio.wav");makeAudio(audio);var assets=mock(AssetService.class);var store=mock(WorkbenchStore.class);when(assets.safePath(".video-render-")).thenReturn(storage.resolve(".video-render-"));when(assets.content("owner","audio")).thenReturn(audio);when(store.asset("owner","audio")).thenReturn(Map.of("mimeType","audio/wav"));
        var document=Json.read("{\"aspectRatio\":\"16:9\",\"clips\":[{\"id\":\"a\",\"track\":\"audio\",\"assetId\":\"audio\",\"start\":0,\"duration\":2,\"inPoint\":0,\"volume\":1}]}");
        assertTrue(assertThrows(VideoCompositionRenderer.RenderFailure.class,()->renderer.render("owner",document,assets,store)).getMessage().contains("裁切超出"));
    }
    @Test void realMotionVideoKeepsChangingFramesAndItsNativeAudio()throws Exception{
        Path source=storage.resolve("motion.mp4");
        var make=new ProcessBuilder("ffmpeg","-v","error","-nostdin","-y","-f","lavfi","-i","testsrc2=size=320x180:rate=30:duration=1.4","-f","lavfi","-i","sine=frequency=740:duration=1.4","-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac","-shortest",source.toString()).redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD).start();
        assertTrue(make.waitFor(15,TimeUnit.SECONDS));assertEquals(0,make.exitValue());
        var info=renderer.inspect(source);assertTrue(info.hasVideo());assertTrue(info.hasAudio());assertTrue(info.duration()>1.3);
        var store=mock(WorkbenchStore.class);var assets=mock(AssetService.class);when(store.asset("owner","motion")).thenReturn(Map.of("mimeType","video/mp4"));when(assets.content("owner","motion")).thenReturn(source);when(assets.safePath(".video-render-")).thenReturn(storage.resolve(".video-render-"));
        var document=Json.read("{\"aspectRatio\":\"16:9\",\"clips\":[{\"id\":\"motion\",\"track\":\"video\",\"assetId\":\"motion\",\"start\":0,\"duration\":1.2,\"inPoint\":0,\"volume\":1}]}");
        Path output=storage.resolve("motion-result.mp4");Files.write(output,renderer.render("owner",document,assets,store));
        var hashes=new ProcessBuilder("ffmpeg","-v","error","-nostdin","-i",output.toString(),"-map","0:v","-vf","fps=2","-frames:v","2","-f","framemd5","pipe:1").redirectError(ProcessBuilder.Redirect.DISCARD).start();
        String frames=new String(hashes.getInputStream().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);assertTrue(hashes.waitFor(10,TimeUnit.SECONDS));assertEquals(0,hashes.exitValue());
        var values=frames.lines().filter(line->!line.startsWith("#")&&!line.isBlank()).map(line->line.substring(line.lastIndexOf(',')+1).strip()).toList();
        assertEquals(2,values.size());assertNotEquals(values.get(0),values.get(1),"motion footage must not become a repeated still frame");
        var audio=new ProcessBuilder("ffmpeg","-v","error","-nostdin","-i",output.toString(),"-t","0.2","-map","0:a","-ac","1","-ar","8000","-f","s16le","pipe:1").redirectError(ProcessBuilder.Redirect.DISCARD).start();
        byte[] samples=audio.getInputStream().readAllBytes();assertTrue(audio.waitFor(10,TimeUnit.SECONDS));assertEquals(0,audio.exitValue());
        long magnitude=0;for(int i=0;i+1<samples.length;i+=2)magnitude+=Math.abs((short)((samples[i]&255)|(samples[i+1]<<8)));
        assertTrue(samples.length>1600);assertTrue(magnitude/(samples.length/2)>200,"native sound must survive composition, not just a silent AAC track");
    }
    @Test void inspectionUsesPictureDurationWhenTheContainerHasALongerAudioTail()throws Exception{
        Path source=storage.resolve("long-audio-tail.mp4");
        var make=new ProcessBuilder("ffmpeg","-v","error","-nostdin","-y","-f","lavfi","-i","testsrc2=size=160x90:rate=30:duration=0.6","-f","lavfi","-i","sine=frequency=740:duration=1.2","-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac",source.toString()).redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD).start();
        assertTrue(make.waitFor(15,TimeUnit.SECONDS));assertEquals(0,make.exitValue());
        var info=renderer.inspect(source);assertTrue(info.hasAudio());assertTrue(info.hasVideo());assertEquals(.6,info.duration(),.04,"a long sound track must not create black or frozen picture at a scene's end");
    }
    private void makeAudio(Path audio)throws Exception {var process=new ProcessBuilder("ffmpeg","-v","error","-nostdin","-f","lavfi","-i","sine=frequency=440:duration=1","-y",audio.toString()).redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.DISCARD).start();assertTrue(process.waitFor(10,TimeUnit.SECONDS));assertEquals(0,process.exitValue());}
}
