package app.suzanne;

import android.content.Context;
import android.content.SharedPreferences;

/** Adresse du serveur Suzanne, enregistrée sur le téléphone. */
final class ServerPrefs {
    private static final String FILE = "suzanne";
    private static final String KEY_URL = "server_url";

    private ServerPrefs() {}

    static String get(Context context) {
        return prefs(context).getString(KEY_URL, null);
    }

    static void set(Context context, String url) {
        prefs(context).edit().putString(KEY_URL, url).apply();
    }

    /**
     * Normalise une saisie : ajoute http:// si absent, retire la barre finale.
     * Renvoie null si ce n'est pas une adresse http(s) utilisable.
     */
    static String normalize(String input) {
        if (input == null) return null;
        String url = input.trim();
        if (url.isEmpty()) return null;
        if (!url.matches("(?i)^https?://.*")) url = "http://" + url;
        while (url.endsWith("/")) url = url.substring(0, url.length() - 1);
        android.net.Uri uri = android.net.Uri.parse(url);
        if (uri.getHost() == null || uri.getHost().isEmpty()) return null;
        return url;
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }
}
