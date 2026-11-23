package app.suzanne;

import android.content.Context;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;

/**
 * Pont HTTP natif (ADR 0012) : l'interface embarquée dans l'app
 * (https://suzanne.local) fait exécuter ses appels au serveur Suzanne par
 * l'app, qui gère elle-même les certificats (« Faire confiance à ce serveur »),
 * le http d'un serveur local et se passe de CORS. Vérifié sur WebView : un
 * certificat auto-signé n'arrive jamais à onReceivedSslError pour un fetch, et
 * un serveur http est bloqué (contenu mixte) — d'où ce pont.
 *
 * Contrat :
 * - n'accepte que des requêtes venues de l'interface embarquée, et uniquement
 *   vers l'origine du serveur configuré (pas de mandataire ouvert) ;
 * - corps de requête et de réponse par morceaux (base64), passés par des
 *   fichiers temporaires : une sauvegarde peut peser plusieurs centaines de Mo ;
 * - asynchrone : start → write* → send ; la fin est signalée à la page par
 *   window.__suzanneHttp.ready(id, statut, en-têtes) / .fail(id, message), puis
 *   le corps est lu par read(id, n) jusqu'à "" ; cancel(id) annule ; release(id) libère.
 */
final class NativeHttp {
    private static final String TAG = "SuzanneHttp";
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 180_000; // l'assistant peut réfléchir longtemps

    private final Context context;
    private final Consumer<String> evalJs; // exécute du JS dans la page (thread UI)
    private final java.util.function.Supplier<String> currentHost; // hôte de la page courante
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private final AtomicLong ids = new AtomicLong();
    private final Map<String, Call> calls = new ConcurrentHashMap<>();

    private static final class Call {
        String method;
        URL url;
        JSONObject headers;
        File requestBody;
        File responseBody;
        InputStream reader;
        volatile HttpURLConnection connection;
        volatile boolean cancelled;
    }

    NativeHttp(Context context, Consumer<String> evalJs, java.util.function.Supplier<String> currentHost) {
        this.context = context;
        this.evalJs = evalJs;
        this.currentHost = currentHost;
    }

    /**
     * Cours de bourse et taux de change pour les profils du téléphone : le
     * serveur embarqué interroge Yahoo Finance, qui n'autorise pas les appels
     * depuis une page (CORS). Seuls ces hôtes, en https, sont ajoutés.
     */
    private static final java.util.Set<String> MARKET_HOSTS = new java.util.HashSet<>(java.util.Arrays.asList(
            "query1.finance.yahoo.com", "query2.finance.yahoo.com"));

    static boolean isMarketData(URL target) {
        return "https".equalsIgnoreCase(target.getProtocol())
                && MARKET_HOSTS.contains(target.getHost().toLowerCase(java.util.Locale.ROOT))
                && (target.getPort() == -1 || target.getPort() == 443);
    }

    /** La requête vient-elle de l'interface embarquée, et vise-t-elle le serveur configuré (ou Yahoo) ? */
    private String refuse(URL target) {
        if (!ServerPrefs.LOCAL_HOST.equalsIgnoreCase(currentHost.get())) return "appel refusé : page non autorisée";
        if (isMarketData(target)) return null;
        String server = ServerPrefs.get(context);
        if (server == null || ServerPrefs.isLocal(server)) return "aucun serveur configuré";
        try {
            URL s = new URL(server);
            boolean sameOrigin = s.getProtocol().equalsIgnoreCase(target.getProtocol())
                    && s.getHost().equalsIgnoreCase(target.getHost())
                    && s.getPort() == target.getPort();
            return sameOrigin ? null : "appel refusé : seule l'adresse du serveur configuré est joignable";
        } catch (Exception e) {
            return "adresse du serveur invalide";
        }
    }

    @JavascriptInterface
    public String start(String metaJson) {
        try {
            JSONObject meta = new JSONObject(metaJson);
            Call call = new Call();
            call.method = meta.optString("method", "GET").toUpperCase(java.util.Locale.ROOT);
            call.url = new URL(meta.getString("url"));
            call.headers = meta.optJSONObject("headers");
            String why = refuse(call.url);
            if (why != null) return "!" + why;
            String id = String.valueOf(ids.incrementAndGet());
            calls.put(id, call);
            return id;
        } catch (Exception e) {
            return "!" + e.getMessage();
        }
    }

    /** Ajoute un morceau (base64) au corps de la requête. */
    @JavascriptInterface
    public boolean write(String id, String base64) {
        Call call = calls.get(id);
        if (call == null) return false;
        try {
            if (call.requestBody == null) call.requestBody = File.createTempFile("req-", ".bin", context.getCacheDir());
            try (OutputStream out = new FileOutputStream(call.requestBody, true)) {
                out.write(Base64.decode(base64, Base64.NO_WRAP));
            }
            return true;
        } catch (Exception e) {
            Log.e(TAG, "write", e);
            return false;
        }
    }

    @JavascriptInterface
    public void send(String id) {
        Call call = calls.get(id);
        if (call == null) return;
        pool.execute(() -> execute(id, call));
    }

