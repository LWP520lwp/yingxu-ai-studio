package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;

class TextModelControllerTest {
    private final ChannelService channels=mock(ChannelService.class);
    private final MuseTextGateway muse=mock(MuseTextGateway.class);
    private final TextModelController controller=new TextModelController(new UserService(mock(JdbcTemplate.class)),channels,muse);

    @Test void catalogUsesAuthenticatedOwnerForBothCustomChannelsAndMuseAvailability(){
        for(String owner:List.of("first","second")){
            when(channels.textModels(owner)).thenReturn(List.of(Map.of("id","channel:"+owner+":text","name",owner+" model","available",true)));
            when(muse.models(owner)).thenReturn(List.of(Map.of("id","muse-spark","available",true),Map.of("id","muse-service-spark","available",owner.equals("first"))));
            var auth=new UsernamePasswordAuthenticationToken(new UserService.User(owner,owner,"","github"),null,List.of());
            var response=controller.models(auth);
            assertEquals("no-store",response.getHeaders().getCacheControl());
            var models=Json.read(Json.write(response.getBody())).path("models");
            assertEquals(3,models.size());assertEquals("channel:"+owner+":text",models.get(0).path("id").asString());
            assertEquals(owner.equals("first"),models.get(2).path("available").asBoolean());
            verify(channels).textModels(owner);verify(muse).models(owner);
        }
        verifyNoMoreInteractions(channels,muse);
    }

    @Test void unauthenticatedRequestsCannotQueryAnyOwnerCatalog(){
        var error=assertThrows(ApiException.class,()->controller.models(null));
        assertEquals(401,error.status.value());verifyNoInteractions(channels,muse);
    }
}
