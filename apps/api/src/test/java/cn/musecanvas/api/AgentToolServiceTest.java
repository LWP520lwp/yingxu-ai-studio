package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.List;
import org.junit.jupiter.api.Test;

class AgentToolServiceTest {
    @Test void definitionsExposeOnlyBoundedFunctionTools() {
        var service = new AgentToolService(mock(WorkbenchStore.class), mock(RagService.class), mock(JobService.class));
        var names = service.definitions().stream().map(row -> ((java.util.Map<?, ?>) row.get("function")).get("name")).toList();
        assertEquals(List.of("search_knowledge", "list_project_assets", "get_generation_job", "create_generation_job"), names);
        assertTrue(service.definitions().stream().allMatch(row -> "function".equals(row.get("type"))));
    }
    @Test void unknownToolAndMalformedArgumentsAreRejectedBeforeDependencies() {
        var service = new AgentToolService(mock(WorkbenchStore.class), mock(RagService.class), mock(JobService.class));
        assertThrows(ApiException.class, () -> service.call("owner", new AgentToolService.Call("shell", Json.read("{}"), "x")));
        assertThrows(ApiException.class, () -> service.call("owner", new AgentToolService.Call("search_knowledge", Json.read("[]"), "x")));
    }
}
