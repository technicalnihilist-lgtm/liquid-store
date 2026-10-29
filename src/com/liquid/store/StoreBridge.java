package com.liquid.store;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.google.gson.stream.JsonWriter;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.StringWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Everything the store UI is allowed to do, exposed to JavaScript as
 * window.Android. Catalogue reads are synchronous (in-memory); network work
 * and installs run on a small pool and report back by calling
 * window.__store(...) in the page.
 */
public class StoreBridge {

    static volatile StoreBridge INSTANCE;

    private final Context ctx;
    private final WebView web;
    private final ExecutorService io = Executors.newFixedThreadPool(3);
    private final Handler main = new Handler(Looper.getMainLooper());
    private final File workDir;

    private volatile IndexLoader.Repo repo;
    /** swapped wholesale as batches arrive, so readers always see a whole catalogue */
    private volatile Map<String, AppEntry> index = new HashMap<String, AppEntry>();
    private volatile boolean partial;
    /** GitHub-release apps, merged into the live index on every publish */
    private volatile Map<String, AppEntry> ghApps = new HashMap<String, AppEntry>();
    private volatile List<AppEntry> lastApps = new ArrayList<AppEntry>();
    private volatile String phase = "idle";
    private volatile int pct = 0;
    private volatile String detail = "not loaded";
    private volatile String error;
    private volatile boolean cancelRequested;

    /** swapped wholesale on refresh, so readers never see a half-built map */
    private volatile Map<String, Long> installed = new HashMap<String, Long>();
    private volatile long installedAt;

    // install state
    private volatile String insPkg;
    private volatile String insPhase = "idle";
    private volatile int insPct;
    private volatile long insGot, insTotal;
    private volatile String insError;
    private volatile int sessionId = -1;

    StoreBridge(Context ctx, WebView web) {
        this.ctx = ctx;
        this.web = web;
        this.workDir = new File(ctx.getFilesDir(), "repo");
        INSTANCE = this;
    }

    // ------------------------------------------------------------ catalogue

    @JavascriptInterface
    public String state() {
        StringWriter sw = new StringWriter();
        JsonWriter w = new JsonWriter(sw);
        try {
            w.beginObject();
            w.name("phase").value(phase);
            w.name("pct").value(pct);
            w.name("detail").value(detail == null ? "" : detail);
            w.name("error").value(error == null ? "" : error);
            w.name("count").value(index.size());
            w.name("partial").value(partial);
            w.name("repo").value(repo == null ? "F-Droid" : repo.name);
            w.name("address").value(base());
            w.name("canonical").value(canonical());
            w.name("timestamp").value(repo == null ? 0 : repo.timestamp);
            w.endObject();
            w.close();
        } catch (IOException ignored) {
        }
        return sw.toString();
    }

    @JavascriptInterface
    public void load(final boolean force) {
        if ("probe".equals(phase) || "download".equals(phase) || "apps".equals(phase)) return;
        phase = "probe";
        pct = 0;
        detail = "looking for the fastest source";
        error = null;
        cancelRequested = false;
        push("state");
        /* GitHub apps first, from disk - instant, and they show up straight away */
        try { applyGithub(GitHubSource.cached(ctx)); } catch (Throwable ignored) { }
        io.execute(new Runnable() {
            public void run() {
                try { applyGithub(GitHubSource.load(ctx, force).apps); } catch (Throwable ignored) { }
            }
        });
        final List<String> sources = mirrors();
        io.execute(new Runnable() {
            public void run() {
                try {
                    IndexLoader.Repo r = IndexLoader.load(workDir, sources, force,
                            new IndexLoader.Progress() {
                                public void onPhase(String p, int c, String d) {
                                    phase = p;
                                    pct = c;
                                    detail = d;
                                    push("state");
                                }

                                public void onApps(List<AppEntry> apps) {
                                    publish(apps, true);
                                }
                            },
                            new IndexLoader.Cancel() {
                                public boolean cancelled() { return cancelRequested; }
                            });
                    publish(r.apps, false);
                    repo = r;
                    phase = "ready";
                    pct = 100;
                    detail = r.apps.size() + " apps";
                    refreshInstalled(true);
                    push("ready");
                } catch (Exception ex) {
                    boolean wasCancelled = cancelRequested;
                    cancelRequested = false;
                    if (wasCancelled) {
                        phase = index.isEmpty() ? "idle" : "ready";
                        detail = index.isEmpty() ? "cancelled" : index.size() + " apps";
                    } else {
                        phase = "error";
                        error = String.valueOf(ex.getMessage());
                        detail = "could not load the catalogue";
                    }
                    push("state");
                }
            }
        });
    }

