package app.suzanne;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Suzanne en plein écran : l'app web du serveur dans une WebView, sans barre de
 * navigateur. Les liens vers d'autres sites (banque, documentation) s'ouvrent
 * dans le navigateur ; les fichiers exportés vont dans Téléchargements.
 */
public class MainActivity extends Activity {
    static final String ACTION_RELOAD = "app.suzanne.RELOAD";
    static final String ACTION_CHANGE_SERVER = "app.suzanne.CHANGE_SERVER";
    private static final String TAG = "Suzanne";
    private static final int FILE_CHOOSER = 1;

    private WebView web;
    private View errorView;
    private TextView errorText;
    private String serverUrl;
    private String bridgeJs;
    // Pont HTTP natif vers le serveur (l'interface est toujours celle embarquée).
    private NativeHttp nativeHttp;
    // Hôte de la page affichée : le pont n'obéit qu'à l'interface embarquée.
    private volatile String pageHost = "";
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (handleChangeServer(getIntent())) return;
        serverUrl = ServerPrefs.get(this);
        if (serverUrl == null) { openSetup(); return; }

        bridgeJs = readAsset("bridge.js");
        FrameLayout root = new FrameLayout(this);
        web = buildWebView();
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        errorView = buildErrorView();
        errorView.setVisibility(View.GONE);
        root.addView(errorView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.setFitsSystemWindows(true);
        setContentView(root);

        // Restauration (activité recréée par le système) : seulement si un
        // historique a bien été sauvegardé, sinon la WebView resterait vide.
        boolean restored = savedInstanceState != null
                && web.restoreState(savedInstanceState) != null
                && web.copyBackForwardList().getSize() > 0;
        // L'interface est TOUJOURS celle embarquée dans l'app (ADR 0012) : en mode
        // serveur, seules les données viennent du serveur, via le pont natif.
        if (!restored) web.loadUrl(ServerPrefs.LOCAL_ORIGIN + "/");
    }

    @Override
    protected void onDestroy() {
        if (nativeHttp != null) nativeHttp.shutdown();
        super.onDestroy();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (handleChangeServer(intent)) return;
        if (ACTION_RELOAD.equals(intent.getAction())) {
            // Nouveau serveur choisi : on repart de zéro.
            recreate();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Retour dans l'app (après la banque, par ex.) : l'app web se met à jour
        // sur l'événement « focus », comme dans un navigateur.
        if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('focus'))", null);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (web != null && errorView.getVisibility() != View.VISIBLE && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private boolean handleChangeServer(Intent intent) {
        if (intent == null || !ACTION_CHANGE_SERVER.equals(intent.getAction())) return false;
        openSetup();
        return true;
    }

    private void openSetup() {
        startActivity(new Intent(this, SetupActivity.class));
        finish();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private WebView buildWebView() {
        // Build de debug : WebView inspectable depuis chrome://inspect sur le PC.
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        WebView view = new WebView(this);
        WebSettings s = view.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // localStorage : thème, préférences, jeton
        s.setDatabaseEnabled(true);
        s.setSupportMultipleWindows(true); // window.open → onCreateWindow
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setUserAgentString(s.getUserAgentString() + " SuzanneAndroid/1.0");
        view.setBackgroundColor(getColor(R.color.paper));
        view.addJavascriptInterface(new Bridge(), "SuzanneAndroid");
        nativeHttp = new NativeHttp(this, (js) -> runOnUiThread(() -> { if (web != null) web.evaluateJavascript(js, null); }), () -> pageHost);
        view.addJavascriptInterface(nativeHttp, "SuzanneHttp");

        view.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView v, String url, android.graphics.Bitmap favicon) {
                String host = Uri.parse(url).getHost();
                pageHost = host == null ? "" : host;
            }

            // Mode local : https://suzanne.local/… est servi depuis l'APK, sans réseau.
            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest request) {
                if (!ServerPrefs.LOCAL_HOST.equalsIgnoreCase(request.getUrl().getHost())) return null;
                return serveLocal(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isOwnServer(uri)) return false;
                openExternally(uri);
                return true;
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                if (bridgeJs != null) v.evaluateJavascript(bridgeJs, null);
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showError(String.valueOf(error.getDescription()));
            }

