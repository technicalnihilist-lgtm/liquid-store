package com.liquid.store;

import android.content.Context;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/**
 * A second catalogue, alongside F-Droid: apps that publish their own APK on
 * GitHub releases. The curated list ships in assets/github_apps.json - we only
 * add projects whose own authors publish their builds there.
 *
 * Entries come back as ordinary AppEntry objects carrying an absolute APK URL
 * and, where GitHub provides one, the asset's SHA-256, so the existing install
 * and verify path works untouched.
 */
public class GitHubSource {

    private static final String CURATED = "github_apps.json";
    private static final String CACHE = "github_cache.json";
    private static final long TTL = 6L * 60 * 60 * 1000;      // six hours
    private static final String UA = "LiquidStore/3.4";

    public static class Result {
        public final List<AppEntry> apps;
        public final boolean fromCache;
        public final String error;
        Result(List<AppEntry> a, boolean c, String e) { apps = a; fromCache = c; error = e; }
    }

    /** cache if fresh, otherwise fetch; never throws */
    public static Result load(Context ctx, boolean force) {
        if (!force) {
            Result c = readCache(ctx);
            if (c != null) return c;
        }
        try {
            List<AppEntry> fresh = fetchAll(ctx);
            writeCache(ctx, fresh);
            return new Result(fresh, false, "");
        } catch (Throwable t) {
            Result c = readCache(ctx);
            if (c != null) return c;                       // stale beats nothing
            return new Result(new ArrayList<AppEntry>(), false, msg(t));
        }
    }

    /** only what is on disk - safe to call on the UI thread at startup */
    public static List<AppEntry> cached(Context ctx) {
        Result c = readCache(ctx);
        return c == null ? new ArrayList<AppEntry>() : c.apps;
    }

    private static String msg(Throwable t) {
        return t == null ? "unknown" : (t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage());
    }

    // ---------- network ----------

    private static List<AppEntry> fetchAll(Context ctx) throws IOException {
        return fetchAll(parseCurated(ctx.getAssets().open(CURATED)));
    }

    /** package-private so the JVM test can drive it without a Context */
    static List<AppEntry> fetchAll(List<JsonObject> specs) throws IOException {
        List<AppEntry> out = new ArrayList<AppEntry>();
        for (JsonObject spec : specs) {
            try {
                AppEntry a = one(spec);
                if (a != null) out.add(a);
            } catch (Throwable ignored) {
                // one dead repo must not take the whole source down
            }
        }
        return out;
    }

    static AppEntry one(JsonObject spec) throws IOException {
        String repo = str(spec, "repo");
        if (repo.length() == 0) return null;
        JsonObject rel = getJson("https://api.github.com/repos/" + repo + "/releases/latest");
        if (rel == null || !rel.has("tag_name")) return null;

        JsonArray assets = rel.has("assets") && rel.get("assets").isJsonArray()
                ? rel.getAsJsonArray("assets") : new JsonArray();
        JsonObject apk = pickApk(assets);
        if (apk == null) return null;

        String owner = repo.indexOf('/') > 0 ? repo.substring(0, repo.indexOf('/')) : repo;
        AppEntry a = new AppEntry();
        a.pkg = str(spec, "package");
        a.name = str(spec, "name");
        a.summary = str(spec, "summary");
        a.category = str(spec, "category");
        a.author = owner;
        a.source = "https://github.com/" + repo;
        a.issues = a.source + "/issues";
        a.web = "";
        a.license = "";
        a.hasApk = true;
        a.apkName = str(apk, "name");
        a.versionName = str(rel, "tag_name");
        a.size = apk.has("size") ? apk.get("size").getAsLong() : 0;
        a.absApkUrl = str(apk, "browser_download_url");
        a.absIconUrl = "https://github.com/" + owner + ".png?size=200";
        a.lastUpdated = when(str(rel, "published_at"));
        a.added = a.lastUpdated;

        String digest = str(apk, "digest");                 // "sha256:abc..." when present
        if (digest.startsWith("sha256:")) {
            a.hash = digest.substring(7);
            a.hashType = "sha256";
        }

        String body = str(rel, "body");
        a.description = a.summary + "\n\nVersion " + a.versionName
                + (body.length() > 0 ? "\n\n" + trim(body, 1200) : "")
                + "\n\nInstalled from the project's own GitHub release.";
        return a;
    }