    @JavascriptInterface
    public void cancelLoad() {
        cancelRequested = true;
        phase = index.isEmpty() ? "idle" : "ready";
        detail = index.isEmpty() ? "cancelled" : index.size() + " apps";
        push("state");
    }

    /** The mirror list, with whatever the user has chosen shown separately. */
    @JavascriptInterface
    public String sources() {
        String custom = prefs().getString("source", "");
        StringWriter sw = new StringWriter();
        JsonWriter w = new JsonWriter(sw);
        try {
            w.beginObject();
            w.name("custom").value(custom == null ? "" : custom);
            w.name("current").value(base());
            w.name("list").beginArray();
            for (String m : IndexLoader.DEFAULT_MIRRORS) {
                w.beginObject();
                w.name("url").value(m);
                w.name("host").value(IndexLoader.host(m));
                w.endObject();
            }
            w.endArray();
            w.endObject();
            w.close();
        } catch (IOException ignored) {
        }
        return sw.toString();
    }

    @JavascriptInterface
    public void setSource(String url) {
        String u = url == null ? "" : url.trim();
        if (u.length() > 0) {
            if (!u.startsWith("http://") && !u.startsWith("https://")) u = "https://" + u;
            while (u.endsWith("/")) u = u.substring(0, u.length() - 1);
        }
        prefs().edit().putString("source", u).apply();
    }

    private android.content.SharedPreferences prefs() {
        return ctx.getSharedPreferences("liquid", Context.MODE_PRIVATE);
    }

    /** If the user picked a source, use only it; otherwise race the official mirrors. */
    private List<String> mirrors() {
        String custom = prefs().getString("source", "");
        if (custom != null && custom.trim().length() > 0) {
            List<String> only = new ArrayList<String>();
            only.add(custom.trim());
            return only;
        }
        List<String> out = new ArrayList<String>();
        for (String m : IndexLoader.DEFAULT_MIRRORS) out.add(m);
        return out;
    }

    /** Publish everything parsed so far so the store can fill in as it streams. */
    private void publish(List<AppEntry> apps, boolean isPartial) {
        Map<String, AppEntry> m = new HashMap<String, AppEntry>(Math.max(16, apps.size() * 2));
        for (AppEntry a : apps) {
            if (a.pkg != null) m.put(a.pkg, a);
        }
        lastApps = apps;
        m.putAll(ghApps);
        index = m;
        partial = isPartial;
        push("apps");
    }

    /** swap in the GitHub catalogue and republish without a full reload */
    private void applyGithub(List<AppEntry> apps) {
        Map<String, AppEntry> m = new HashMap<String, AppEntry>();
        for (AppEntry a : apps) {
            if (a != null && a.pkg != null && a.pkg.length() > 0) m.put(a.pkg, a);
        }
        ghApps = m;
        publish(lastApps, partial);
    }

    private List<AppEntry> all() {
        List<AppEntry> l = new ArrayList<AppEntry>(index.values());
        Collections.sort(l, new Comparator<AppEntry>() {
            public int compare(AppEntry a, AppEntry b) {
                return a.displayName().compareToIgnoreCase(b.displayName());
            }
        });
        return l;
    }