            // Certificat non reconnu : accepté seulement pour le serveur que
            // l'utilisateur a explicitement approuvé (« Faire confiance à ce
            // serveur »), et seulement si le certificat porte bien son nom ;
            // refusé partout ailleurs, avec une explication plutôt qu'une page blanche.
            @Override
            public void onReceivedSslError(WebView v, android.webkit.SslErrorHandler handler, android.net.http.SslError error) {
                Uri uri = Uri.parse(error.getUrl());
                boolean approved = isOwnServer(uri) && ServerPrefs.isTrusted(MainActivity.this, uri.getHost())
                        && error.getPrimaryError() == android.net.http.SslError.SSL_UNTRUSTED;
                if (approved) { handler.proceed(); return; }
                handler.cancel();
                if (isOwnServer(uri)) showError(getString(R.string.setup_ssl));
            }
        });

        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER);
                    return true;
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
            }

            // window.open(url) : on récupère l'adresse dans une WebView jetable et
            // on l'ouvre dans le navigateur (ex. page de connexion de la banque).
            @Override
            public boolean onCreateWindow(WebView v, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                WebView popup = new WebView(MainActivity.this);
                popup.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView p, WebResourceRequest request) {
                        Uri uri = request.getUrl();
                        if (isOwnServer(uri)) web.loadUrl(uri.toString());
                        else openExternally(uri);
                        p.destroy();
                        return true;
                    }
                });
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(popup);
                resultMsg.sendToTarget();
                return true;
            }
        });
        return view;
    }

    /**
     * Fichier du mode local (assets/local/). Une adresse sans extension est une
     * page de l'app (/transactions…) : on renvoie index.html, comme le serveur.
     */
    private android.webkit.WebResourceResponse serveLocal(Uri uri) {
        String path = uri.getPath() == null || uri.getPath().isEmpty() ? "/" : uri.getPath();
        boolean isPage = path.equals("/") || !path.substring(path.lastIndexOf('/') + 1).contains(".");
        String asset = "local" + (isPage ? "/index.html" : path);
        java.util.Map<String, String> headers = new java.util.HashMap<>();
        headers.put("Cache-Control", isPage ? "no-cache" : "max-age=31536000, immutable");
        try {
            java.io.InputStream in = getAssets().open(asset);
            return new android.webkit.WebResourceResponse(mimeType(asset), isText(asset) ? "utf-8" : null, 200, "OK", headers, in);
        } catch (java.io.IOException e) {
            return new android.webkit.WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers,
                    new java.io.ByteArrayInputStream(("Introuvable : " + path).getBytes(StandardCharsets.UTF_8)));
        }
    }

    private static String mimeType(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        if (n.endsWith(".html")) return "text/html";
        if (n.endsWith(".js") || n.endsWith(".mjs")) return "text/javascript";
        if (n.endsWith(".css")) return "text/css";
        if (n.endsWith(".wasm")) return "application/wasm"; // requis par WebAssembly.compileStreaming
        if (n.endsWith(".json") || n.endsWith(".webmanifest")) return "application/json";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".woff2")) return "font/woff2";
        if (n.endsWith(".woff")) return "font/woff";
        // .pgz : base pré-migrée du mode local (tar gzip) ; type gzip pour que
        // PGlite la décompresse.
        if (n.endsWith(".gz") || n.endsWith(".pgz")) return "application/gzip";
        return "application/octet-stream";
    }

    private static boolean isText(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        return n.endsWith(".html") || n.endsWith(".js") || n.endsWith(".mjs") || n.endsWith(".css") || n.endsWith(".json") || n.endsWith(".webmanifest") || n.endsWith(".svg");
    }

    /**
     * Page « de l'app » : uniquement l'interface embarquée. Toute autre adresse
     * (y compris le serveur, la banque, la documentation) s'ouvre dans le navigateur.
     */
    private boolean isOwnServer(Uri uri) {
        return ServerPrefs.LOCAL_HOST.equalsIgnoreCase(uri.getHost());
    }

    private void openExternally(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Log.w(TAG, "Aucune app pour " + uri);
        }
    }

    private void showError(String detail) {
        errorText.setText(getString(R.string.error_text, detail));
        errorView.setVisibility(View.VISIBLE);
    }

    private View buildErrorView() {
        int ink = getColor(R.color.ink);
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setGravity(Gravity.CENTER);
        column.setPadding(dp(28), dp(28), dp(28), dp(28));
        column.setBackgroundColor(getColor(R.color.paper));
        column.setClickable(true);

        TextView title = new TextView(this);
        title.setText(R.string.error_title);
        title.setTextColor(ink);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        title.setTypeface(Typeface.create(Typeface.SERIF, Typeface.BOLD));
        title.setGravity(Gravity.CENTER);
        column.addView(title);

        errorText = new TextView(this);
        errorText.setTextColor(getColor(R.color.muted));
        errorText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        errorText.setGravity(Gravity.CENTER);
        errorText.setPadding(0, dp(10), 0, dp(24));
        column.addView(errorText);

        Button retry = pill(R.string.retry, getColor(R.color.accent), 0xFF17150F, getColor(R.color.accent));
        retry.setOnClickListener(v -> { errorView.setVisibility(View.GONE); web.reload(); });
        column.addView(retry, wide(0));

        Button change = pill(R.string.change_server, 0x00000000, ink, getColor(R.color.border));
        change.setOnClickListener(v -> openSetup());
        column.addView(change, wide(dp(10)));
        return column;
    }

    private Button pill(int label, int fill, int textColor, int stroke) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setTextColor(textColor);
        b.setMinHeight(dp(50));
        b.setStateListAnimator(null);
        GradientDrawable d = new GradientDrawable();
        d.setColor(fill);
        d.setCornerRadius(dp(999));
        d.setStroke(dp(1), stroke);
        b.setBackground(d);
        return b;
    }

    private LinearLayout.LayoutParams wide(int topMargin) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(dp(260), LinearLayout.LayoutParams.WRAP_CONTENT);
        p.topMargin = topMargin;
        return p;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private String readAsset(String name) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(getAssets().open(name), StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) sb.append(line).append('\n');
            return sb.toString();
        } catch (Exception e) {
            Log.e(TAG, "bridge.js illisible", e);
            return null;
        }
    }

    /** Appelé depuis bridge.js (thread JavaBridge, pas le thread UI). */
    private final class Bridge {
        @JavascriptInterface
        public void saveFile(String base64, String filename, String mime, boolean open) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                String name = safeName(filename, mime);
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                values.put(MediaStore.Downloads.MIME_TYPE, mime);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IllegalStateException("insert");
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    if (out == null) throw new IllegalStateException("stream");
                    out.write(bytes);
                }
                runOnUiThread(() -> {
                    Toast.makeText(MainActivity.this, getString(R.string.saved_to_downloads, name), Toast.LENGTH_SHORT).show();
                    if (open) {
                        Intent view = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        try { startActivity(view); } catch (ActivityNotFoundException e) {
                            Toast.makeText(MainActivity.this, R.string.no_viewer, Toast.LENGTH_SHORT).show();
                        }
                    }
                });
            } catch (Exception e) {
                Log.e(TAG, "saveFile", e);
                runOnUiThread(() -> Toast.makeText(MainActivity.this, R.string.save_failed, Toast.LENGTH_SHORT).show());
            }
        }

        @JavascriptInterface
        public void log(String text) {
            Log.w(TAG, text);
        }

        private String safeName(String filename, String mime) {
            String name = filename == null ? "" : filename.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
            if (!name.isEmpty()) return name;
            String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
            String stamp = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(new Date());
            return "suzanne-" + stamp + (ext != null ? "." + ext : "");
        }
    }
}
