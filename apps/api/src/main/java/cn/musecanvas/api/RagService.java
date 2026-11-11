package cn.musecanvas.api;

import java.net.URI;
import java.time.Duration;
import java.util.*;
import java.util.regex.Pattern;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;

/**
 * Project scoped retrieval augmented generation store.
 *
 * Content is split into bounded chunks and kept in MySQL. Retrieval deliberately
 * remains deterministic and citation first: MySQL full text is used when it is
 * available, then a bounded Java scorer handles Chinese text (which is not
 * tokenized consistently by every MySQL installation). Redis only caches the
 * result; it is never the source of truth.
 */
@Service
public class RagService {
    private static final int MAX_DOCUMENTS = 200;
    private static final int MAX_CHUNKS_PER_DOCUMENT = 240;
    private static final int CHUNK_SIZE = 900;
    private static final int CHUNK_OVERLAP = 120;
    private static final Pattern LATIN_TOKEN = Pattern.compile("[\\p{L}\\p{N}]{2,}");
    private static final Set<String> STOP_WORDS = Set.of("的", "了", "和", "是", "在", "与", "及", "对", "将", "中", "也", "有", "为", "the", "and", "for", "with", "from");

    public record Input(String id, String title, String sourceUrl, String content, JsonNode metadata) {}
    private record Candidate(String id, String documentId, String title, String sourceUrl, String content,
                             int chunkIndex, String metadata, double score) {}

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final WorkbenchStore store;
    private final StringRedisTemplate redis;

    public RagService(JdbcTemplate jdbc, TransactionTemplate tx, WorkbenchStore store, StringRedisTemplate redis) {
        this.jdbc = jdbc;
        this.tx = tx;
        this.store = store;
        this.redis = redis;
    }

    public List<Map<String, Object>> documents(String owner, String project) {
        store.project(owner, project);
        return jdbc.query("SELECT id,title,source_url,content_hash,metadata,created_at,updated_at FROM rag_document WHERE owner_id=? AND project_id=? ORDER BY updated_at DESC,id DESC LIMIT ?",
            (rs, n) -> {
                var row = new LinkedHashMap<String, Object>();
                row.put("id", rs.getString("id")); row.put("title", rs.getString("title"));
                row.put("sourceUrl", rs.getString("source_url")); row.put("contentHash", rs.getString("content_hash"));
                row.put("metadata", Json.read(rs.getString("metadata"))); row.put("createdAt", WorkbenchStore.iso(rs, "created_at"));
                row.put("updatedAt", WorkbenchStore.iso(rs, "updated_at"));
                row.put("chunkCount", jdbc.queryForObject("SELECT COUNT(*) FROM rag_chunk WHERE document_id=?", Integer.class, row.get("id")));
                return row;
            }, owner, project, MAX_DOCUMENTS);
    }

