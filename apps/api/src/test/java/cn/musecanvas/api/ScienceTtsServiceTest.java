package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import javax.sound.sampled.AudioSystem;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.env.MockEnvironment;

class ScienceTtsServiceTest {
    @TempDir Path temporary;

    private ScienceTtsService disabled(Path root) {
        return new ScienceTtsService(new MockEnvironment().withProperty("app.storage-root", root.toString()).withProperty("app.science-tts-enabled", "false"));
    }

    @Test void unavailableDeploymentsOfferNoFabricatedVoices() throws Exception {
        assertFalse(ScienceTtsService.supportsSapi("Linux"));
        assertFalse(ScienceTtsService.supportsSapi("Mac OS X"));
        assertTrue(ScienceTtsService.supportsSapi("Windows 11"));
        Path root = Files.createDirectory(temporary.resolve("assets"));
        var service = disabled(root);
        assertEquals(false, service.capabilities().get("ttsAvailable"));
        assertEquals(List.of(), service.capabilities().get("voices"));
        var failure = assertThrows(ApiException.class, () -> service.synthesize(ScienceTtsService.VOICE_ID, "月球反射太阳光。", root.resolve("speech.wav")));
        assertEquals("SCIENCE_TTS_UNAVAILABLE", failure.code);
        assertFalse(Files.exists(root.resolve("speech.wav")));
    }

    @Test void validatesTheConfiguredMandarinVoiceAndNeverSilentlySwitchesProviders() throws Exception {
        assertTrue(ScienceTtsService.hasMandarinVoice("Pty Language Age/Gender VoiceName File Other Languages\n 5 cmn --/M Chinese_(Mandarin) sit/cmn (zh 5)\n"));
        assertFalse(ScienceTtsService.hasMandarinVoice("Pty Language Age/Gender VoiceName File\n 5 en-us --/M English gmw/en-US\n"));
        assertFalse(ScienceTtsService.hasMandarinVoice("cmn available, but not a language inventory"));
        Path root = Files.createDirectory(temporary.resolve("invalid-provider"));
        var invalid = new ScienceTtsService(new MockEnvironment().withProperty("app.storage-root", root.toString()).withProperty("SCIENCE_TTS_PROVIDER", "remote-auto-download"));
        assertEquals(false, invalid.capabilities().get("ttsAvailable"));
        assertEquals(List.of(), invalid.capabilities().get("voices"));
        var unavailable = new ScienceTtsService(new MockEnvironment().withProperty("app.storage-root", root.toString()).withProperty("SCIENCE_TTS_PROVIDER", "espeak").withProperty("SCIENCE_ESPEAK_BIN", root.resolve("not-installed").toString()));
        assertEquals(false, unavailable.capabilities().get("ttsAvailable"));
        assertEquals("SCIENCE_TTS_UNAVAILABLE", assertThrows(ApiException.class, () -> unavailable.synthesize(ScienceTtsService.ESPEAK_VOICE_ID, "中文旁白", root.resolve("speech.wav"))).code);
        assertFalse(Files.exists(root.resolve("speech.wav")));
    }

