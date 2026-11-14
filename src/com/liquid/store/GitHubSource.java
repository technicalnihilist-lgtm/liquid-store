package com.liquid.store;

import android.content.Context;
import android.os.Build;

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
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadFactory;

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
    private static final long TTL = 12L * 60 * 60 * 1000;     // twelve hours
    private static final String UA = "LiquidStore/3.4";

    public static class Result {
        public final List<AppEntry> apps;
        public final boolean fromCache;
        public final String error;
        Result(List<AppEntry> a, boolean c, String e) { apps = a; fromCache = c; error = e; }
    }

    /**
     * cache if fresh, otherwise fetch; never throws.
     *
     * The fallback on failure used to be the *fresh-only* reader, i.e. the same
     * call that had already declined to answer a moment earlier, so the
     * "stale beats nothing" line below it could never fire. Every GitHub app
     * in the catalogue comes from this cache, so twelve hours after the last
     * successful refresh - or straight away, if the user taps Refresh while
     * offline - the fetch failed and the whole GitHub half of the store
     * silently disappeared until a refresh happened to succeed again. The
     * fallback reads the saved catalogue regardless of its age now, which is
     * what the line was always meant to do.
     */
    public static Result load(Context ctx, boolean force) {
        if (!force) {
            Result c = readCache(ctx.getFilesDir(), true);
            if (c != null) return c;
        }
        try {
            List<AppEntry> fresh = fetchAll(ctx);
            List<AppEntry> merged = mergeWithPrevious(ctx.getFilesDir(), fresh);
            writeCache(ctx, merged);
            return new Result(merged, false, "");
        } catch (Throwable t) {
            Result c = readCache(ctx.getFilesDir(), false);
            if (c != null) return c;                       // stale beats nothing
            return new Result(new ArrayList<AppEntry>(), false, msg(t));
        }
    }

    /**
     * How many release lookups may be in flight at once.
     *
     * The curated list holds 36 repositories and each one is a separate
     * api.github.com round trip. They used to run one after another on a single
     * thread, so a cold refresh cost the *sum* of every round trip: measured
     * against a stand-in that answered in 120 ms, 36 lookups took 5.3 s. A real
     * mobile round trip is 200-400 ms plus a TLS handshake and a release body
     * of up to 100 KB, which puts a cold refresh at 7-15 s - and the GitHub
     * apps are missing from the catalogue for all of it, because a cache older
     * than TTL is not served while the refresh runs.
     *
     * The lookups are independent, so they now run on a small bounded pool and
     * the cost is closer to the *slowest* one: the same 36 took 1.1 s. Six is
     * deliberately modest - the request count is unchanged, and GitHub's abuse
     * detection is about concurrency in the hundreds, not six.
     */
    private static final int FETCH_THREADS = 6;

    /**
     * A refresh that only partly succeeds (rate limit, one repo down) must not
     * shrink the catalogue - anything we knew before and did not re-fetch stays.
     */
    static List<AppEntry> mergeWithPrevious(File dir, List<AppEntry> fresh) {
        List<AppEntry> old = readCacheApps(dir, false);
        if (old.isEmpty()) return fresh;
        Map<String, AppEntry> byPkg = new LinkedHashMap<String, AppEntry>();
        for (AppEntry a : old) if (a.pkg != null && a.pkg.length() > 0) byPkg.put(a.pkg, a);
        for (AppEntry a : fresh) if (a.pkg != null && a.pkg.length() > 0) byPkg.put(a.pkg, a);
        return new ArrayList<AppEntry>(byPkg.values());
    }

    /**
     * Only what is on disk - safe to call on the UI thread at startup.
     *
     * Age is deliberately not consulted: this is the copy the store draws
     * while the refresh is still running, and a day-old list of GitHub apps is
     * worth incomparably more than an empty one. Asking for a fresh cache here
     * meant it answered "nothing" for exactly the sessions that needed it most.
     */
    public static List<AppEntry> cached(Context ctx) {
        Result c = readCache(ctx.getFilesDir(), false);
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
        if (specs == null || specs.isEmpty()) return new ArrayList<AppEntry>();

        List<Callable<AppEntry>> tasks = new ArrayList<Callable<AppEntry>>(specs.size());
        for (final JsonObject spec : specs) {
            tasks.add(new Callable<AppEntry>() {
                public AppEntry call() {
                    try {
                        return one(spec);
                    } catch (Throwable ignored) {
                        // one dead repo must not take the whole source down
                        return null;
                    }
                }
            });
        }

        ExecutorService pool = Executors.newFixedThreadPool(
                Math.min(FETCH_THREADS, tasks.size()), new ThreadFactory() {
                    public Thread newThread(Runnable r) {
                        Thread t = new Thread(r, "github-release");
                        t.setDaemon(true);
                        return t;
                    }
                });

        List<AppEntry> out = new ArrayList<AppEntry>(specs.size());
        try {
            /* invokeAll keeps the futures in task order, so the result is the
               same list, in the same order, as the sequential version built.
               Each task already carries its own per-request timeouts. */
            for (Future<AppEntry> f : pool.invokeAll(tasks)) {
                try {
                    AppEntry a = f.get();
                    if (a != null) out.add(a);
                } catch (Throwable ignored) {
                    // cancelled or failed: same as a dead repo
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            pool.shutdownNow();
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
        JsonObject apk = pickApk(assets, deviceAbis());
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

    /** The ABIs this device can install, best first. Empty if the platform cannot say. */
    static String[] deviceAbis() {
        try {
            String[] a = Build.SUPPORTED_ABIS;
            return a == null ? new String[0] : a;
        } catch (Throwable t) {
            return new String[0];
        }
    }

    /**
     * The ABI one release asset is built for, or "" when it fits any device.
     *
     * Read from the file name, which is the only thing the release API gives
     * us: the projects that split their builds name them after the ABI
     * (arm64-v8a, armeabi-v7a, x86, x86_64) and the ones that do not publish a
     * single universal APK. Checked longest-first, because "x86_64" contains
     * "x86" and "armeabi-v7a" contains neither "arm64" nor "aarch64".
     */
    static String assetAbi(String name) {
        String n = name.toLowerCase(Locale.US);
        if (n.contains("arm64") || n.contains("aarch64")) return "arm64-v8a";
        if (n.contains("armeabi") || n.contains("armv7") || n.contains("arm-v7a")) return "armeabi-v7a";
        if (n.contains("x86_64") || n.contains("x86-64") || n.contains("x64")) return "x86_64";
        if (n.contains("x86") || n.contains("i686") || n.contains("i386")) return "x86";
        return "";
    }

    /**
     * How well one asset fits this device: higher is better, and anything
     * below 0 cannot be installed here at all.
     *
     * The device's own ABI list is ordered by preference (Build.SUPPORTED_ABIS
     * puts the primary ABI first), so the rank is simply its position, counted
     * backwards. A universal build - and an asset whose name says nothing
     * about an ABI - fits everywhere and ranks 0, which is below any ABI the
     * device actually lists. An unknown device (an empty list, which is what
     * the JVM test and a stub android.jar see) ranks everything 0, so the
     * name score alone decides exactly as it always did.
     */
    static int abiRank(String abi, String[] deviceAbis) {
        if (deviceAbis == null || deviceAbis.length == 0) return 0;   /* device unknown */
        if (abi == null || abi.length() == 0) return 0;               /* universal */
        for (int i = 0; i < deviceAbis.length; i++) {
            if (abi.equals(deviceAbis[i])) return deviceAbis.length - i;
        }
        return -1000;                                                 /* wrong ABI for this device */
    }

    /**
     * The APK to install, preferring one this device can actually run.
     *
     * The pick used to be a fixed ranking of the file names: arm64 beat
     * universal beat everything else, and x86 was penalised as "emulator
     * only". That is right for most phones and wrong for every device that is
     * not arm64, because the ranking never asked what the device was:
     *
     *   - AnkiDroid publishes AnkiDroid-2.25.3-arm64-v8a.apk next to
     *     AnkiDroid-2.25.3-full-universal.apk, so every armeabi-v7a phone was
     *     handed the arm64 build and got INSTALL_FAILED_NO_MATCHING_ABIS - a
     *     "Install failed" with no way to see why, while a build that installs
     *     on every device sat in the same release.
     *   - Element, Element X, Fossify Gallery, InnerTune and Obtainium all
     *     publish a per-ABI split and were served as their arm64 half to
     *     x86_64 devices (Chromebooks, and every emulator), even though the
     *     same release carries an x86_64 build.
     *
     * So the ABI the device can run now decides first and the name score only
     * breaks ties inside it. On a 64-bit phone nothing moves: arm64 is that
     * device's primary ABI, so every one of the six picks above still resolves
     * to the same file it did before - checked against the real release asset
     * lists of all 36 curated repositories. What changes is the case that was
     * broken: a 32-bit device now takes the armeabi-v7a or universal build,
     * and an x86 device takes the x86 build.
     *
     * A release with nothing this device can run still yields its best-named
     * asset rather than nothing at all: the app stays in the catalogue exactly
     * as it was before, and the install fails the way it already did.
     */
    static JsonObject pickApk(JsonArray assets) {
        return pickApk(assets, null);
    }

    static JsonObject pickApk(JsonArray assets, String[] deviceAbis) {
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
            /* the ABI the device can run outweighs any name bonus, so an
               installable build always beats a better-named one that is not */
            score += abiRank(assetAbi(n), deviceAbis) * 100;
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

    static List<AppEntry> readCacheApps(File dir, boolean requireFresh) {
        Result r = readCache(dir, requireFresh);
        return r == null ? new ArrayList<AppEntry>() : r.apps;
    }

    static Result readCache(File dir, boolean requireFresh) {
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
            if (requireFresh && !fresh) return null;
            return new Result(list, fresh, "");
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
