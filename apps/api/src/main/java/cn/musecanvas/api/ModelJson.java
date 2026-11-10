package cn.musecanvas.api;

import java.util.ArrayDeque;
import java.util.Locale;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Extract one complete model object without repairing JSON or guessing among multiple answers. */
public final class ModelJson {
    static final int MAX_CHARACTERS=120000;
    private static final int MAX_DEPTH=128;
    private static final JsonMapper STRICT=JsonMapper.builder()
        .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
        .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build();
    private ModelJson(){}

    public static JsonNode object(String raw){
        if(raw==null||raw.isBlank()||raw.length()>MAX_CHARACTERS)throw invalid();
        String value=raw.strip();if(value.startsWith("\ufeff"))value=value.substring(1).strip();
        var stack=new ArrayDeque<Character>();boolean quoted=false,escaped=false;
        int start=-1,end=-1;
        for(int i=0;i<value.length();i++){
            char c=value.charAt(i);
            if(stack.isEmpty()){
                if(c=='{'||c=='['){
                    // An outer array or another structured candidate makes the answer ambiguous.
                    if(c=='['||start>=0)throw invalid();
                    start=i;stack.push(c);
                }else if(c=='}'||c==']')throw invalid();
                continue;
            }
            if(quoted){if(escaped)escaped=false;else if(c=='\\')escaped=true;else if(c=='"')quoted=false;continue;}
            if(c=='"'){quoted=true;continue;}
            if(c=='{'||c=='['){if(stack.size()>=MAX_DEPTH)throw invalid();stack.push(c);}
            else if(c=='}'||c==']'){
                if(stack.pop()!=(c=='}'?'{':'['))throw invalid();
                if(stack.isEmpty())end=i+1;
            }
        }
        if(start<0||end<0||!stack.isEmpty()||quoted||escaped)throw invalid();
        checkWrapper(value.substring(0,start),value.substring(end));
        try{
            JsonNode result=STRICT.readTree(value.substring(start,end));
            if(result==null||!result.isObject())throw invalid();
            return result;
        }catch(RuntimeException rejected){throw invalid();}
    }

    private static void checkWrapper(String before,String after){
        int opening=before.indexOf("```"),closing=after.indexOf("```");
        if(opening<0&&closing<0)return;
        if(opening<0||closing<0||before.indexOf("```",opening+3)>=0||after.indexOf("```",closing+3)>=0)throw invalid();
        String language=before.substring(opening+3).strip().toLowerCase(Locale.ROOT);
        if(!language.isEmpty()&&!language.equals("json"))throw invalid();
        if(!after.substring(0,closing).isBlank())throw invalid();
    }
    private static IllegalArgumentException invalid(){return new IllegalArgumentException("模型未返回唯一且完整的JSON对象");}
}