    public Map<String, Object> upsert(String owner, String project, Input input) {
        store.project(owner, project);
        if (input == null) throw ApiException.invalid("知识文档不能为空");
        String title = clean(input.title(), 255, "文档标题不能为空", false);
        String content = clean(input.content(), 200_000, "知识文档内容不能为空", false);
        String sourceUrl = normalizeUrl(input.sourceUrl());
        JsonNode metadata = input.metadata() == null || input.metadata().isNull() ? Json.read("{}") : input.metadata();
        if (!metadata.isObject() || Json.write(metadata).length() > 8_192) throw ApiException.invalid("知识文档 metadata 必须是 8KB 内的 JSON 对象");
        String hash = Json.hash(title + "\n" + sourceUrl + "\n" + content);
        List<String> chunks = chunks(content);
        return tx.execute(status -> {
            jdbc.queryForObject("SELECT id FROM app_user WHERE id=? FOR UPDATE", String.class, owner);
            String id = input.id() == null || input.id().isBlank() ? null : safeId(input.id(), "文档标识");
            if (id != null) {
                var exists = jdbc.query("SELECT id FROM rag_document WHERE id=? AND owner_id=? AND project_id=? FOR UPDATE", (rs, n) -> rs.getString(1), id, owner, project);
                if (exists.isEmpty()) throw ApiException.notFound();
                jdbc.update("UPDATE rag_document SET title=?,source_url=?,content_hash=?,metadata=? WHERE id=? AND owner_id=? AND project_id=?", title, nullIfBlank(sourceUrl), hash, Json.write(metadata), id, owner, project);
                jdbc.update("DELETE FROM rag_chunk WHERE document_id=?", id);
            } else {
                var duplicate = jdbc.query("SELECT id FROM rag_document WHERE owner_id=? AND project_id=? AND content_hash=?", (rs, n) -> rs.getString(1), owner, project, hash);
                if (!duplicate.isEmpty()) { bumpVersion(owner, project); return document(owner, project, duplicate.getFirst()); }
                id = UUID.randomUUID().toString();
                jdbc.update("INSERT INTO rag_document(id,owner_id,project_id,title,source_url,content_hash,metadata) VALUES(?,?,?,?,?,?,?)", id, owner, project, title, nullIfBlank(sourceUrl), hash, Json.write(metadata));
            }
            if (chunks.isEmpty() || chunks.size() > MAX_CHUNKS_PER_DOCUMENT) throw ApiException.invalid("知识文档分块数量超出限制，请缩短内容");
            for (int i = 0; i < chunks.size(); i++) {
                String chunk = chunks.get(i);
                jdbc.update("INSERT INTO rag_chunk(id,document_id,owner_id,project_id,chunk_index,content,content_hash,token_count) VALUES(?,?,?,?,?,?,?,?)",
                    UUID.randomUUID().toString(), id, owner, project, i, chunk, Json.hash(chunk), chunk.codePointCount(0, chunk.length()));
            }
            bumpVersion(owner, project);
            return document(owner, project, id);
        });
    }

    public Map<String, Object> delete(String owner, String project, String id) {
        store.project(owner, project); String documentId = safeId(id, "文档标识");
        int changed = jdbc.update("DELETE FROM rag_document WHERE id=? AND owner_id=? AND project_id=?", documentId, owner, project);
        if (changed == 0) throw ApiException.notFound(); bumpVersion(owner, project); return Map.of("ok", true, "id", documentId);
    }

    public Map<String, Object> search(String owner, String project, String query, Integer requestedTopK) {
        store.project(owner, project);
        String cleanQuery = clean(query, 500, "检索问题不能为空", false);
        int topK = requestedTopK == null ? 6 : requestedTopK;
        if (topK < 1 || topK > 20) throw ApiException.invalid("topK 必须在1到20之间");
        String version = cacheVersion(owner, project);
        String cacheKey = "workbench:rag:" + owner + ":" + project + ":" + version + ":" + Json.hash(cleanQuery.toLowerCase(Locale.ROOT) + ":" + topK);
        try {
            String cached = redis.opsForValue().get(cacheKey);
            if (cached != null) { var value = Json.read(cached); var output = new LinkedHashMap<String, Object>(); output.put("query", cleanQuery); output.put("topK", topK); output.put("cached", true); output.put("results", value); return output; }
        } catch (RuntimeException ignored) { /* RAG remains available while Redis restarts. */ }

        List<Candidate> candidates = retrieve(owner, project, cleanQuery, topK);
        var results = candidates.stream().map(this::result).toList();
        try { redis.opsForValue().set(cacheKey, Json.write(results), Duration.ofSeconds(45)); } catch (RuntimeException ignored) {}
        var output = new LinkedHashMap<String, Object>(); output.put("query", cleanQuery); output.put("topK", topK); output.put("cached", false); output.put("results", results); return output;
    }

    /** Returns citation-bearing chunks for model prompts without exposing internal columns. */
    public List<Map<String, Object>> context(String owner, String project, String query, int topK) {
        Object results = search(owner, project, query, topK).get("results");
        return results instanceof List<?> list ? list.stream().filter(Map.class::isInstance).map(row -> (Map<String, Object>) row).toList() : List.of();
    }