    private List<AppEntry> query(String q, String cat, String sort) {
        List<AppEntry> out = new ArrayList<AppEntry>();
        String needle = q == null ? "" : q.trim().toLowerCase(Locale.US);
        String category = cat == null ? "" : cat.trim();
        for (AppEntry a : index.values()) {
            if (category.length() > 0 && !category.equalsIgnoreCase(a.category)) continue;
            if (needle.length() > 0) {
                String hay = (a.displayName() + " " + a.pkg + " " + a.summary + " " + a.category).toLowerCase(Locale.US);
                if (!hay.contains(needle)) continue;
            }
            out.add(a);
        }
        final String s = sort == null ? "relevance" : sort;
        Collections.sort(out, new Comparator<AppEntry>() {
            public int compare(AppEntry a, AppEntry b) {
                if ("updated".equals(s)) return Long.compare(b.lastUpdated, a.lastUpdated);
                if ("size".equals(s)) return Long.compare(b.size, a.size);
                if ("new".equals(s)) return Long.compare(b.added, a.added);
                if ("name".equals(s)) return a.displayName().compareToIgnoreCase(b.displayName());
                // relevance: shorter names first, then alphabetical
                int c = Integer.compare(a.displayName().length(), b.displayName().length());
                return c != 0 ? c : a.displayName().compareToIgnoreCase(b.displayName());
            }
        });
        return out;
    }

    @JavascriptInterface
    public String list(String q, String cat, String sort, int offset, int limit) {
        List<AppEntry> hits = query(q, cat, sort);
        if (offset < 0) offset = 0;
        if (limit <= 0) limit = 40;
        int end = Math.min(hits.size(), offset + limit);
        List<AppEntry> page = offset >= hits.size()
                ? new ArrayList<AppEntry>() : hits.subList(offset, end);
        return writeApps(page, hits.size());
    }

    @JavascriptInterface
    public String categories() {
        Map<String, Integer> counts = new HashMap<String, Integer>();
        for (AppEntry a : index.values()) {
            if (a.category == null || a.category.length() == 0) continue;
            Integer c = counts.get(a.category);
            counts.put(a.category, c == null ? 1 : c + 1);
        }
        List<String> names = new ArrayList<String>(counts.keySet());
        Collections.sort(names, new Comparator<String>() {
            public int compare(String a, String b) {
                return counts.get(b).compareTo(counts.get(a));
            }
        });
        StringWriter sw = new StringWriter();
        JsonWriter w = new JsonWriter(sw);
        try {
            w.beginArray();
            for (String n : names) {
                w.beginObject();
                w.name("name").value(n);
                w.name("count").value(counts.get(n));
                w.endObject();
            }
            w.endArray();
            w.close();
        } catch (IOException ignored) {
        }
        return sw.toString();
    }

    @JavascriptInterface
    public String stats() {
        int games = 0, apps = 0;
        Set<String> cats = new HashSet<String>();
        for (AppEntry a : index.values()) {
            if ("Games".equalsIgnoreCase(a.category)) games++;
            else apps++;
            if (a.category != null && a.category.length() > 0) cats.add(a.category);
        }
        StringWriter sw = new StringWriter();
        JsonWriter w = new JsonWriter(sw);
        try {
            w.beginObject();
            w.name("apps").value(apps);
            w.name("games").value(games);
            w.name("categories").value(cats.size());
            w.name("total").value(index.size());
            w.endObject();
            w.close();
        } catch (IOException ignored) {
        }
        return sw.toString();
    }

    @JavascriptInterface
    public String detail(String pkg) {
        AppEntry a = index.get(pkg);
        if (a == null) return "{}";
        refreshInstalled(false);
        StringWriter sw = new StringWriter();
        JsonWriter w = new JsonWriter(sw);
        try {
            w.beginObject();
            w.name("pkg").value(a.pkg);
            w.name("name").value(a.displayName());
            w.name("summary").value(nz(a.summary));
            w.name("description").value(nz(a.description));
            w.name("category").value(nz(a.category));
            w.name("license").value(nz(a.license));
            w.name("author").value(nz(a.author));
            w.name("source").value(nz(a.source));
            w.name("issues").value(nz(a.issues));
            w.name("web").value(nz(a.web));
            w.name("version").value(nz(a.versionName));
            w.name("versionCode").value(a.versionCode);
            w.name("size").value(a.size);
            w.name("sizeText").value(IndexLoader.human(a.size));
            w.name("minSdk").value(a.minSdk);
            w.name("updated").value(a.lastUpdated);
            w.name("icon").value(iconUrl(a));
            writeStrings(w, "iconCand", iconCandidates(a));
            w.name("apkUrl").value(installUrl(a));
            // NOTE: JsonWriter forbids name() inside an array - the candidate
            // lists must be anonymous nested arrays.
            w.name("shots").beginArray();
            for (int si = 0; si < a.shots.size(); si++) {
                w.beginArray();
                for (String u : shotCandidates(a, si, a.shots.get(si))) w.value(u);
                w.endArray();
            }
            w.endArray();
            writeInstalled(w, a);
            w.endObject();
            w.close();
        } catch (IOException ignored) {
        }
        return sw.toString();
    }

