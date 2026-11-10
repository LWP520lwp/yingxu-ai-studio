package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.core.Authentication;

class SkillPackageControllerTest {
    @Test void multipartImportUsesOnlyTheSessionOwnerAndPassesValidatedDeclarativeData() throws Exception {
        var skills = mock(SkillService.class); var users = mock(UserService.class); var redis = mock(RedisSupport.class); var auth = mock(Authentication.class);
        when(users.require(auth)).thenReturn(new UserService.User("owner", "User", null, "github"));
        when(skills.importPackage(eq("owner"), any())).thenReturn(Map.of("id", "private-test", "source", "imported"));
        var controller = new SkillController(skills, users, redis);
        var file = new MockMultipartFile("file", "skill.json", "application/json", SkillPackageParserTest.example().getBytes(StandardCharsets.UTF_8));
        assertEquals("private-test", controller.importPackage(auth, file, "video").get("id"));
        verify(redis).limit("owner", "skill-import", 12);
        verify(skills).importPackage(eq("owner"), argThat(parsed -> parsed.manifest().path("recipe").path("path").asString().equals("/api/jobs")));
    }

    @Test void invalidAndOversizedFilesNeverReachPersistence() throws Exception {
        var skills = mock(SkillService.class); var users = mock(UserService.class); var auth = mock(Authentication.class);
        when(users.require(auth)).thenReturn(new UserService.User("owner", "User", null, "github"));
        var controller = new SkillController(skills, users, mock(RedisSupport.class));
        var invalid = new MockMultipartFile("file", "code.js", "application/javascript", "alert(1)".getBytes(StandardCharsets.UTF_8));
        assertThrows(ApiException.class, () -> controller.importPackage(auth, invalid, "video"));
        var large = mock(org.springframework.web.multipart.MultipartFile.class); when(large.getSize()).thenReturn((long) SkillPackageParser.MAX_UPLOAD + 1);
        assertThrows(ApiException.class, () -> controller.importPackage(auth, large, "video"));
        verifyNoInteractions(skills); verify(large, never()).getInputStream();
    }
}
