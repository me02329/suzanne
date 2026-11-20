package app.suzanne;

import android.content.Context;
import android.content.SharedPreferences;

/** Adresse du serveur Suzanne, enregistrée sur le téléphone. */
final class ServerPrefs {
    private static final String FILE = "suzanne";
    private static final String KEY_URL = "server_url";
    private static final String KEY_TRUSTED_HOST = "trusted_host";

    private ServerPrefs() {}

    static String get(Context context) {
        return prefs(context).getString(KEY_URL, null);
    }

    static void set(Context context, String url) {
        SharedPreferences.Editor edit = prefs(context).edit().putString(KEY_URL, url);
        // Changer de serveur retire la confiance accordée à l'ancien.
        String trusted = trustedHost(context);
        if (trusted != null && !trusted.equalsIgnoreCase(android.net.Uri.parse(url).getHost())) edit.remove(KEY_TRUSTED_HOST);
        edit.apply();
    }

    /**
     * Serveur dont le certificat HTTPS est accepté bien qu'aucune autorité ne le
     * reconnaisse (serveur auto-hébergé, ex. Caddy « tls internal ») : l'équivalent
     * retenu de « Continuer quand même » d'un navigateur, accordé explicitement et
     * limité à ce seul nom d'hôte (le nom du certificat reste vérifié).
     */
    static String trustedHost(Context context) {
        return prefs(context).getString(KEY_TRUSTED_HOST, null);
    }

    static void trustHost(Context context, String host) {
        prefs(context).edit().putString(KEY_TRUSTED_HOST, host).apply();
    }

    static boolean isTrusted(Context context, String host) {
        String trusted = trustedHost(context);
        return trusted != null && host != null && trusted.equalsIgnoreCase(host);
    }

    /**
     * Fabrique TLS pour un hôte de confiance : on tente d'abord la vérification
     * normale (autorités du système et de l'utilisateur) et on n'accepte la chaîne
     * inconnue qu'en dernier recours. La vérification du nom d'hôte, elle, reste
     * celle par défaut.
     */
    static javax.net.ssl.SSLSocketFactory lenientSocketFactory() throws Exception {
        javax.net.ssl.TrustManagerFactory tmf = javax.net.ssl.TrustManagerFactory.getInstance(javax.net.ssl.TrustManagerFactory.getDefaultAlgorithm());
        tmf.init((java.security.KeyStore) null);
        final javax.net.ssl.X509TrustManager system = (javax.net.ssl.X509TrustManager) tmf.getTrustManagers()[0];
        javax.net.ssl.X509TrustManager lenient = new javax.net.ssl.X509TrustManager() {
            @Override public void checkClientTrusted(java.security.cert.X509Certificate[] chain, String authType) throws java.security.cert.CertificateException {
                system.checkClientTrusted(chain, authType);
            }
            @Override public void checkServerTrusted(java.security.cert.X509Certificate[] chain, String authType) {
                try { system.checkServerTrusted(chain, authType); } catch (java.security.cert.CertificateException ignored) { /* hôte explicitement approuvé */ }
            }
            @Override public java.security.cert.X509Certificate[] getAcceptedIssuers() { return system.getAcceptedIssuers(); }
        };
        javax.net.ssl.SSLContext context = javax.net.ssl.SSLContext.getInstance("TLS");
        context.init(null, new javax.net.ssl.TrustManager[] { lenient }, null);
        return context.getSocketFactory();
    }

    /**
     * Adresses à essayer pour une saisie, dans l'ordre. Avec un schéma
     * (http:// ou https://) : telle quelle. Sans schéma : https:// d'abord (cas
     * d'un nom de domaine), puis http:// (serveur sur un réseau local).
     * Barre finale retirée. Liste vide si la saisie n'est pas une adresse.
     */
    static java.util.List<String> candidates(String input) {
        java.util.List<String> out = new java.util.ArrayList<>();
        if (input == null) return out;
        String url = input.trim();
        while (url.endsWith("/")) url = url.substring(0, url.length() - 1);
        if (url.isEmpty()) return out;
        if (url.matches("(?i)^https?://.*")) out.add(url);
        else { out.add("https://" + url); out.add("http://" + url); }
        out.removeIf((u) -> { android.net.Uri uri = android.net.Uri.parse(u); return uri.getHost() == null || uri.getHost().isEmpty(); });
        return out;
    }

    /** Origine (schéma + hôte + port) et chemin d'une adresse, sans barre finale. */
    static String base(String url) {
        String u = url;
        while (u.endsWith("/")) u = u.substring(0, u.length() - 1);
        return u;
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }
}