    private String writeApps(List<AppEntry> page, int total) {
        refreshInstalled(false);
        StringWriter sw = new StringWriter();
        JsonWriter w = new JsonWriter(sw);
        try {
            w.beginObject();
            w.name("total").value(total);
            w.name("apps").beginArray();
            for (AppEntry a : page) {
                w.beginObject();
                w.name("pkg").value(a.pkg);
                w.name("name").value(a.displayName());
                w.name("sum").value(nz(a.summary));
                w.name("cat").value(nz(a.category));
                w.name("ver").value(nz(a.versionName));
                w.name("sizeText").value(IndexLoader.human(a.size));
                w.name("icon").value(iconUrl(a));
                writeStrings(w, "iconCand", iconCandidates(a));
                w.name("updated").value(a.lastUpdated);
                writeInstalled(w, a);
                w.endObject();
            }
            w.endArray();
            w.endObject();
            w.close();
        } catch (IOException ignored) {
        }
        return sw.toString();
    }

    private void writeInstalled(JsonWriter w, AppEntry a) throws IOException {
        Long v = installed.get(a.pkg);
        boolean isIn = v != null;
        w.name("installed").value(isIn);
        w.name("installedVer").value(isIn ? v.longValue() : 0);
        w.name("hasUpdate").value(isIn && a.versionCode > v.longValue());
    }

    private String iconUrl(AppEntry a) {
        if (a.absIconUrl != null && a.absIconUrl.length() > 0) return a.absIconUrl;
        if (a.icon == null || a.icon.length() == 0) return "";
        return base() + "/" + a.icon;
    }

    /**
     * Every URL shape an icon might live at, best first. F-Droid's v1 index
     * names a file at the repo root; the site also serves a per-app layout.
     */
    private List<String> iconCandidates(AppEntry a) {
        List<String> out = new ArrayList<String>(4);
        String b = base(), c = canonical();
        if (a.icon != null && a.icon.length() > 0) {
            out.add(b + "/" + a.icon);
            if (!c.equals(b)) out.add(c + "/" + a.icon);
        }
        out.add(b + "/" + a.pkg + "/en-US/icon.png");
        if (!c.equals(b)) out.add(c + "/" + a.pkg + "/en-US/icon.png");
        return dedupe(out);
    }

    private List<String> shotCandidates(AppEntry a, int index, String file) {
        List<String> out = new ArrayList<String>(4);
        String b = base(), c = canonical();
        if (file != null && file.length() > 0) {
            out.add(b + "/" + file);
            if (!c.equals(b)) out.add(c + "/" + file);
        }
        out.add(b + "/" + a.pkg + "/en-US/phoneScreenshots/" + (index + 1) + ".png");
        if (!c.equals(b)) out.add(c + "/" + a.pkg + "/en-US/phoneScreenshots/" + (index + 1) + ".png");
        return dedupe(out);
    }

    private static List<String> dedupe(List<String> in) {
        List<String> out = new ArrayList<String>(in.size());
        for (String u : in) if (u != null && u.length() > 0 && !out.contains(u)) out.add(u);
        return out;
    }

    private void writeStrings(JsonWriter w, String name, List<String> xs) throws IOException {
        w.name(name).beginArray();
        for (String x : xs) w.value(x);
        w.endArray();
    }

    private String installUrl(AppEntry a) {
        if (a.absApkUrl != null && a.absApkUrl.length() > 0) return a.absApkUrl;
        return base() + "/" + a.apkName;
    }

