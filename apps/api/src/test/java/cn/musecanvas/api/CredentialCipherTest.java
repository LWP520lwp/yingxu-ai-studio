package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class CredentialCipherTest {
    private static final String KEY = Base64.getEncoder().encodeToString("0123456789abcdef0123456789abcdef".getBytes(java.nio.charset.StandardCharsets.UTF_8));

    @Test void encryptsWithFreshAuthenticatedCiphertextAndAccountBoundAad() {
        var cipher = cipher(KEY);
        String first = cipher.encrypt("account-a", "legacy-service-key-should-never-be-public");
        String second = cipher.encrypt("account-a", "legacy-service-key-should-never-be-public");
        assertTrue(cipher.ready()); assertNotEquals(first, second); assertFalse(first.contains("legacy-service-key"));
        assertEquals("legacy-service-key-should-never-be-public", cipher.decrypt("account-a", first));
        assertThrows(IllegalStateException.class, () -> cipher.decrypt("account-b", first));
        byte[] ciphertext = Base64.getDecoder().decode(first.substring(3)); ciphertext[ciphertext.length - 1] ^= 1;
        String tampered = "v1:" + Base64.getEncoder().encodeToString(ciphertext);
        assertThrows(IllegalStateException.class, () -> cipher.decrypt("account-a", tampered));
    }

    @Test void wrongOrAbsentDeploymentKeyNeverFallsBackToPlaintext() {
        var cipher = cipher(KEY);
        String value = cipher.encrypt("account", "secret");
        var wrong = cipher(Base64.getEncoder().encodeToString("fedcba9876543210fedcba9876543210".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        assertTrue(wrong.ready()); assertThrows(IllegalStateException.class, () -> wrong.decrypt("account", value));
        var missing = cipher(""); assertFalse(missing.ready());
        assertThrows(IllegalStateException.class, () -> missing.encrypt("account", "secret"));
    }

    private static CredentialCipher cipher(String key) {
        var env = new MockEnvironment().withProperty("app.pool-credential-master-key", key);
        return new CredentialCipher(new AppSettings(env));
    }
}
