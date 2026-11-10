package cn.musecanvas.api;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;

public class ApiException extends RuntimeException {
    public final HttpStatus status;
    public final String code;
    public final Map<String, Object> details;
    public ApiException(HttpStatus status, String code, String message) { this(status, code, message, Map.of()); }
    public ApiException(HttpStatus status, String code, String message, Map<String,Object> details) {
        super(message); this.status = status; this.code = code; this.details = details;
    }
    public Map<String,Object> body() {
        var body = new LinkedHashMap<String,Object>(); body.put("code", code); body.put("message", getMessage()); body.putAll(details); return body;
    }
    public static ApiException notFound() { return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "内容不存在或无权访问"); }
    public static ApiException invalid(String message) { return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", message); }
}
