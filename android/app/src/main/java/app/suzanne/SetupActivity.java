package app.suzanne;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Écran de départ : l'adresse du serveur Suzanne (celle du navigateur). On
 * vérifie qu'elle répond et que c'est bien Suzanne (manifeste de l'app web),
 * puis on l'enregistre et on ouvre l'app.
 */
public class SetupActivity extends Activity {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private EditText input;
    private Button connect;
    private Button saveAnyway;
    private Button trust;
    private TextView message;
    private String pendingUrl;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(buildLayout());
        String current = ServerPrefs.get(this);
        if (current != null) input.setText(current);
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }

    private View buildLayout() {
        int ink = getColor(R.color.ink);
        int muted = getColor(R.color.muted);

        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setGravity(Gravity.CENTER_VERTICAL);
        column.setPadding(dp(24), dp(48), dp(24), dp(24));

        TextView logo = new TextView(this);
        logo.setText(R.string.app_name);
        logo.setTextColor(ink);
        logo.setTextSize(TypedValue.COMPLEX_UNIT_SP, 34);
        logo.setTypeface(Typeface.create(Typeface.SERIF, Typeface.BOLD));
        column.addView(logo);

        TextView title = new TextView(this);
        title.setText(R.string.setup_title);
        title.setTextColor(ink);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setPadding(0, dp(28), 0, dp(6));
        column.addView(title);

        TextView intro = new TextView(this);
        intro.setText(R.string.setup_intro);
        intro.setTextColor(muted);
        intro.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        intro.setLineSpacing(0, 1.2f);
        column.addView(intro);

        input = new EditText(this);
        input.setHint(R.string.setup_hint);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setImeOptions(EditorInfo.IME_ACTION_GO);
        input.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        input.setTextColor(ink);
        input.setHintTextColor(muted);
        input.setPadding(dp(14), dp(12), dp(14), dp(12));
        input.setBackground(rounded(getColor(R.color.surface), getColor(R.color.border), 12));
        input.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO) { check(); return true; }
            return false;
        });
        column.addView(input, block(dp(20)));

        message = new TextView(this);
        message.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        message.setTextColor(getColor(R.color.expense));
        message.setVisibility(View.GONE);
        column.addView(message, block(dp(10)));

        connect = button(R.string.setup_connect, getColor(R.color.accent), 0xFF17150F);
        connect.setOnClickListener(v -> check());
        column.addView(connect, block(dp(18)));

        // Certificat inconnu : l'équivalent retenu de « Continuer quand même ».
        trust = button(R.string.setup_trust, ink, getColor(R.color.paper));
        trust.setVisibility(View.GONE);
        trust.setOnClickListener(v -> {
            String host = pendingUrl == null ? null : android.net.Uri.parse(pendingUrl).getHost();
            if (host == null) return;
            ServerPrefs.trustHost(this, host);
            check();
        });
        column.addView(trust, block(dp(10)));

        saveAnyway = button(R.string.setup_save_anyway, 0x00000000, ink);
        saveAnyway.setBackground(rounded(0x00000000, getColor(R.color.border), 999));
        saveAnyway.setVisibility(View.GONE);
        saveAnyway.setOnClickListener(v -> { if (pendingUrl != null) open(pendingUrl); });
        column.addView(saveAnyway, block(dp(10)));

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.addView(column);
        return scroll;
    }

    private void check() {
        java.util.List<String> candidates = ServerPrefs.candidates(input.getText().toString());
        saveAnyway.setVisibility(View.GONE);
        trust.setVisibility(View.GONE);
        if (candidates.isEmpty()) { showMessage(getString(R.string.setup_invalid)); return; }
        pendingUrl = candidates.get(0);
        connect.setEnabled(false);
        connect.setText(R.string.setup_checking);
        message.setVisibility(View.GONE);
        executor.execute(() -> {
            // Premier candidat qui répond « Suzanne » ; sinon, l'erreur du premier
            // (https) — la plus parlante quand on a tapé un nom de domaine.
            Probe first = null;
            for (String candidate : candidates) {
                Probe result = probe(candidate);
                if (result.ok) { first = result; break; }
                if (first == null) first = result;
            }
            Probe outcome = first;
            runOnUiThread(() -> {
                connect.setEnabled(true);
                connect.setText(R.string.setup_connect);
                if (outcome.ok) { open(outcome.url); return; }
                pendingUrl = outcome.url;
                input.setText(outcome.url);
                if (outcome.ssl) {
                    showMessage(getString(R.string.setup_trust_explain));
                    trust.setVisibility(View.VISIBLE);
                } else {
                    showMessage(outcome.error);
                    saveAnyway.setVisibility(View.VISIBLE);
                }
            });
        });
    }

    /** Résultat d'une vérification : adresse finale (redirections suivies) et erreur éventuelle. */
    private static final class Probe {
        final boolean ok; final String url; final String error; boolean ssl;
        Probe(boolean ok, String url, String error) { this.ok = ok; this.url = url; this.error = error; }
    }

    /**
     * Le serveur sert-il Suzanne ? On regarde le manifeste de l'app web, puis la
     * page d'accueil (titre « Suzanne ») : l'un des deux suffit. Les
     * redirections sont suivies à la main (HttpURLConnection ne suit pas
     * http → https) et l'adresse finale est retenue.
     */
    private Probe probe(String url) {
        String base = ServerPrefs.base(url);
        Fetch manifest = fetch(base + "/manifest.webmanifest");
        if (manifest.exception != null) {
            if (manifest.ssl) {
                // Adresse https atteinte (redirection comprise) : c'est elle qu'on approuvera.
                String httpsBase = manifest.finalUrl != null ? manifest.finalUrl.replaceFirst("/manifest\\.webmanifest.*$", "") : base;
                Probe p = new Probe(false, httpsBase, getString(R.string.setup_ssl_failed, manifest.exception));
                p.ssl = true;
                return p;
            }
            return new Probe(false, base, getString(R.string.setup_unreachable, manifest.exception));
        }
        String finalBase = manifest.finalUrl != null ? manifest.finalUrl.replaceFirst("/manifest\\.webmanifest.*$", "") : base;
        if (manifest.code == 200 && manifest.body.contains("Suzanne")) return new Probe(true, finalBase, null);
        Fetch home = fetch(finalBase + "/");
        if (home.exception == null && home.code == 200 && home.body.contains("Suzanne")) {
            String homeBase = home.finalUrl != null ? ServerPrefs.base(home.finalUrl) : finalBase;
            return new Probe(true, homeBase, null);
        }
        // Explication la plus utile : code HTTP, redirection inattendue, page sans Suzanne.
        Fetch shown = manifest.code == 200 ? home : manifest;
        String detail;
        if (shown.exception != null) detail = shown.exception;
        else if (shown.code == 401 || shown.code == 403) detail = getString(R.string.setup_auth, shown.code);
        else if (shown.code != 200) detail = "HTTP " + shown.code + (shown.location != null ? " → " + shown.location : "");
        else detail = getString(R.string.setup_no_marker, shown.finalUrl);
        return new Probe(false, finalBase, getString(R.string.setup_not_suzanne, detail));
    }

    private static final class Fetch {
        int code; String body = ""; String finalUrl; String location; String exception; boolean ssl;
    }

    /** GET avec suivi des redirections (5 au plus), corps limité à 256 Ko. */
    private Fetch fetch(String start) {
        Fetch f = new Fetch();
        String current = start;
        for (int hop = 0; hop < 5; hop++) {
            HttpURLConnection connection = null;
            try {
                f.finalUrl = current;
                connection = (HttpURLConnection) new URL(current).openConnection();
                if (connection instanceof javax.net.ssl.HttpsURLConnection && ServerPrefs.isTrusted(this, new URL(current).getHost())) {
                    ((javax.net.ssl.HttpsURLConnection) connection).setSSLSocketFactory(ServerPrefs.lenientSocketFactory());
                }
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(8000);
                connection.setRequestProperty("User-Agent", "SuzanneAndroid");
                f.code = connection.getResponseCode();
                f.finalUrl = current;
                if (f.code >= 300 && f.code < 400) {
                    String location = connection.getHeaderField("Location");
                    if (location == null) return f;
                    f.location = location;
                    current = new URL(new URL(current), location).toString();
                    continue;
                }
                f.location = null;
                InputStream in = f.code >= 400 ? connection.getErrorStream() : connection.getInputStream();
                if (in != null) {
                    try (InputStream stream = in) {
                        ByteArrayOutputStream out = new ByteArrayOutputStream();
                        byte[] buffer = new byte[4096];
                        int n;
                        while ((n = stream.read(buffer)) > 0 && out.size() < 262144) out.write(buffer, 0, n);
                        f.body = out.toString("UTF-8");
                    }
                }
                return f;
            } catch (javax.net.ssl.SSLException e) {
                // Certificat non reconnu (ex. autorité locale de Caddy, `tls internal`).
                f.exception = getString(R.string.setup_ssl);
                f.ssl = true;
                return f;
            } catch (Exception e) {
                f.exception = e.getClass().getSimpleName() + (e.getMessage() != null ? " : " + e.getMessage() : "");
                return f;
            } finally {
                if (connection != null) connection.disconnect();
            }
        }
        return f;
    }

    private void open(String url) {
        ServerPrefs.set(this, url);
        Intent intent = new Intent(this, MainActivity.class);
        intent.setAction(MainActivity.ACTION_RELOAD);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
        startActivity(intent);
        finish();
    }

    private void showMessage(String text) {
        message.setText(text);
        message.setVisibility(View.VISIBLE);
    }

    private Button button(int label, int background, int textColor) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setTextColor(textColor);
        b.setMinHeight(dp(52));
        b.setStateListAnimator(null);
        b.setBackground(rounded(background, background, 999));
        return b;
    }

    private GradientDrawable rounded(int fill, int stroke, int radiusDp) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(fill);
        d.setCornerRadius(dp(radiusDp));
        d.setStroke(dp(1), stroke);
        return d;
    }

    private LinearLayout.LayoutParams block(int topMargin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        params.topMargin = topMargin;
        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
