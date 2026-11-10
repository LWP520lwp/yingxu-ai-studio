package cn.musecanvas.api;

import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.regex.Pattern;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/** Portable password hashes shared by Java and the Node deployment initializer. */
final class ReviewerCredentials {
    private static final Pattern HASH = Pattern.compile("^pbkdf2-sha256\\$(210000|[3-9][0-9]{5}|1000000)\\$([a-f0-9]{32})\\$([a-f0-9]{64})$");
    private ReviewerCredentials() {}
    static boolean validHash(String encoded) { return encoded != null && HASH.matcher(encoded).matches(); }
    static boolean matches(String password, String encoded) {
        if (password == null || password.isEmpty() || password.length() > 256 || !validHash(encoded)) return false;
        String[] parts = encoded.split("\\$");
        PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), HexFormat.of().parseHex(parts[2]), Integer.parseInt(parts[1]), 256);
        try {
            byte[] actual = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
            return MessageDigest.isEqual(actual, HexFormat.of().parseHex(parts[3]));
        } catch (java.security.GeneralSecurityException ex) { throw new IllegalStateException("Password verification is unavailable", ex); }
        finally { spec.clearPassword(); }
    }
}