    /** prefers an arm64 or universal build, skips debug and emulator-only assets */
    static JsonObject pickApk(JsonArray assets) {
        JsonObject best = null;
        int bestScore = Integer.MIN_VALUE;
        for (JsonElement e : assets) {
            if (!e.isJsonObject()) continue;
            JsonObject o = e.getAsJsonObject();
            String n = str(o, "name").toLowerCase(Locale.US);
            if (!n.endsWith(".apk")) continue;
            int score = 0;
            if (n.contains("arm64") || n.contains("aarch64")) score += 5;
            if (n.contains("universal")) score += 4;
            if (n.contains("release")) score += 2;
            if (n.contains("free")) score += 2;
            if (n.contains("debug")) score -= 6;
            if (n.contains("x86") || n.contains("emu")) score -= 4;
            if (score > bestScore) { bestScore = score; best = o; }
        }
        return best;
    }

    private static JsonObject getJson(String url) throws IOException {
        HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
        h.setConnectTimeout(10000);
        h.setReadTimeout(15000);
        h.setRequestProperty("User-Agent", UA);
        h.setRequestProperty("Accept", "application/vnd.github+json");
        try {
            int code = h.getResponseCode();
            if (code != 200) throw new IOException("HTTP " + code);
            InputStream in = new BufferedInputStream(h.getInputStream(), 1 << 14);
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            try {
                byte[] b = new byte[1 << 14];
                int n;
                while ((n = in.read(b)) > 0) bo.write(b, 0, n);
            } finally { try { in.close(); } catch (IOException ignored) { } }
            JsonElement e = JsonParser.parseString(bo.toString("UTF-8"));
            return e.isJsonObject() ? e.getAsJsonObject() : null;
        } finally {
            h.disconnect();
        }
    }

    // ---------- helpers ----------

    private static List<JsonObject> curated(Context ctx) {
        try {
            return parseCurated(ctx.getAssets().open(CURATED));
        } catch (Throwable t) {
            return new ArrayList<JsonObject>();
        }
    }