    /** The mirror that actually answered - icons and APKs must come from it. */
    private String base() {
        String b = repo == null ? "" : repo.baseUrl;
        if (b == null || b.length() == 0) b = repo == null ? "" : repo.address;
        if (b == null || b.length() == 0) b = IndexLoader.DEFAULT_MIRRORS[0];
        return trimSlash(b);
    }

    private String canonical() {
        String b = repo == null ? "" : repo.address;
        if (b == null || b.length() == 0) b = IndexLoader.DEFAULT_MIRRORS[0];
        return trimSlash(b);
    }

    private static String trimSlash(String b) {
        while (b.endsWith("/")) b = b.substring(0, b.length() - 1);
        return b;
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    // ------------------------------------------------------------ installed

    private void refreshInstalled(boolean force) {
        long now = System.currentTimeMillis();
        if (!force && now - installedAt < 8000) return;
        installedAt = now;
        try {
            PackageManager pm = ctx.getPackageManager();
            List<PackageInfo> ps = pm.getInstalledPackages(0);
            Map<String, Long> m = new HashMap<String, Long>();
            for (PackageInfo pi : ps) {
                long vc = Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
                m.put(pi.packageName, vc);
            }
            installed = m;
        } catch (Throwable ignored) {
        }
    }

    // ---------------------------------------------------------------- install

    @JavascriptInterface
    public String canInstall() {
        boolean ok = true;
        String why = "";
        try {
            ok = ctx.getPackageManager().canRequestPackageInstalls();
        } catch (Throwable t) {
            ok = Build.VERSION.SDK_INT < 26;
        }
        if (!ok) why = "Allow Liquid Store to install apps, then try again.";
        StringWriter sw = new StringWriter();
        JsonWriter w = new JsonWriter(sw);
        try {
            w.beginObject();
            w.name("ok").value(ok);
            w.name("message").value(why);
            w.endObject();
            w.close();
        } catch (IOException ignored) {
        }
        return sw.toString();
    }

    @JavascriptInterface
    public void requestInstallPermission() {
        main.post(new Runnable() {
            public void run() {
                try {
                    Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                    i.setData(Uri.parse("package:" + ctx.getPackageName()));
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    ctx.startActivity(i);
                } catch (Throwable t) {
                    try {
                        Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        ctx.startActivity(i);
                    } catch (Throwable ignored) {
                    }
                }
            }
        });
    }

    @JavascriptInterface
    public String progress() {
        StringWriter sw = new StringWriter();
        JsonWriter w = new JsonWriter(sw);
        try {
            w.beginObject();
            w.name("pkg").value(insPkg == null ? "" : insPkg);
            w.name("phase").value(insPhase);
            w.name("pct").value(insPct);
            w.name("got").value(insGot);
            w.name("total").value(insTotal);
            w.name("text").value(insTotal > 0 ? IndexLoader.human(insGot) + " / " + IndexLoader.human(insTotal) : "");
            w.name("error").value(insError == null ? "" : insError);
            w.endObject();
            w.close();
        } catch (IOException ignored) {
        }
        return sw.toString();
    }

    @JavascriptInterface
    public String install(final String pkg) {
        final AppEntry a = index.get(pkg);
        StringWriter sw = new StringWriter();
        JsonWriter w = new JsonWriter(sw);
        try {
            w.beginObject();
            if (a == null) {
                w.name("ok").value(false);
                w.name("error").value("That app is not in the catalogue.");
            } else if (!"idle".equals(insPhase) && !"failed".equals(insPhase)) {
                w.name("ok").value(false);
                w.name("error").value("Another install is already running.");
            } else if (!canInstallNow()) {
                w.name("ok").value(false);
                w.name("error").value("permission");
            } else {
                w.name("ok").value(true);
                startInstall(a);
            }
            w.endObject();
            w.close();
        } catch (IOException ignored) {
        }
        return sw.toString();
    }

    private boolean canInstallNow() {
        try {
            return ctx.getPackageManager().canRequestPackageInstalls();
        } catch (Throwable t) {
            return Build.VERSION.SDK_INT < 26;
        }
    }

    private void startInstall(final AppEntry a) {
        insPkg = a.pkg;
        insPhase = "download";
        insPct = 0;
        insGot = 0;
        insTotal = a.size;
        insError = null;
        push("progress");

        io.execute(new Runnable() {
            public void run() {
                PackageInstaller.Session session = null;
                int id = -1;
                try {
                    PackageManager pm = ctx.getPackageManager();
                    PackageInstaller pi = pm.getPackageInstaller();
                    PackageInstaller.SessionParams params =
                            new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                    params.setAppPackageName(a.pkg);
                    if (a.size > 0) params.setSize(a.size);
                    id = pi.createSession(params);
                    sessionId = id;
                    session = pi.openSession(id);

                    HttpURLConnection h = (HttpURLConnection) new URL(installUrl(a)).openConnection();
                    h.setConnectTimeout(20000);
                    h.setReadTimeout(30000);
                    h.setInstanceFollowRedirects(true);
                    h.setRequestProperty("User-Agent", "Liquid Store/2.0");
                    long total = h.getContentLengthLong();
                    if (total <= 0) total = a.size;
                    insTotal = total;

                    InputStream in = new BufferedInputStream(h.getInputStream(), 1 << 16);
                    OutputStream out = session.openWrite("base.apk", 0, total > 0 ? total : -1);
                    MessageDigest md = MessageDigest.getInstance("SHA-256");
                    byte[] buf = new byte[1 << 16];
                    long got = 0;
                    int n, last = -1;
                    try {
                        while ((n = in.read(buf)) > 0) {
                            out.write(buf, 0, n);
                            md.update(buf, 0, n);
                            got += n;
                            insGot = got;
                            if (total > 0) {
                                int p = (int) (got * 100 / total);
                                if (p != last) {
                                    last = p;
                                    insPct = p;
                                    push("progress");
                                }
                            }
                        }
                    } finally {
                        try { in.close(); } catch (IOException ignored) { }
                    }
                    session.fsync(out);
                    out.close();

                    String want = a.hash == null ? "" : a.hash.trim();
                    if (want.length() > 0 && "sha256".equalsIgnoreCase(a.hashType)) {
                        String gotHex = hex(md.digest());
                        if (!gotHex.equalsIgnoreCase(want)) {
                            throw new IOException("Checksum did not match the repository index - download discarded.");
                        }
                    }

                    insPhase = "installing";
                    insPct = 100;
                    push("progress");

                    Intent intent = new Intent(ctx, InstallReceiver.class);
                    intent.setAction(InstallReceiver.ACTION);
                    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                    if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
                    PendingIntent pending = PendingIntent.getBroadcast(ctx, id, intent, flags);
                    session.commit(pending.getIntentSender());
                    session = null;
                } catch (Exception ex) {
                    insPhase = "failed";
                    insError = String.valueOf(ex.getMessage());
                    insPct = 0;
                    push("progress");
                    if (session != null) {
                        try { session.abandon(); } catch (Throwable ignored) { }
                    }
                }
            }
        });
    }

    @JavascriptInterface
    public String cancel() {
        try {
            if (sessionId >= 0) {
                ctx.getPackageManager().getPackageInstaller().abandonSession(sessionId);
            }
        } catch (Throwable ignored) {
        }
        sessionId = -1;
        insPhase = "idle";
        insPct = 0;
        push("progress");
        return "{\"ok\":true}";
    }

    void onInstallResult(int status, String message) {
        if (status == PackageInstaller.STATUS_SUCCESS) {
            insPhase = "success";
            insPct = 100;
            insError = null;
            refreshInstalled(true);
        } else if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            insPhase = "confirm";
        } else {
            insPhase = "failed";
            insError = message == null ? "Install failed." : message;
        }
        push("progress");
        push("installed");
    }

