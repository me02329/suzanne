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