    private List<Candidate> retrieve(String owner, String project, String query, int topK) {
        var rows = new ArrayList<Candidate>();
        // FULLTEXT is fast for Latin and configured ngram installations. A LIKE
        // predicate keeps the query useful on default MySQL Chinese builds.
        try {
            rows.addAll(jdbc.query("SELECT c.id,c.document_id,d.title,d.source_url,c.content,c.chunk_index,d.metadata,MATCH(c.content) AGAINST(? IN NATURAL LANGUAGE MODE) AS relevance FROM rag_chunk c JOIN rag_document d ON d.id=c.document_id WHERE c.owner_id=? AND c.project_id=? AND (MATCH(c.content) AGAINST(? IN NATURAL LANGUAGE MODE)>0 OR c.content LIKE ?) ORDER BY relevance DESC,c.chunk_index LIMIT 400",
                (rs, n) -> new Candidate(rs.getString("id"), rs.getString("document_id"), rs.getString("title"), rs.getString("source_url"), rs.getString("content"), rs.getInt("chunk_index"), rs.getString("metadata"), rs.getDouble("relevance")), query, owner, project, query, "%" + escapeLike(query) + "%"));
        } catch (DataAccessException ignored) { /* Fall through to the portable bounded scan. */ }
        if (rows.isEmpty()) {
            rows.addAll(jdbc.query("SELECT c.id,c.document_id,d.title,d.source_url,c.content,c.chunk_index,d.metadata FROM rag_chunk c JOIN rag_document d ON d.id=c.document_id WHERE c.owner_id=? AND c.project_id=? ORDER BY d.updated_at DESC,c.chunk_index LIMIT 400",
                (rs, n) -> new Candidate(rs.getString("id"), rs.getString("document_id"), rs.getString("title"), rs.getString("source_url"), rs.getString("content"), rs.getInt("chunk_index"), rs.getString("metadata"), 0), owner, project));
        }
        Set<String> terms = terms(query);
        return rows.stream().map(row -> new Candidate(row.id(), row.documentId(), row.title(), row.sourceUrl(), row.content(), row.chunkIndex(), row.metadata(), rank(row, terms, query)))
            .filter(row -> row.score() > 0).sorted(Comparator.comparingDouble(Candidate::score).reversed().thenComparing(Candidate::documentId).thenComparingInt(Candidate::chunkIndex)).limit(topK).toList();
    }

    private static double rank(Candidate row, Set<String> terms, String query) {
        String text = (row.title() + " " + row.content()).toLowerCase(Locale.ROOT); double score = Math.max(0, row.score());
        if (text.contains(query.toLowerCase(Locale.ROOT))) score += 4;
        for (String term : terms) { int at = 0; while ((at = text.indexOf(term, at)) >= 0) { score += row.title().toLowerCase(Locale.ROOT).contains(term) ? 2.2 : 1; at += Math.max(1, term.length()); } }
        return score;
    }

    private Map<String, Object> result(Candidate row) {
        var out = new LinkedHashMap<String, Object>(); out.put("chunkId", row.id()); out.put("documentId", row.documentId()); out.put("title", row.title()); out.put("sourceUrl", row.sourceUrl()); out.put("excerpt", row.content()); out.put("chunkIndex", row.chunkIndex()); out.put("score", Math.round(row.score() * 1000) / 1000d); out.put("citation", row.sourceUrl() == null || row.sourceUrl().isBlank() ? row.title() + " · 第" + (row.chunkIndex() + 1) + "段" : row.title() + " · " + row.sourceUrl() + " · 第" + (row.chunkIndex() + 1) + "段");
        try { out.put("metadata", Json.read(row.metadata())); } catch (RuntimeException e) { out.put("metadata", Map.of()); }
        return out;
    }

