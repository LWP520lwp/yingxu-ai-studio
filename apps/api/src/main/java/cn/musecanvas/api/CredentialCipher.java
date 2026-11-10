package cn.musecanvas.api;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

/** AES-256-GCM for server-only provider credentials; the independent master key is never generated here. */
@Component
public final class CredentialCipher {
    private static final byte[] AAD_PREFIX = "creative-workbench:pool-credential:v1:".getBytes(StandardCharsets.UTF_8);
    private static final int IV_BYTES = 12;
    private final byte[] key;
    private final SecureRandom random = new SecureRandom();

    public CredentialCipher(AppSettings settings) {
        byte[] decoded = null;
        try { decoded = Base64.getDecoder().decode(settings.poolCredentialMasterKey()); }
        catch (IllegalArgumentException ignored) { }
        this.key = decoded != null && decoded.length == 32 ? decoded.clone() : null;
    }

    public boolean ready() { return key != null; }

    public String encrypt(String accountId, String plaintext) {
        if (!ready()) throw new IllegalStateException("POOL_CREDENTIAL_MASTER_KEY must be a base64-encoded 32-byte key");
        if (accountId == null || plaintext == null || plaintext.isBlank() || plaintext.length() > 8192)
            throw new IllegalArgumentException("Invalid pool credential");
        try {
            byte[] iv = new byte[IV_BYTES]; random.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
            cipher.updateAAD(aad(accountId));
            byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            return "v1:" + Base64.getEncoder().encodeToString(ByteBuffer.allocate(iv.length + encrypted.length).put(iv).put(encrypted).array());
        } catch (GeneralSecurityException ex) { throw new IllegalStateException("Unable to protect pool credential", ex); }
    }

    public String decrypt(String accountId, String ciphertext) {
        if (!ready()) throw new IllegalStateException("POOL_CREDENTIAL_MASTER_KEY must be a base64-encoded 32-byte key");
        try {
            if (ciphertext == null || !ciphertext.startsWith("v1:")) throw new GeneralSecurityException("Unsupported encrypted credential");
            byte[] encoded = Base64.getDecoder().decode(ciphertext.substring(3));
            if (encoded.length <= IV_BYTES + 16) throw new GeneralSecurityException("Encrypted credential is truncated");
            ByteBuffer buffer = ByteBuffer.wrap(encoded);
            byte[] iv = new byte[IV_BYTES]; buffer.get(iv);
            byte[] encrypted = new byte[buffer.remaining()]; buffer.get(encrypted);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
            cipher.updateAAD(aad(accountId));
            return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException ex) {
            throw new IllegalStateException("Pool credential cannot be decrypted; verify the master key and ciphertext integrity", ex);
        }
    }

    private static byte[] aad(String id) {
        byte[] value = id.getBytes(StandardCharsets.UTF_8);
        return ByteBuffer.allocate(AAD_PREFIX.length + value.length).put(AAD_PREFIX).put(value).array();
    }
}
