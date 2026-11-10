package cn.musecanvas.api;

import java.io.IOException;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.HashSet;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/** Offline, bounded Chinese narration. The caller probes each WAV for subtitle timing. */
@Component
public class ScienceTtsService {
    public static final String VOICE_ID = "sapi-huihui-zh-cn";
    public static final String ESPEAK_VOICE_ID = "espeak-cmn-local";
    static final long MAX_WAV_BYTES = 8L * 1024 * 1024;
    private static final long MAX_LOG_BYTES = 16 * 1024;
    private final Path storageRoot;
    private final String powershell;
    private final String espeak;
    private final String provider;
    private final boolean enabled;
    private volatile long checkedAt;
    private volatile boolean voiceAvailable;

    public ScienceTtsService(Environment env) {
        storageRoot = Path.of(env.getProperty("app.storage-root", "./data/assets")).toAbsolutePath().normalize();
        String systemRoot = System.getenv("SystemRoot");
        String defaultShell = systemRoot == null ? "powershell.exe" : Path.of(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe").toString();
        powershell = env.getProperty("app.science-tts-powershell-bin", defaultShell);
        espeak = env.getProperty("app.science-espeak-bin", env.getProperty("SCIENCE_ESPEAK_BIN", "espeak-ng"));
        String configured = env.getProperty("app.science-tts-provider", env.getProperty("SCIENCE_TTS_PROVIDER", "auto")).strip().toLowerCase(Locale.ROOT);
        provider = "auto".equals(configured) ? (supportsSapi(System.getProperty("os.name", "")) ? "sapi" : "espeak") : configured;
        enabled = env.getProperty("app.science-tts-enabled", Boolean.class, true)
            && ("espeak".equals(provider) || ("sapi".equals(provider) && supportsSapi(System.getProperty("os.name", ""))));
    }

    static boolean supportsSapi(String osName) { return osName.toLowerCase(Locale.ROOT).startsWith("windows"); }

    public Map<String,Object> capabilities() {
        boolean ready = available();
        return Map.of("ttsAvailable", ready,
            "voices", ready ? List.of(Map.of("id", voiceId(), "name", "espeak".equals(provider) ? "中文 · 本地基础音色" : "慧慧 · 离线中文")) : List.of(),
            "message", ready ? ("espeak".equals(provider) ? "本地基础中文配音，音色偏机械；逐句测量时长并对齐字幕" : "Microsoft Huihui 离线中文配音，逐句生成 WAV 并按实测时长对齐字幕") : unavailableMessage());
    }

    private String voiceId() { return "espeak".equals(provider) ? ESPEAK_VOICE_ID : VOICE_ID; }
    private String unavailableMessage() {
        return switch (provider) {
            case "sapi" -> "当前部署无法使用慧慧离线配音；需要 Windows 与已安装的 Microsoft Huihui Desktop 语音";
            case "espeak" -> "当前部署未检测到可用的 eSpeak NG 中文音色；请安装 eSpeak NG 并配置 SCIENCE_ESPEAK_BIN";
            default -> "SCIENCE_TTS_PROVIDER 必须为 auto、sapi 或 espeak";
        };
    }

    static boolean hasMandarinVoice(String listing) {
        return listing != null && java.util.regex.Pattern.compile("(?m)^\\s*\\d+\\s+(?:cmn|zh-cmn|zh)\\s+").matcher(listing).find();
    }

    public synchronized boolean available() {
        if (!enabled) return false;
        if (checkedAt != 0 && System.nanoTime() - checkedAt < Duration.ofSeconds(60).toNanos()) return voiceAvailable;
        Path scratch = null;
        try {
            Files.createDirectories(storageRoot);
            scratch = Files.createTempDirectory(storageRoot.toRealPath(), ".science-tts-probe-");
            if ("espeak".equals(provider)) {
                byte[] result = runBounded(List.of(espeak, "--voices=cmn"), scratch, null, 4_000);
                if (!hasMandarinVoice(new String(result, StandardCharsets.UTF_8))) throw new IOException("Mandarin voice is unavailable");
                Files.writeString(scratch.resolve("input.txt"), "中文配音测试。", StandardCharsets.UTF_8);
                Path wave = scratch.resolve("speech.wav");
                runBounded(espeakCommand(scratch, wave), scratch, wave, 8_000);
                validateWave(wave);
                voiceAvailable = true;
            } else {
                Path script = installScript(scratch);
                byte[] result = runBounded(command(script, scratch, "voices"), scratch, null, 8_000);
                voiceAvailable = Json.read(new String(result, StandardCharsets.UTF_8)).path("available").asBoolean(false);
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt(); voiceAvailable = false;
        } catch (Exception unavailable) { voiceAvailable = false; }
        finally { if (scratch != null) clean(scratch); checkedAt = System.nanoTime(); }
        return voiceAvailable;
    }

    /** The existing parent must be inside storage-root; existing targets are never overwritten. */
    public Path synthesize(String voiceId, String text, Path outputPath) {
        if (!VOICE_ID.equals(voiceId) && !ESPEAK_VOICE_ID.equals(voiceId)) throw ApiException.invalid("请选择可用的中文配音音色");
        if (text == null || text.isBlank() || text.codePointCount(0, text.length()) > 400 ||
                text.codePoints().anyMatch(code -> (Character.isISOControl(code) && code != '\n' && code != '\r' && code != '\t') || code == 0xFFFE || code == 0xFFFF))
            throw ApiException.invalid("单句配音文字须为 1–400 字，不能包含控制字符");
        Path target = validatedTarget(outputPath);
        if (!available()) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "SCIENCE_TTS_UNAVAILABLE", unavailableMessage());
        if (!voiceId().equals(voiceId)) throw ApiException.invalid("请选择当前部署提供的中文配音音色");
        Path scratch = null;
        try {
            Path parent = target.getParent().toRealPath();
            scratch = Files.createTempDirectory(parent, ".science-tts-");
            Files.writeString(scratch.resolve("input.txt"), text, StandardCharsets.UTF_8);
            Path wave = scratch.resolve("speech.wav");
            List<String> arguments = "espeak".equals(provider) ? espeakCommand(scratch, wave) : command(installScript(scratch), scratch, "synthesize");
            runBounded(arguments, scratch, wave, 60_000);
            validateWave(wave);
            // Recheck the caller's parent after synthesis before publishing the private result.
            if (!target.getParent().toRealPath().equals(parent) || Files.exists(target, LinkOption.NOFOLLOW_LINKS))
                throw ApiException.invalid("配音输出路径已变化，请重试");
            Files.move(wave, target);
            return target;
        } catch (ApiException failure) { throw failure; }
        catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "SCIENCE_TTS_INTERRUPTED", "配音任务已中断，请重新生成");
        } catch (Exception failure) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "SCIENCE_TTS_FAILED", "离线中文配音失败、超时或输出异常，请检查语音组件后重试");
        } finally { if (scratch != null) clean(scratch); }
    }

    private Path validatedTarget(Path outputPath) {
        try {
            if (outputPath == null) throw ApiException.invalid("配音输出路径无效");
            Path target = outputPath.toAbsolutePath().normalize();
            Path parent = target.getParent();
            if (!target.startsWith(storageRoot) || parent == null || !Files.isDirectory(parent) ||
                    !target.getFileName().toString().matches("[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}\\.wav") ||
                    Files.exists(target, LinkOption.NOFOLLOW_LINKS)) throw ApiException.invalid("配音输出路径无效或文件已存在");
            Path realRoot = storageRoot.toRealPath();
            Path realParent = parent.toRealPath();
            if (!realParent.startsWith(realRoot)) throw ApiException.invalid("配音输出路径超出项目存储目录");
            for (Path entry = parent; entry != null && entry.startsWith(storageRoot); entry = entry.getParent())
                if (Files.isSymbolicLink(entry)) throw ApiException.invalid("配音输出路径不能使用符号链接");
            return target;
        } catch (ApiException failure) { throw failure; }
        catch (IOException | RuntimeException failure) { throw ApiException.invalid("配音输出路径无效"); }
    }

    private List<String> command(Path script, Path scratch, String mode) {
        // Every argument is a separate ProcessBuilder value; narration never enters shell code.
        return List.of(powershell, "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script.toString(),
            "-Mode", mode, "-WorkDirectory", scratch.toString(), "-VoiceId", VOICE_ID);
    }

    private List<String> espeakCommand(Path scratch, Path wave) {
        // Only fixed arguments and owned paths enter the process. Narration is UTF-8 file data.
        return List.of(espeak, "-v", "cmn", "-b", "1", "-s", "165", "-f", scratch.resolve("input.txt").toString(), "-w", wave.toString());
    }

    private static Path installScript(Path scratch) throws IOException {
        Path script = scratch.resolve("sapi-huihui.ps1");
        try (var resource = ScienceTtsService.class.getResourceAsStream("/tts/sapi-huihui.ps1")) {
            if (resource == null) throw new IOException("Missing bundled TTS script");
            Files.copy(resource, script);
        }
        return script;
    }

    /** Poll file limits while the child runs, then kill its entire process tree on every exit path. */
    static byte[] runBounded(List<String> command, Path directory, Path wave, long timeoutMillis) throws IOException, InterruptedException {
        Process process = new ProcessBuilder(command).directory(directory.toFile()).redirectError(ProcessBuilder.Redirect.DISCARD).start();
        // A pipe avoids inheritable Windows file handles keeping private scratch files locked.
        var output = new FutureTask<byte[]>(() -> {
            try (var input = process.getInputStream(); var bytes = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[2048];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if ((long) bytes.size() + count > MAX_LOG_BYTES) throw new IOException("TTS output exceeded its limit");
                    bytes.write(buffer, 0, count);
                }
                return bytes.toByteArray();
            }
        });
        Thread.ofVirtual().name("science-tts-output").start(output);
        var children = new HashSet<ProcessHandle>();
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMillis);
        try {
            while (true) {
                process.descendants().forEach(children::add);
                if (output.isDone()) readOutput(output);
                checkWaveLimit(wave);
                long remaining = deadline - System.nanoTime();
                if (remaining <= 0) throw new IOException("TTS process timed out");
                if (process.waitFor(Math.min(100, Math.max(1, TimeUnit.NANOSECONDS.toMillis(remaining))), TimeUnit.MILLISECONDS)) break;
            }
            byte[] result = readOutput(output);
            checkWaveLimit(wave);
            if (process.exitValue() != 0) throw new IOException("TTS process failed");
            return result;
        } finally {
            process.descendants().forEach(children::add);
            children.forEach(child -> { if (child.isAlive()) child.destroyForcibly(); });
            try {
                if (process.isAlive()) process.destroyForcibly();
                process.waitFor(2, TimeUnit.SECONDS);
            } finally {
                try { process.getOutputStream().close(); } catch (IOException ignored) { }
                try { process.getInputStream().close(); } catch (IOException ignored) { }
                try { process.getErrorStream().close(); } catch (IOException ignored) { }
                output.cancel(true);
            }
        }
    }

    private static byte[] readOutput(FutureTask<byte[]> output) throws IOException, InterruptedException {
        try { return output.get(1, TimeUnit.SECONDS); }
        catch (ExecutionException failure) {
            if (failure.getCause() instanceof IOException cause) throw cause;
            throw new IOException("TTS process output could not be read");
        } catch (TimeoutException failure) { throw new IOException("TTS process output did not close"); }
    }

    private static void checkWaveLimit(Path wave) throws IOException {
        if (wave != null && Files.exists(wave) && Files.size(wave) > MAX_WAV_BYTES)
            throw new IOException("TTS output exceeded its limit");
    }

    static void validateWave(Path wave) throws IOException {
        if (!Files.isRegularFile(wave, LinkOption.NOFOLLOW_LINKS) || Files.size(wave) <= 44 || Files.size(wave) > MAX_WAV_BYTES)
            throw new IOException("TTS did not produce a bounded WAV");
        byte[] header;
        try (var input = Files.newInputStream(wave)) { header = input.readNBytes(12); }
        if (header.length != 12 || header[0] != 'R' || header[1] != 'I' || header[2] != 'F' || header[3] != 'F' ||
                header[8] != 'W' || header[9] != 'A' || header[10] != 'V' || header[11] != 'E')
            throw new IOException("TTS output is not WAV");
    }

    private static void clean(Path directory) {
        try (var paths = Files.walk(directory)) {
            for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) try { Files.deleteIfExists(path); } catch (IOException ignored) { }
        } catch (IOException ignored) { }
    }
}