    @JavascriptInterface
    public String open(String pkg) {
        final String p = pkg;
        main.post(new Runnable() {
            public void run() {
                try {
                    Intent i = ctx.getPackageManager().getLaunchIntentForPackage(p);
                    if (i != null) {
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        ctx.startActivity(i);
                    }
                } catch (Throwable ignored) {
                }
            }
        });
        return "{\"ok\":true}";
    }

    @JavascriptInterface
    public String uninstall(final String pkg) {
        main.post(new Runnable() {
            public void run() {
                try {
                    Intent i = new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + pkg));
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    ctx.startActivity(i);
                } catch (Throwable ignored) {
                }
            }
        });
        return "{\"ok\":true}";
    }

    @JavascriptInterface
    public String about() {
        StringWriter sw = new StringWriter();
        JsonWriter w = new JsonWriter(sw);
        try {
            String ver = "1.0";
            try {
                PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
                ver = pi.versionName;
            } catch (Throwable ignored) { }
            w.beginObject();
            w.name("name").value("Liquid Store");
            w.name("version").value(ver);
            w.name("source").value("F-Droid");
            w.endObject();
            w.close();
        } catch (IOException ignored) {
        }
        return sw.toString();
    }

    // ------------------------------------------------------------ image cache

    /** Bytes fetched for an image the WebView could not load itself. */
    private File imageFile(String url) {
        File d = new File(ctx.getCacheDir(), "img");
        if (!d.exists()) d.mkdirs();
        return new File(d, sha1(url) + ".bin");
    }

    @JavascriptInterface
    public void fetchImage(final String url) {
        if (url == null || url.length() == 0) return;
        io.execute(new Runnable() {
            public void run() {
                try {
                    File f = imageFile(url);
                    if (!f.isFile() || f.length() == 0) {
                        java.net.URLConnection c = new java.net.URL(url).openConnection();
                        c.setConnectTimeout(8000);
                        c.setReadTimeout(15000);
                        if (c instanceof java.net.HttpURLConnection) {
                            ((java.net.HttpURLConnection) c).setRequestProperty("User-Agent", "LiquidStore/2.2");
                        }
                        InputStream in = new BufferedInputStream(c.getInputStream(), 1 << 15);
                        File tmp = new File(f.getPath() + ".part");
                        OutputStream out = new FileOutputStream(tmp);
                        try {
                            byte[] buf = new byte[1 << 15];
                            int n;
                            long total = 0;
                            while ((n = in.read(buf)) > 0) {
                                total += n;
                                if (total > 900 * 1024) throw new IOException("image too large");
                                out.write(buf, 0, n);
                            }
                        } finally {
                            try { out.close(); } catch (IOException ignored) { }
                            try { in.close(); } catch (IOException ignored) { }
                        }
                        if (f.exists() && !f.delete()) { /* replaced below */ }
                        if (!tmp.renameTo(f)) throw new IOException("could not store image");
                    }
                } catch (Throwable ignored) {
                }
                push("image");
            }
        });
    }

    /** The cached bytes as a data URI, or "" if we do not have them yet. */
    @JavascriptInterface
    public String imageData(String url) {
        try {
            File f = imageFile(url);
            if (!f.isFile() || f.length() == 0 || f.length() > 900 * 1024) return "";
            byte[] b = new byte[(int) f.length()];
            java.io.FileInputStream in = new java.io.FileInputStream(f);
            try {
                int off = 0, n;
                while (off < b.length && (n = in.read(b, off, b.length - off)) > 0) off += n;
            } finally {
                try { in.close(); } catch (IOException ignored) { }
            }
            String low = url.toLowerCase();
            String mime = (low.endsWith(".jpg") || low.endsWith(".jpeg") || low.endsWith(".webp"))
                    ? (low.endsWith(".webp") ? "image/webp" : "image/jpeg") : "image/png";
            return "data:" + mime + ";base64," + Base64.encodeToString(b, Base64.NO_WRAP);
        } catch (Throwable t) {
            return "";
        }
    }

    private static String sha1(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            byte[] d = md.digest(s.getBytes("UTF-8"));
            return hex(d);
        } catch (Exception e) {
            return Integer.toHexString(s.hashCode());
        }
    }

    // ----------------------------------------------------------------- utils

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) {
            int v = x & 0xff;
            if (v < 16) sb.append('0');
            sb.append(Integer.toHexString(v));
        }
        return sb.toString();
    }

    void push(final String type) {
        main.post(new Runnable() {
            public void run() {
                try {
                    web.evaluateJavascript("window.__store&&window.__store('" + type + "')", null);
                } catch (Throwable ignored) {
                }
            }
        });
    }
}
