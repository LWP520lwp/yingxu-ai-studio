package cn.musecanvas.api;

import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
public class ApiErrorHandler {
    private static final Logger log=LoggerFactory.getLogger(ApiErrorHandler.class);
    @ExceptionHandler(ApiException.class) public ResponseEntity<Map<String,Object>> api(ApiException e){
        var response=ResponseEntity.status(e.status);
        if(e.details.get("retryAfterSeconds") instanceof Number seconds && seconds.longValue()>0)
            response.header("Retry-After",Long.toString(seconds.longValue()));
        return response.body(e.body());
    }
    @ExceptionHandler(HttpMessageNotReadableException.class) public ResponseEntity<Map<String,String>> invalid(Exception e){return ResponseEntity.badRequest().body(Map.of("code","INVALID_JSON","message","请求 JSON 无效或字段类型不匹配"));}
    @ExceptionHandler(MaxUploadSizeExceededException.class) public ResponseEntity<Map<String,String>> upload(Exception e){return ResponseEntity.status(413).body(Map.of("code","UPLOAD_TOO_LARGE","message","上传文件超过 100MB"));}
    @ExceptionHandler({NoHandlerFoundException.class,NoResourceFoundException.class}) public ResponseEntity<Map<String,String>> notFound(Exception e){return ResponseEntity.status(404).body(Map.of("code","NOT_FOUND","message","请求的资源不存在"));}
    @ExceptionHandler(DataAccessException.class) public ResponseEntity<Map<String,String>> database(DataAccessException e){log.warn("Database operation failed: {}",e.getClass().getSimpleName());return ResponseEntity.status(503).body(Map.of("code","DATABASE_UNAVAILABLE","message","数据库暂不可用，请稍后重试"));}
    @ExceptionHandler(Exception.class) public ResponseEntity<Map<String,String>> unexpected(Exception e){log.error("API failure",e);return ResponseEntity.internalServerError().body(Map.of("code","INTERNAL_ERROR","message","操作失败，请稍后重试"));}
}