    private void execute(String id, Call call) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) call.url.openConnection();
            call.connection = conn;
            if (conn instanceof javax.net.ssl.HttpsURLConnection && ServerPrefs.isTrusted(context, call.url.getHost())) {
                ((javax.net.ssl.HttpsURLConnection) conn).setSSLSocketFactory(ServerPrefs.lenientSocketFactory());
            }
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setRequestMethod(call.method);
            // Yahoo refuse (429) les clients qui ne ressemblent pas à un navigateur.
            if (isMarketData(call.url)) conn.setRequestProperty("User-Agent", android.webkit.WebSettings.getDefaultUserAgent(context));
            if (call.headers != null) {
                for (Iterator<String> it = call.headers.keys(); it.hasNext(); ) {
                    String name = it.next();
                    // En-têtes gérés par la pile HTTP elle-même.
                    if (name.equalsIgnoreCase("host") || name.equalsIgnoreCase("content-length") || name.equalsIgnoreCase("connection")) continue;
                    conn.setRequestProperty(name, call.headers.optString(name));
                }
            }
            if (call.requestBody != null && call.requestBody.length() > 0) {
                conn.setDoOutput(true);
                conn.setFixedLengthStreamingMode(call.requestBody.length());
                try (InputStream in = new FileInputStream(call.requestBody); OutputStream out = conn.getOutputStream()) {
                    copy(in, out, call);
                }
            }
            int status = conn.getResponseCode();
            InputStream body = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            call.responseBody = File.createTempFile("res-", ".bin", context.getCacheDir());
            if (body != null) {
                try (InputStream in = body; OutputStream out = new FileOutputStream(call.responseBody)) {
                    copy(in, out, call);
                }
            }
            if (call.cancelled) { cleanup(id); return; }
            JSONObject headers = new JSONObject();
            for (Map.Entry<String, List<String>> h : conn.getHeaderFields().entrySet()) {
                if (h.getKey() == null || h.getValue() == null) continue;
                headers.put(h.getKey().toLowerCase(java.util.Locale.ROOT), String.join(", ", h.getValue()));
            }
            call.reader = new FileInputStream(call.responseBody);
            evalJs.accept("window.__suzanneHttp&&window.__suzanneHttp.ready(" + JSONObject.quote(id) + "," + status + "," + JSONObject.quote(headers.toString()) + ")");
        } catch (Exception e) {
            String message;
            if (e instanceof javax.net.ssl.SSLException) message = "certificat du serveur refusé (fais-lui confiance depuis l'écran de connexion)";
            else if (e instanceof java.net.SocketTimeoutException) message = "pas de réponse dans les temps";
            else if (e instanceof java.net.UnknownHostException) message = "adresse introuvable";
            else if (e instanceof java.net.ConnectException || e instanceof java.net.NoRouteToHostException) message = "connexion impossible";
            else message = e.getClass().getSimpleName() + (e.getMessage() != null ? " : " + e.getMessage() : "");
            Log.w(TAG, "échec de " + call.method + " " + call.url, e);
            if (!call.cancelled) evalJs.accept("window.__suzanneHttp&&window.__suzanneHttp.fail(" + JSONObject.quote(id) + "," + JSONObject.quote(message) + ")");
            cleanup(id);
        } finally {
            if (conn != null && call.cancelled) conn.disconnect();
        }
    }

    /** Lit jusqu'à `max` octets du corps de la réponse (base64) ; "" à la fin. */
    @JavascriptInterface
    public String read(String id, int max) {
        Call call = calls.get(id);
        if (call == null || call.reader == null) return "";
        try {
            byte[] buffer = new byte[Math.max(1, Math.min(max, 4 * 1024 * 1024))];
            int n = call.reader.read(buffer);
            if (n <= 0) return "";
            return Base64.encodeToString(buffer, 0, n, Base64.NO_WRAP);
        } catch (Exception e) {
            Log.e(TAG, "read", e);
            return "";
        }
    }

    @JavascriptInterface
    public void cancel(String id) {
        Call call = calls.get(id);
        if (call == null) return;
        call.cancelled = true;
        HttpURLConnection conn = call.connection;
        if (conn != null) pool.execute(conn::disconnect);
        cleanup(id);
    }

    @JavascriptInterface
    public void release(String id) {
        cleanup(id);
    }

    /** Adresse du serveur configuré ("" si l'app est sans serveur). */
    @JavascriptInterface
    public String serverUrl() {
        String server = ServerPrefs.get(context);
        return server == null || ServerPrefs.isLocal(server) ? "" : server;
    }

    private void cleanup(String id) {
        Call call = calls.remove(id);
        if (call == null) return;
        try { if (call.reader != null) call.reader.close(); } catch (Exception ignored) { /* déjà fermé */ }
        if (call.requestBody != null) call.requestBody.delete();
        if (call.responseBody != null) call.responseBody.delete();
    }

    private static void copy(InputStream in, OutputStream out, Call call) throws java.io.IOException {
        byte[] buffer = new byte[64 * 1024];
        int n;
        while (!call.cancelled && (n = in.read(buffer)) > 0) out.write(buffer, 0, n);
    }

    void shutdown() {
        pool.shutdownNow();
    }
}