    private Map<String, Object> document(String owner, String project, String id) {
        return jdbc.query("SELECT id,title,source_url,content_hash,metadata,created_at,updated_at FROM rag_document WHERE id=? AND owner_id=? AND project_id=?", (rs, n) -> {
            var row = new LinkedHashMap<String, Object>(); row.put("id", rs.getString("id")); row.put("title", rs.getString("title")); row.put("sourceUrl", rs.getString("source_url")); row.put("contentHash", rs.getString("content_hash")); row.put("metadata", Json.read(rs.getString("metadata"))); row.put("createdAt", WorkbenchStore.iso(rs, "created_at")); row.put("updatedAt", WorkbenchStore.iso(rs, "updated_at")); row.put("chunkCount", jdbc.queryForObject("SELECT COUNT(*) FROM rag_chunk WHERE document_id=?", Integer.class, id)); return row;
        }, id, owner, project).stream().findFirst().orElseThrow(ApiException::notFound);
    }

    private String cacheVersion(String owner, String project) { try { String value = redis.opsForValue().get(versionKey(owner, project)); return value == null ? "0" : value; } catch (RuntimeException e) { return "redis-offline"; } }
    private void bumpVersion(String owner, String project) { try { redis.opsForValue().increment(versionKey(owner, project)); } catch (RuntimeException ignored) {} }
    private static String versionKey(String owner, String project) { return "workbench:rag:version:" + owner + ":" + project; }
    private static String clean(String value, int max, String error, boolean blankAllowed) { String text = value == null ? "" : value.strip(); if (!blankAllowed && text.isBlank()) throw ApiException.invalid(error); if (text.length() > max || text.codePoints().anyMatch(c -> Character.isISOControl(c) && c != '\n' && c != '\t')) throw ApiException.invalid("知识文档字段为空、过长或包含控制字符"); return text; }
    private static String normalizeUrl(String value) { String text = value == null ? "" : value.strip(); if (text.isBlank()) return ""; try { URI uri = URI.create(text); if (!Set.of("http", "https").contains(uri.getScheme().toLowerCase(Locale.ROOT)) || uri.getHost() == null || uri.getUserInfo() != null || uri.getFragment() != null || text.length() > 2048) throw new IllegalArgumentException(); return uri.toASCIIString(); } catch (Exception e) { throw ApiException.invalid("来源地址必须是不含凭据的 HTTP(S) 地址"); } }
    private static String nullIfBlank(String value) { return value == null || value.isBlank() ? null : value; }
    private static String safeId(String id, String label) { String value = clean(id, 128, label + "不能为空", false); if (!value.matches("[A-Za-z0-9_-]{1,128}")) throw ApiException.invalid(label + "格式无效"); return value; }
    private static List<String> chunks(String content) { var out = new ArrayList<String>(); int start = 0; while (start < content.length()) { int end = Math.min(content.length(), start + CHUNK_SIZE); if (end < content.length() && Character.isHighSurrogate(content.charAt(end - 1))) end--; String value = content.substring(start, end).strip(); if (!value.isBlank()) out.add(value); if (end >= content.length()) break; start = Math.max(start + 1, end - CHUNK_OVERLAP); } return out; }
    private static Set<String> terms(String query) { var terms = new LinkedHashSet<String>(); String lower = query.toLowerCase(Locale.ROOT); var matcher = LATIN_TOKEN.matcher(lower); while (matcher.find()) if (!STOP_WORDS.contains(matcher.group())) terms.add(matcher.group()); var chars = lower.codePoints().toArray(); for (int i = 0; i < chars.length; i++) { String one = new String(Character.toChars(chars[i])); if (Character.UnicodeScript.of(chars[i]) == Character.UnicodeScript.HAN && !STOP_WORDS.contains(one)) terms.add(one); if (i + 1 < chars.length && Character.UnicodeScript.of(chars[i]) == Character.UnicodeScript.HAN && Character.UnicodeScript.of(chars[i + 1]) == Character.UnicodeScript.HAN) { String two = new String(Character.toChars(chars[i])) + new String(Character.toChars(chars[i + 1])); terms.add(two); } } return terms; }
    private static String escapeLike(String value) { return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_"); }
}
