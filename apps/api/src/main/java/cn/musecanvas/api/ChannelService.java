package cn.musecanvas.api;

import java.net.URI;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Personal OpenAI-compatible providers. Only ciphertext is persisted; API views never contain keys. */
@Service
public class ChannelService {
    static final Set<String> CAPABILITIES=Set.of("text","vision","image","video");
    public record Model(String name,String capability) {}
    public record Input(String id,String name,String baseUrl,String apiFormat,Boolean enabled,String apiKey,List<Model> models) {
        @Override public String toString(){return "ChannelInput[id="+id+", apiKey=[redacted]]";}
    }
    public record Channel(String id,String owner,String name,String baseUrl,boolean enabled,String encryptedKey,List<Model> models) {}
    public record Route(Channel channel,String model) {}
    private final JdbcTemplate jdbc;
    private final CredentialCipher cipher;
    public ChannelService(JdbcTemplate jdbc,CredentialCipher cipher){this.jdbc=jdbc;this.cipher=cipher;}
    public static boolean custom(String model){return model!=null&&model.startsWith("channel:");}
    public List<Map<String,Object>> list(String owner){return channels(owner).stream().map(this::view).toList();}
    /** Configuration inventory; vision is stored explicitly and never advertised as a generation route. */
    public List<Map<String,Object>> modelCatalog(String owner){
        var result=new ArrayList<Map<String,Object>>();
        for(Channel channel:channels(owner))for(Model model:channel.models()){
            boolean connected=!"vision".equals(model.capability());
            result.add(Map.of("id","channel:"+channel.id()+":"+model.name(),"name",channel.name()+" · "+model.name(),
                "channelId",channel.id(),"model",model.name(),"capability",model.capability(),
                "available",connected&&channel.enabled()&&cipher.ready(),"connected",connected));
        }
        return List.copyOf(result);
    }
    public List<Map<String,Object>> textModels(String owner){
        var result=new ArrayList<Map<String,Object>>();
        for(Channel channel:channels(owner))for(Model model:channel.models())if("text".equals(model.capability()))
            result.add(Map.of("id","channel:"+channel.id()+":"+model.name(),"name",channel.name()+" · "+model.name(),"available",channel.enabled()&&cipher.ready()));
        return List.copyOf(result);
    }
    List<Channel> channels(String owner){return jdbc.query("SELECT * FROM user_generation_channel WHERE owner_id=? ORDER BY created_at",(rs,n)->new Channel(rs.getString("id"),owner,rs.getString("name"),rs.getString("base_url"),rs.getBoolean("enabled"),rs.getString("encrypted_key"),readModels(rs.getString("models_json"))),owner);}
    Channel require(String owner,String id){return channels(owner).stream().filter(c->c.id().equals(id)).findFirst().orElseThrow(ApiException::notFound);}
    private static List<Model> readModels(String value){try{return List.of(Json.MAPPER.readValue(value,Model[].class));}catch(Exception e){throw new IllegalStateException("Invalid persisted channel models");}}
    Map<String,Object> view(Channel c){return Map.of("id",c.id(),"name",c.name(),"baseUrl",c.baseUrl(),"apiFormat","openai","enabled",c.enabled(),"hasKey",!c.encryptedKey().isBlank(),"models",c.models());}
    @Transactional
    public Map<String,Object> save(String owner,Input input){
        if(input==null)throw ApiException.invalid("渠道配置必填");
        String name=input.name()==null?"":input.name().trim();if(name.isBlank()||name.length()>80)throw ApiException.invalid("渠道名称应为 1–80 字符");
        if(!"openai".equals(input.apiFormat()))throw ApiException.invalid("当前支持 OpenAI 兼容协议");
        String base=normalizeBase(input.baseUrl());
        List<Model> models=validateModels(input.models());
        jdbc.queryForObject("SELECT id FROM app_user WHERE id=? FOR UPDATE",String.class,owner);
        Channel prior=input.id()==null||input.id().isBlank()?null:require(owner,input.id());
        if(prior==null&&channels(owner).size()>=20)throw ApiException.invalid("每个账号最多添加 20 个渠道");
        String id=prior==null?UUID.randomUUID().toString():prior.id();
        String key=input.apiKey()==null?"":input.apiKey().trim();
        if(!key.isBlank()&&(key.length()>8192||key.chars().anyMatch(ch->ch<32||ch==127)))throw ApiException.invalid("API Key 格式无效");
        if(key.isBlank()&&prior==null)throw ApiException.invalid("新增渠道需要填写 API Key");
        if(key.isBlank()&&prior!=null&&!MuseClient.origin(URI.create(prior.baseUrl())).equals(MuseClient.origin(URI.create(base))))throw ApiException.invalid("切换渠道域名需要重新填写 API Key");
        if(!cipher.ready())throw ApiException.invalid("部署尚未配置服务端凭证加密密钥");
        String encrypted=key.isBlank()?prior.encryptedKey():cipher.encrypt("channel:"+id,key);
        boolean enabled=input.enabled()==null||input.enabled();
        if(prior==null)jdbc.update("INSERT INTO user_generation_channel(id,owner_id,name,base_url,encrypted_key,enabled,models_json) VALUES(?,?,?,?,?,?,?)",id,owner,name,base,encrypted,enabled,Json.write(models));
        else jdbc.update("UPDATE user_generation_channel SET name=?,base_url=?,encrypted_key=?,enabled=?,models_json=? WHERE id=? AND owner_id=?",name,base,encrypted,enabled,Json.write(models),id,owner);
        return view(require(owner,id));
    }
    public Map<String,Object> delete(String owner,String id){require(owner,id);jdbc.update("DELETE FROM user_generation_channel WHERE id=? AND owner_id=?",id,owner);return Map.of("ok",true);}
    String key(Channel channel){return cipher.decrypt("channel:"+channel.id(),channel.encryptedKey());}
    static String fingerprint(Channel channel){return "channel:"+Json.hash(channel.baseUrl()+"|"+channel.encryptedKey()).substring(0,24);}
    public Route route(String owner,String model){
        if(!cipher.ready())throw ApiException.invalid("部署尚未配置服务端凭证加密密钥");
        if(!custom(model))throw ApiException.invalid("渠道模型标识无效");
        String[] parts=model.split(":",3);if(parts.length!=3)throw ApiException.invalid("渠道模型标识无效");
        Channel c=require(owner,parts[1]);if(!c.enabled())throw ApiException.invalid("此渠道已停用");
        if(c.models().stream().noneMatch(m->m.name().equals(parts[2])))throw ApiException.invalid("模型已从渠道移除");
        return new Route(c,parts[2]);
    }
    public void validate(String owner,JobService.Request request){
        Route route=route(owner,request.model());
        if(route.channel().models().stream().noneMatch(m->m.name().equals(route.model())&&m.capability().equals(request.kind())))throw ApiException.invalid("渠道模型能力与生成类型不符");
        if(!request.referenceAssetIds().isEmpty())throw ApiException.invalid("自建兼容渠道目前支持文生图与文生视频，请移除参考图");
    }
    @SuppressWarnings("unchecked")
    public Map<String,Object> mergeModels(String owner,Map<String,Object> nativeModels){
        var result=new LinkedHashMap<String,Object>();
        List<Channel> personal=owner==null?List.of():channels(owner);
        for(String kind:List.of("image","video")){
            var values=new ArrayList<Object>((List<Object>)nativeModels.getOrDefault(kind,List.of()));
            for(Channel c:personal)for(Model m:c.models())if(kind.equals(m.capability()))values.add(Map.of("id","channel:"+c.id()+":"+m.name(),"name",c.name()+" · "+m.name(),"available",c.enabled()&&cipher.ready(),"caps",Map.of("supportsReferenceImages",false,"maxReferenceImages",0,"supportsSizeControl",true)));
            result.put(kind,values);
        }
        return result;
    }
    static String normalizeBase(String value){
        try{
            URI uri=URI.create(value==null?"":value.trim());
            if(!"https".equalsIgnoreCase(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null||uri.getQuery()!=null||uri.getFragment()!=null||uri.getPort()!=-1&&uri.getPort()!=443)throw new IllegalArgumentException();
            String host=uri.getHost().toLowerCase(Locale.ROOT);
            if(host.equals("localhost")||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".internal")||!host.contains("."))throw new IllegalArgumentException();
            if(host.matches("[0-9.]+")&&!MuseClient.publicAddress(java.net.InetAddress.getByName(host)))throw new IllegalArgumentException();
            String base=uri.toString().replaceAll("/+$","");if(base.length()>512)throw new IllegalArgumentException();return base;
        }catch(Exception e){throw ApiException.invalid("个人渠道请使用无账号、查询参数的 HTTPS 443 公网地址；本机 Muse 请通过账号池接入");}
    }
    static List<Model> validateModels(List<Model> input){
        if(input==null||input.size()>100)throw ApiException.invalid("每个渠道最多配置 100 个模型");
        var names=new HashSet<String>();var result=new ArrayList<Model>();
        for(Model m:input){if(m==null||m.name()==null||!m.name().matches("[a-zA-Z0-9][a-zA-Z0-9._/-]{0,63}")||!CAPABILITIES.contains(m.capability()==null?"":m.capability())||!names.add(m.name()))throw ApiException.invalid("模型名称须唯一且不超过 64 字符，请确认文本、图像理解、图像生成或视频生成能力");result.add(m);}
        return List.copyOf(result);
    }
}
