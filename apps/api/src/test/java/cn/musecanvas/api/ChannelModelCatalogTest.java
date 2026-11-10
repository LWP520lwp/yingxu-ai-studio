package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class ChannelModelCatalogTest {
    @Test void configuredVisionRoleIsAllowedButUnknownDiscoveryCannotBePersisted() {
        var vision=new ChannelService.Model("private-visual-model","vision");
        assertEquals(List.of(vision),ChannelService.validateModels(List.of(vision)));
        assertThrows(ApiException.class,()->ChannelService.validateModels(List.of(new ChannelService.Model("private","unknown"))));
        assertThrows(ApiException.class,()->ChannelService.validateModels(List.of(new ChannelService.Model("private",null))));
        assertThrows(ApiException.class,()->ChannelService.validateModels(List.of(vision,vision)));
        var input=new ChannelService.Input(null,"test","https://provider.example/v1","openai",true,"do-not-print-this-key",List.of(vision));
        assertFalse(input.toString().contains("do-not-print-this-key"));
    }
    @Test void configurationCatalogDoesNotAdvertiseVisionAsConnectedAndNeverExposesCredentials() {
        var cipher=mock(CredentialCipher.class);when(cipher.ready()).thenReturn(true);
        var service=spy(new ChannelService(mock(JdbcTemplate.class),cipher));
        var channel=new ChannelService.Channel("channel-one","owner","自己的服务","https://provider.example/v1",true,"encrypted-private-secret",List.of(
            new ChannelService.Model("text-model","text"),new ChannelService.Model("visual-model","vision"),new ChannelService.Model("image-model","image")));
        doReturn(List.of(channel)).when(service).channels("owner");
        doReturn(List.of()).when(service).channels("other-owner");
        var catalog=service.modelCatalog("owner");
        assertEquals(3,catalog.size());assertEquals(true,catalog.getFirst().get("available"));
        assertEquals(false,catalog.get(1).get("available"));assertEquals(false,catalog.get(1).get("connected"));
        assertEquals("vision",catalog.get(1).get("capability"));
        assertEquals(1,service.textModels("owner").size());assertTrue(service.modelCatalog("other-owner").isEmpty());
        String publicData=Json.write(catalog);assertFalse(publicData.contains("encrypted-private-secret"));assertFalse(publicData.contains("encryptedKey"));
        verify(cipher,never()).decrypt(anyString(),anyString());
    }
}
