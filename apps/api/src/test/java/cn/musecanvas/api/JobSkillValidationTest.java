package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

class JobSkillValidationTest {
    @Test void rejectsForeignUninstalledOrStaleSkillBeforeCallingAnyGenerationProvider() {
        var skillService = mock(SkillService.class); var provider = mock(MuseProvider.class);
        var pool = mock(NativePoolService.class); var channels = mock(ChannelService.class);
        var jobs = new JobService(mock(WorkbenchStore.class), mock(AppSettings.class), mock(JdbcTemplate.class), mock(TransactionTemplate.class), provider, pool, channels, skillService);
        var request = new JobService.Request("project", "node", "video", "创作文字与导入方法", "muse-video", 1280, 720, 8, List.of(), "private-test", "1.0.0");
        doThrow(ApiException.notFound()).when(skillService).validateJob(eq("other-user"), any());
        assertThrows(ApiException.class, () -> jobs.submit("other-user", "skill-validation-test", request));
        verify(skillService).validateJob(eq("other-user"), argThat(value -> value.skillId().equals("private-test") && value.skillVersion().equals("1.0.0")));
        verifyNoInteractions(provider, pool, channels);
    }
}
