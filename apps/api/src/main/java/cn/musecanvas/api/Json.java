package cn.musecanvas.api;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

public final class Json {
    public static final JsonMapper MAPPER = JsonMapper.builder().build();
    private Json() {}
    public static String write(Object value) { return MAPPER.writeValueAsString(value); }
    public static JsonNode read(String value) { return MAPPER.readTree(value); }
    public static String hash(String value) { return hash(value.getBytes(StandardCharsets.UTF_8)); }
    public static String hash(byte[] value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value)); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
}