    static List<JsonObject> parseCurated(InputStream in) {
        List<JsonObject> out = new ArrayList<JsonObject>();
        try {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] b = new byte[1 << 13];
            int n;
            while ((n = in.read(b)) > 0) bo.write(b, 0, n);
            JsonElement e = JsonParser.parseString(bo.toString("UTF-8"));
            if (e.isJsonArray()) {
                for (JsonElement x : e.getAsJsonArray())
                    if (x.isJsonObject()) out.add(x.getAsJsonObject());
            }
        } catch (Throwable ignored) {
        } finally { try { if (in != null) in.close(); } catch (IOException ignored) { } }
        return out;
    }

    private static long when(String iso) {
        if (iso == null || iso.length() < 19) return System.currentTimeMillis();
        try {
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
            f.setTimeZone(TimeZone.getTimeZone("UTC"));
            return f.parse(iso.substring(0, 19)).getTime();
        } catch (Throwable t) {
            return System.currentTimeMillis();
        }
    }

    private static String trim(String s, int max) {
        String t = s == null ? "" : s.trim();
        return t.length() <= max ? t : t.substring(0, max) + "\u2026";
    }

    private static String str(JsonObject o, String k) {
        try {
            return o != null && o.has(k) && !o.get(k).isJsonNull() ? o.get(k).getAsString() : "";
        } catch (Throwable t) { return ""; }
    }

    // ---------- cache ----------

    static File cacheFile(File dir) { return new File(dir, CACHE); }

    private static Result readCache(Context ctx) {
        return readCache(ctx.getFilesDir());
    }

    static Result readCache(File dir) {
        File f = cacheFile(dir);
        if (!f.isFile() || f.length() == 0) return null;
        InputStream in = null;
        try {
            in = new BufferedInputStream(new FileInputStream(f));
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] b = new byte[1 << 13];
            int n;
            while ((n = in.read(b)) > 0) bo.write(b, 0, n);
            JsonObject root = JsonParser.parseString(bo.toString("UTF-8")).getAsJsonObject();
            long fetched = root.has("fetched") ? root.get("fetched").getAsLong() : 0;
            boolean fresh = System.currentTimeMillis() - fetched < TTL;
            List<AppEntry> list = new ArrayList<AppEntry>();
            if (root.has("apps")) {
                for (JsonElement e : root.getAsJsonArray("apps")) {
                    if (!e.isJsonObject()) continue;
                    JsonObject o = e.getAsJsonObject();
                    AppEntry a = new AppEntry();
                    a.pkg = str(o, "pkg"); a.name = str(o, "name");
                    a.summary = str(o, "summary"); a.description = str(o, "description");
                    a.category = str(o, "category"); a.author = str(o, "author");
                    a.source = str(o, "source"); a.issues = str(o, "issues");
                    a.versionName = str(o, "versionName"); a.apkName = str(o, "apkName");
                    a.absApkUrl = str(o, "absApkUrl"); a.absIconUrl = str(o, "absIconUrl");
                    a.hash = str(o, "hash"); a.hashType = str(o, "hashType");
                    a.size = o.has("size") ? o.get("size").getAsLong() : 0;
                    a.lastUpdated = o.has("lastUpdated") ? o.get("lastUpdated").getAsLong() : 0;
                    a.added = a.lastUpdated;
                    a.hasApk = a.absApkUrl.length() > 0;
                    if (a.pkg.length() > 0) list.add(a);
                }
            }
            if (!fresh) return null;
            return new Result(list, true, "");
        } catch (Throwable t) {
            return null;
        } finally { try { if (in != null) in.close(); } catch (IOException ignored) { } }
    }

    private static void writeCache(Context ctx, List<AppEntry> apps) {
        writeCache(ctx.getFilesDir(), apps);
    }

    static void writeCache(File dir, List<AppEntry> apps) {
        File f = cacheFile(dir);
        File tmp = new File(f.getPath() + ".part");
        OutputStream out = null;
        try {
            StringBuilder sb = new StringBuilder();
            sb.append("{\"fetched\":").append(System.currentTimeMillis()).append(",\"apps\":[");
            for (int i = 0; i < apps.size(); i++) {
                AppEntry a = apps.get(i);
                if (i > 0) sb.append(',');
                sb.append('{');
                field(sb, "pkg", a.pkg, true);
                field(sb, "name", a.name, false);
                field(sb, "summary", a.summary, false);
                field(sb, "description", a.description, false);
                field(sb, "category", a.category, false);
                field(sb, "author", a.author, false);
                field(sb, "source", a.source, false);
                field(sb, "issues", a.issues, false);
                field(sb, "versionName", a.versionName, false);
                field(sb, "apkName", a.apkName, false);
                field(sb, "absApkUrl", a.absApkUrl, false);
                field(sb, "absIconUrl", a.absIconUrl, false);
                field(sb, "hash", a.hash, false);
                field(sb, "hashType", a.hashType, false);
                sb.append(",\"size\":").append(a.size);
                sb.append(",\"lastUpdated\":").append(a.lastUpdated);
                sb.append('}');
            }
            sb.append("]}");
            out = new FileOutputStream(tmp);
            out.write(sb.toString().getBytes("UTF-8"));
            out.flush();
            try { out.close(); } catch (IOException ignored) { }
            out = null;
            if (f.exists() && !f.delete()) { /* replaced by rename below */ }
            if (!tmp.renameTo(f)) throw new IOException("could not store cache");
        } catch (Throwable ignored) {
            try { if (out != null) out.close(); } catch (IOException ignored2) { }
            if (tmp.exists()) tmp.delete();
        }
    }

    private static void field(StringBuilder sb, String k, String v, boolean first) {
        if (!first) sb.append(',');
        sb.append('"').append(k).append("\":\"").append(escape(v)).append('"');
    }

    private static String escape(String s) {
        if (s == null) return "";
        StringBuilder b = new StringBuilder(s.length() + 8);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format(Locale.US, "\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.toString();
    }
}