    @Test @EnabledIfEnvironmentVariable(named="SCIENCE_TTS_ESPEAK_SMOKE", matches="true")
    void realEspeakProducesOfflineChinesePcmAndKeepsTextOutOfTheCommand() throws Exception {
        Path root = Files.createDirectory(temporary.resolve("espeak-assets"));
        var env = new MockEnvironment().withProperty("app.storage-root", root.toString()).withProperty("SCIENCE_TTS_PROVIDER", "espeak");
        if (System.getenv("SCIENCE_ESPEAK_BIN") != null) env.withProperty("SCIENCE_ESPEAK_BIN", System.getenv("SCIENCE_ESPEAK_BIN"));
        var service = new ScienceTtsService(env);
        assertTrue(service.available(), "This integration run requires an installed eSpeak NG Mandarin voice");
        assertEquals(List.of(Map.of("id", ScienceTtsService.ESPEAK_VOICE_ID, "name", "中文 · 本地基础音色")), service.capabilities().get("voices"));
        assertEquals("INVALID_REQUEST", assertThrows(ApiException.class, () -> service.synthesize(ScienceTtsService.VOICE_ID, "中文旁白", root.resolve("wrong-voice.wav"))).code);
        Path marker = root.resolve("must-not-execute");
        Path wave = service.synthesize(ScienceTtsService.ESPEAK_VOICE_ID, "月球反射太阳光。$(touch " + marker + ") ; --voices=en", root.resolve("speech.wav"));
        assertFalse(Files.exists(marker));
        try (var audio = AudioSystem.getAudioInputStream(wave.toFile())) {
            assertTrue(audio.getFormat().getSampleRate() >= 16000);
            assertEquals(16, audio.getFormat().getSampleSizeInBits());
            assertEquals(1, audio.getFormat().getChannels());
            assertTrue(audio.getFrameLength() > 1000);
        }
        try (var children = Files.list(root)) { assertEquals(List.of("speech.wav"), children.map(path -> path.getFileName().toString()).sorted().toList()); }
    }

    @Test void rejectsTraversalMissingParentsAndExistingFilesBeforeStartingAnyProcess() throws Exception {
        Path root = Files.createDirectory(temporary.resolve("assets"));
        var service = disabled(root);
        Path existing = root.resolve("existing.wav");
        Files.writeString(existing, "keep", StandardCharsets.UTF_8);
        for (Path output : List.of(root.resolve("../escape.wav"), root.resolve("missing/speech.wav"), existing, root.resolve("speech.ps1"))) {
            assertEquals("INVALID_REQUEST", assertThrows(ApiException.class, () -> service.synthesize(ScienceTtsService.VOICE_ID, "有效旁白", output)).code);
        }
        assertEquals("keep", Files.readString(existing));
        assertFalse(Files.exists(temporary.resolve("escape.wav")));
    }

    @Test void rejectsUnknownVoicesLongNarrationAndControlCharacters() throws Exception {
        Path root = Files.createDirectory(temporary.resolve("assets"));
        var service = disabled(root);
        assertEquals("INVALID_REQUEST", assertThrows(ApiException.class, () -> service.synthesize("powershell-command", "旁白", root.resolve("one.wav"))).code);
        for (String text : List.of(" ", "\u0000旁白", "科".repeat(401))) {
            assertEquals("INVALID_REQUEST", assertThrows(ApiException.class, () -> service.synthesize(ScienceTtsService.VOICE_ID, text, root.resolve("one.wav"))).code);
        }
        try (var children = Files.list(root)) { assertEquals(0, children.count()); }
    }

    @Test void rejectsSymbolicLinkParents() throws Exception {
        Path root = Files.createDirectory(temporary.resolve("assets"));
        Path outside = Files.createDirectory(temporary.resolve("outside"));
        Path link = root.resolve("linked");
        try { Files.createSymbolicLink(link, outside); }
        catch (IOException | UnsupportedOperationException | SecurityException unavailable) { Assumptions.assumeTrue(false, "Symbolic links are unavailable in this test environment"); return; }
        assertEquals("INVALID_REQUEST", assertThrows(ApiException.class, () -> disabled(root).synthesize(ScienceTtsService.VOICE_ID, "旁白", link.resolve("speech.wav"))).code);
        assertFalse(Files.exists(outside.resolve("speech.wav")));
    }

    @Test void terminatesSlowChildrenWithinTheProcessDeadline() throws Exception {
        Path work = Files.createDirectory(temporary.resolve("timeout"));
        assertTimeoutPreemptively(Duration.ofSeconds(4), () -> {
            IOException error = assertThrows(IOException.class, () -> ScienceTtsService.runBounded(childCommand("sleep"), work, null, 200));
            assertTrue(error.getMessage().contains("timed out"));
        });
    }

