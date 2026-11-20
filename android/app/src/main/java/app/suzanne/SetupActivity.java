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
        String url = ServerPrefs.normalize(input.getText().toString());
        saveAnyway.setVisibility(View.GONE);
        if (url == null) { showMessage(getString(R.string.setup_invalid)); return; }
        input.setText(url);
        pendingUrl = url;
        connect.setEnabled(false);
        connect.setText(R.string.setup_checking);
        message.setVisibility(View.GONE);
        executor.execute(() -> {
            String error = probe(url);
            runOnUiThread(() -> {
                connect.setEnabled(true);
                connect.setText(R.string.setup_connect);
                if (error == null) { open(url); return; }
                showMessage(error);
                saveAnyway.setVisibility(View.VISIBLE);
            });
        });
    }

    /** null si le serveur répond et sert bien Suzanne ; sinon le message d'erreur. */
    private String probe(String url) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url + "/manifest.webmanifest").openConnection();
            connection.setConnectTimeout(6000);
            connection.setReadTimeout(6000);
            int code = connection.getResponseCode();
            if (code != 200) return getString(R.string.setup_not_suzanne);
            try (InputStream in = connection.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buffer = new byte[4096];
                int n;
                while ((n = in.read(buffer)) > 0 && out.size() < 65536) out.write(buffer, 0, n);
                return out.toString("UTF-8").contains("Suzanne") ? null : getString(R.string.setup_not_suzanne);
            }
        } catch (Exception e) {
            String reason = e.getClass().getSimpleName() + (e.getMessage() != null ? " : " + e.getMessage() : "");
            return getString(R.string.setup_unreachable, reason);
        } finally {
            if (connection != null) connection.disconnect();
        }
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
