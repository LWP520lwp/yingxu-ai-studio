package cn.musecanvas.api;

import java.util.Map;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

/** OpenAI-style function definitions and a guarded server executor for the canvas Agent. */
@RestController
@RequestMapping("/api/agent")
public class AgentToolController {
    public record ToolCall(String name, tools.jackson.databind.JsonNode arguments, String requestId) {}
    private final AgentToolService tools; private final UserService users; private final RedisSupport redis;
    public AgentToolController(AgentToolService tools, UserService users, RedisSupport redis) { this.tools = tools; this.users = users; this.redis = redis; }
    @GetMapping("/tools") public Map<String, Object> definitions(Authentication auth) { users.require(auth); return Map.of("tools", tools.definitions(), "protocol", "function-calling-v1"); }
    @PostMapping("/tools/call") public Map<String, Object> call(Authentication auth, @RequestBody ToolCall input) { String owner = users.require(auth).id(); redis.limit(owner, "agent-tool-call", 60); if (input == null) throw ApiException.invalid("工具调用不能为空"); return tools.call(owner, new AgentToolService.Call(input.name(), input.arguments(), input.requestId())); }
}