    @Test void boundsProcessLogsAndRejectsNonWaveOutput() throws Exception {
        Path work = Files.createDirectory(temporary.resolve("output-limit"));
        IOException logFailure = assertThrows(IOException.class, () -> ScienceTtsService.runBounded(childCommand("large-log"), work, null, 5_000));
        assertTrue(logFailure.getMessage().contains("limit"));
        try (var children = Files.list(work)) { assertEquals(0, children.count(), "Process diagnostics must remain bounded in memory"); }
        Path largeWaveWork = Files.createDirectory(temporary.resolve("wave-limit"));
        IOException waveFailure = assertThrows(IOException.class, () -> ScienceTtsService.runBounded(childCommand("large-wave"), largeWaveWork, largeWaveWork.resolve("speech.wav"), 5_000));
        assertTrue(waveFailure.getMessage().contains("limit"));
        Path invalid = temporary.resolve("invalid.wav");
        Files.writeString(invalid, "x".repeat(100));
        assertThrows(IOException.class, () -> ScienceTtsService.validateWave(invalid));
        try (var oversized = new java.io.RandomAccessFile(temporary.resolve("oversized.wav").toFile(), "rw")) {
            oversized.setLength(ScienceTtsService.MAX_WAV_BYTES + 1);
        }
        assertThrows(IOException.class, () -> ScienceTtsService.validateWave(temporary.resolve("oversized.wav")));
    }

    @Test void realHuihuiProducesChinesePcmWaveAndTreatsNarrationAsPlainText() throws Exception {
        Assumptions.assumeTrue(ScienceTtsService.supportsSapi(System.getProperty("os.name", "")), "Windows SAPI integration test");
        Path root = Files.createDirectory(temporary.resolve("assets"));
        var service = new ScienceTtsService(new MockEnvironment().withProperty("app.storage-root", root.toString()));
        boolean available = service.available();
        if (Boolean.getBoolean("science.tts.require-available")) assertTrue(available, "This integration run requires the verified local Huihui voice");
        Assumptions.assumeTrue(available, "Microsoft Huihui Desktop is not installed");
        assertEquals(List.of(java.util.Map.of("id", ScienceTtsService.VOICE_ID, "name", "慧慧 · 离线中文")), service.capabilities().get("voices"));
        Path marker = temporary.resolve("must-not-execute.txt");
        String text = "月球反射太阳光。$(Set-Content -LiteralPath '" + marker.toString().replace("'", "''") + "' -Value pwned)";
        Path wave = service.synthesize(ScienceTtsService.VOICE_ID, text, root.resolve("sentence-one.wav"));
        assertFalse(Files.exists(marker), "Narration must never be evaluated as shell code");
        assertTrue(Files.size(wave) > 44);
        try (var audio = AudioSystem.getAudioInputStream(wave.toFile())) {
            assertEquals(22050f, audio.getFormat().getSampleRate());
            assertEquals(16, audio.getFormat().getSampleSizeInBits());
            assertEquals(1, audio.getFormat().getChannels());
            assertTrue(audio.getFrameLength() > 1000);
        }
        try (var children = Files.list(root)) {
            assertEquals(List.of("sentence-one.wav"), children.map(path -> path.getFileName().toString()).sorted().toList(), "Private scripts and narration files must be cleaned");
        }
    }

    private static List<String> childCommand(String mode) {
        String executable = ScienceTtsService.supportsSapi(System.getProperty("os.name", "")) ? "java.exe" : "java";
        return List.of(Path.of(System.getProperty("java.home"), "bin", executable).toString(), "-cp", System.getProperty("java.class.path"), Child.class.getName(), mode);
    }

    public static class Child {
        public static void main(String[] args) throws Exception {
            if (args[0].equals("sleep")) Thread.sleep(10_000);
            else if (args[0].equals("large-wave")) {
                try (var wave = new java.io.RandomAccessFile("speech.wav", "rw")) { wave.setLength(ScienceTtsService.MAX_WAV_BYTES + 1); }
                Thread.sleep(10_000);
            } else { System.out.print("x".repeat(32 * 1024)); System.out.flush(); }
        }
    }
}
