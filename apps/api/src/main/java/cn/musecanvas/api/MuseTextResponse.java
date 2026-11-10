package cn.musecanvas.api;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.regex.Pattern;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Normalizes the Muse web bridge's concatenated, rewritten JSON snapshots. Never repairs JSON. */
final class MuseTextResponse {
    private static final int MAX_CHARACTERS=120000, MAX_DEPTH=128, MAX_CANDIDATES=4096, MAX_SCAN=2_000_000;
    private static final JsonMapper STRICT=JsonMapper.builder().enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
        .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build();
    private record Candidate(int start,int end,JsonNode value){}
    enum Shape {
        EXTRACT, SHOTS, SCIENCE;
        boolean matches(JsonNode value){
            if(value==null||!value.isObject())return false;
            return switch(this){
                case EXTRACT->value.size()==3&&value.path("characters").isArray()&&value.path("scenes").isArray()&&value.path("props").isArray();
                case SHOTS->value.size()==1&&value.path("shots").isArray();
                case SCIENCE->value.size()==2&&value.path("title").isString()&&value.path("scenes").isArray();
            };
        }
    }
    private MuseTextResponse(){}
    static String normalize(String raw,String system){
        Shape shape=expected(system);
        // Generic text users retain their original content; only known planning contracts use this adapter.
        return shape==null?raw:normalize(raw,shape);
    }
    private static Shape expected(String system){
        if(system==null)return null;
        if(system.contains("\"shots\""))return Shape.SHOTS;
        if(system.contains("\"characters\"")&&system.contains("\"scenes\"")&&system.contains("\"props\""))return Shape.EXTRACT;
        if(system.contains("\"title\"")&&system.contains("\"scenes\""))return Shape.SCIENCE;
        return null;
    }
    static String normalize(String raw,Shape shape){
        if(raw==null||raw.isBlank()||raw.length()>MAX_CHARACTERS)throw invalid();
        String value=raw.strip();
        try{
            JsonNode complete=ModelJson.object(value);
            if(!shape.matches(complete))throw invalid();
            return Json.write(complete);
        }catch(IllegalArgumentException malformed){/* Inspect bridge snapshots below; do not repair syntax. */}
        var parsed=new ArrayList<Candidate>();int attempts=0,scanned=0;
        for(int start=0;start<value.length();start++){
            if(value.charAt(start)!='{')continue;
            if(++attempts>MAX_CANDIDATES)throw invalid();
            int end=end(value,start);
            scanned+=end<0?value.length()-start:end-start;
            if(scanned>MAX_SCAN)throw invalid();
            if(end<0)continue;
            try{JsonNode node=STRICT.readTree(value.substring(start,end));if(node!=null&&node.isObject())parsed.add(new Candidate(start,end,node));}
            catch(RuntimeException malformed){/* A partial snapshot must never become an invented document. */}
        }
        String rootKey=firstKey(value);if(rootKey==null)throw invalid();
        var roots=new ArrayList<Candidate>();
        for(Candidate candidate:parsed){
            if(!rootKey.equals(firstKey(value.substring(candidate.start(),candidate.end()))))continue;
            boolean nested=parsed.stream().anyMatch(outer->outer.start()<candidate.start()&&outer.end()>=candidate.end());
            if(!nested)roots.add(candidate);
        }
        if(roots.isEmpty())throw invalid();
        Candidate last=roots.getLast();
        if(last.end()!=value.length()||!shape.matches(last.value()))throw invalid();
        // Multiple different complete documents are genuinely ambiguous, including an earlier valid snapshot.
        if(roots.stream().anyMatch(candidate->!candidate.value().equals(last.value())))throw invalid();
        String first=firstKey(value.substring(last.start(),last.end()));
        if(first==null)throw invalid();
        Pattern header=Pattern.compile("\\{\\s*\""+Pattern.quote(first)+"\"\\s*:");
        if(!header.matcher(value).lookingAt())throw invalid();
        int snapshots=0;var matches=header.matcher(value);while(matches.find())snapshots++;
        if(snapshots<2||last.start()==0)throw invalid();
        return Json.write(last.value());
    }
    private static String firstKey(String object){var key=Pattern.compile("^\\{\\s*\"([a-zA-Z]+)\"\\s*:").matcher(object);return key.find()?key.group(1):null;}
    private static int end(String value,int start){
        var stack=new ArrayDeque<Character>();boolean quoted=false,escaped=false;
        for(int index=start;index<value.length();index++){
            char character=value.charAt(index);
            if(quoted){if(escaped)escaped=false;else if(character=='\\')escaped=true;else if(character=='"')quoted=false;continue;}
            if(character=='"'){quoted=true;continue;}
            if(character=='{'||character=='['){if(stack.size()>=MAX_DEPTH)return -1;stack.push(character);}
            else if(character=='}'||character==']'){
                if(stack.isEmpty()||stack.pop()!=(character=='}'?'{':'['))return -1;
                if(stack.isEmpty())return index+1;
            }
        }
        return -1;
    }
    private static MuseClient.Rejected invalid(){return new MuseClient.Rejected("Muse 文本回复包含不完整或有歧义的文档，请检查原回复；没有自动重发模型请求");}
}
