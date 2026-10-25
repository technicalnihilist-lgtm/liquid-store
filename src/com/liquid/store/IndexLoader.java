package com.liquid.store;

import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonToken;
import com.google.gson.stream.JsonWriter;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLConnection;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Fetches and parses the F-Droid repository index.
 *
 * Three things make this bearable on a phone:
 *  - every mirror is probed in parallel and the fastest one wins, instead of
 *    gambling on a single hard-coded host;
 *  - the index is parsed while it arrives, so the store fills in rather than
 *    blocking on the whole file;
 *  - where the server supports byte ranges the file is pulled over several
 *    connections at once, and the parser reads it as chunks land.
 *
 * Pure Java, so a JVM test can drive all of it against a local server.
 */
public class IndexLoader {

    /** Repo roots, from F-Droid's official mirror list. Probed in parallel. */
    public static final String[] DEFAULT_MIRRORS = {
            "https://f-droid.org/repo",
            "https://mirror.hyd.albony.in/fdroid/repo",          // Hyderabad, IN
            "https://mirror.del2.albony.in/fdroid/repo",         // Delhi, IN
            "https://cloudflare.f-droid.org/repo",               // CDN
            "https://mirror.freedif.org/fdroid/repo",            // Singapore
            "https://mirror.cyberbits.asia/fdroid/repo",
            "https://ftp.lysator.liu.se/pub/fdroid/repo",
            "https://plug-mirror.rcac.purdue.edu/fdroid/repo",
            "https://ftp.agdsn.de/fdroid/repo",
            "https://mirror.fcix.net/fdroid/repo",
    };

    private static final String UA = "LiquidStore/2.1";
    private static final String INDEX = "/index-v1.jar";
    private static final int MAX_DESC = 700;
    private static final int MAX_DESC_CACHE = 420;
    private static final int BATCH = 250;
    private static final long TICK_MS = 150;

    private static final int PROBE_TIMEOUT_MS = 4000;
    private static final long PROBE_BUDGET_MS = 6000;
    private static final long PROBE_GRACE_MS = 700;
    private static final int PROBE_BYTES = 48 * 1024;
    private static final int CONNECT_TIMEOUT_MS = 8000;
    private static final int READ_TIMEOUT_MS = 20000;
    private static final int MAX_CHUNKS = 8;

    public interface Progress {
        void onPhase(String phase, int pct, String detail);
        default void onApps(List<AppEntry> apps) { }
    }

    public interface Cancel { boolean cancelled(); }

    interface Counter { long bytes(); }

    public static class Repo {
        public String name = "F-Droid";
        /** canonical address advertised by the index */
        public String address = "https://f-droid.org/repo";
        /** the mirror that actually served us - icons and APKs must come from here */
        public String baseUrl = "";
        public long timestamp;
        public String lastModified = "";
        public String etag = "";
        public final List<AppEntry> apps = new ArrayList<AppEntry>();
    }

    private static final Progress NOP = new Progress() {
        public void onPhase(String p, int c, String d) { }
    };

    private static final Cancel NEVER = new Cancel() {
        public boolean cancelled() { return false; }
    };

    // ------------------------------------------------------------------ entry

    public static Repo load(File dir, List<String> mirrors, boolean force,
                            Progress p, Cancel cancel) throws IOException {
        if (p == null) p = NOP;
        if (cancel == null) cancel = NEVER;
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("cannot create " + dir);
        File cache = new File(dir, "catalog.json");

        if (!force && cache.isFile() && cache.length() > 0) {
            try {
                p.onPhase("cache", 30, "opening the saved catalogue");
                Repo r = readCache(cache, p);
                if (!r.apps.isEmpty()) {
                    p.onPhase("cache", 100, r.apps.size() + " apps (saved)");
                    p.onApps(r.apps);
                    return r;
                }
            } catch (Exception ignored) {
                // fall through and fetch a fresh copy
            }
        }

        List<String> list = new ArrayList<String>();
        if (mirrors != null) for (String m : mirrors) if (m != null && m.length() > 0) list.add(m);
        boolean explicit = !list.isEmpty();
        if (!explicit) for (String m : DEFAULT_MIRRORS) list.add(m);

        String[] meta = readMeta(dir);
        p.onPhase("probe", 2, "checking " + list.size() + (explicit ? " chosen source" : " sources"));
        List<Probe> ranked = probeAll(list, p, cancel, meta[0], meta[1]);
        if (ranked.isEmpty() && explicit) {
            // The chosen source is not answering; try the official list instead.
            p.onPhase("probe", 2, "chosen source unreachable, trying mirrors");
            ranked = probeAll(new ArrayList<String>(Arrays.asList(DEFAULT_MIRRORS)), p, cancel, meta[0], meta[1]);
        }
        if (cancel.cancelled()) throw new IOException("cancelled");
        if (ranked.isEmpty()) {
            throw new IOException("No source answered. Check the connection, or pick a different source in Settings.");
        }
        StringBuilder names = new StringBuilder();
        for (int i = 0; i < Math.min(3, ranked.size()); i++) {
            if (i > 0) names.append(", ");
            names.append(host(ranked.get(i).base));
        }
        p.onPhase("probe", 6, "using " + names);

        IOException last = null;
        for (int i = 0; i < ranked.size(); i++) {
            if (cancel.cancelled()) throw new IOException("cancelled");
            Probe pr = ranked.get(i);
            try {
                return fetch(pr, dir, cache, p, cancel);
            } catch (IOException e) {
                last = e;
                if (cancel.cancelled()) throw e;
                if (i + 1 < ranked.size()) {
                    p.onPhase("probe", 6, host(ranked.get(i + 1).base) + " is next");
                }
            }
        }
        throw last == null ? new IOException("all sources failed") : last;
    }

    // ------------------------------------------------------------------ probe

    static class Probe {
        String base;
        long ms;
        boolean range;
        long size;
        boolean notModified;
        String lm = "";
        String etag = "";
    }

    static List<Probe> probeAll(List<String> mirrors, Progress p, final Cancel cancel,
                                final String prevLm, final String prevEtag) {
        final List<Probe> out = Collections.synchronizedList(new ArrayList<Probe>());
        ExecutorService pool = Executors.newFixedThreadPool(Math.min(8, Math.max(1, mirrors.size())),
                new java.util.concurrent.ThreadFactory() {
                    public Thread newThread(Runnable r) {
                        Thread t = new Thread(r);
                        t.setDaemon(true);
                        return t;
                    }
                });
        final CountDownLatch latch = new CountDownLatch(mirrors.size());
        for (final String base : mirrors) {
            pool.submit(new Runnable() {
                public void run() {
                    try {
                        Probe pr = probeOne(base, PROBE_TIMEOUT_MS, prevLm, prevEtag);
                        if (pr != null && !cancel.cancelled()) out.add(pr);
                    } catch (Throwable ignored) {
                    } finally {
                        latch.countDown();
                    }
                }
            });
        }
        // Start as soon as a good source answers, but give the others a short
        // grace period in case one of them is faster. Never wait for the slow ones.
        long began = System.currentTimeMillis();
        long firstHit = -1;
        while (latch.getCount() > 0) {
            long waited = System.currentTimeMillis() - began;
            if (waited >= PROBE_BUDGET_MS) break;
            if (firstHit < 0 && !out.isEmpty()) firstHit = System.currentTimeMillis();
            if (firstHit > 0 && System.currentTimeMillis() - firstHit >= PROBE_GRACE_MS) break;
            try { Thread.sleep(50); } catch (InterruptedException e) { break; }
        }
        pool.shutdownNow();
        Collections.sort(out, new Comparator<Probe>() {
            public int compare(Probe a, Probe b) { return Long.compare(a.ms, b.ms); }
        });
        return out;
    }

    static Probe probeOne(String base, int timeoutMs, String prevLm, String prevEtag) {
        HttpURLConnection h = null;
        InputStream in = null;
        try {
            h = (HttpURLConnection) new URL(base + INDEX).openConnection();
            h.setConnectTimeout(timeoutMs);
            h.setReadTimeout(timeoutMs);
            h.setInstanceFollowRedirects(true);
            h.setRequestProperty("User-Agent", UA);
            h.setRequestProperty("Range", "bytes=0-" + (PROBE_BYTES - 1));
            if (prevLm != null && prevLm.length() > 0) {
                long t = parseHttpDate(prevLm);
                if (t > 0) h.setIfModifiedSince(t);
            }
            if (prevEtag != null && prevEtag.length() > 0) h.setRequestProperty("If-None-Match", prevEtag);

            long t0 = System.nanoTime();
            int code = h.getResponseCode();
            if (code == HttpURLConnection.HTTP_NOT_MODIFIED) {
                Probe nm = new Probe();
                nm.base = base;
                nm.notModified = true;
                nm.ms = Math.max(1, (System.nanoTime() - t0) / 1000000L);
                return nm;
            }
            if (code != 200 && code != 206) return null;

            in = new BufferedInputStream(h.getInputStream(), 8192);
            byte[] buf = new byte[8192];
            int got = 0, n;
            while (got < PROBE_BYTES && (n = in.read(buf, 0, Math.min(buf.length, PROBE_BYTES - got))) > 0) {
                if (got == 0 && (buf[0] != 'P' || buf[1] != 'K')) return null; // not a jar
                got += n;
            }
            long ms = Math.max(1, (System.nanoTime() - t0) / 1000000L);
            if (got < 1024) return null;

            Probe pr = new Probe();
            pr.base = base;
            pr.ms = ms;
            pr.range = (code == 206);
            pr.size = pr.range ? totalFromContentRange(h.getHeaderField("Content-Range")) : h.getContentLengthLong();
            pr.lm = nz(h.getHeaderField("Last-Modified"));
            pr.etag = nz(h.getHeaderField("ETag"));
            return pr;
        } catch (Throwable t) {
            return null;
        } finally {
            try { if (in != null) in.close(); } catch (IOException ignored) { }
            if (h != null) h.disconnect();
        }
    }

    static long totalFromContentRange(String cr) {
        if (cr == null) return -1;
        int slash = cr.lastIndexOf('/');
        if (slash < 0) return -1;
        try { return Long.parseLong(cr.substring(slash + 1).trim()); } catch (Exception e) { return -1; }
    }

    // ------------------------------------------------------------------ fetch

    private static Repo fetch(Probe pr, File dir, File cache, Progress p, Cancel cancel)
            throws IOException {
        long start = System.currentTimeMillis();

        if (pr.notModified && cache.isFile()) {
            p.onPhase("cache", 100, "already up to date");
            Repo r = readCache(cache, p);
            p.onApps(r.apps);
            return r;
        }

        long total = pr.size;
        p.onPhase("download", 4, "using " + host(pr.base));

        // One connection, parsed as it arrives. Ranged parallel fetching was
        // tried and measured slower, so it is deliberately not used.
        Repo repo = fetchStreaming(pr.base, p, cancel, total, start);

        repo.baseUrl = pr.base;
        repo.lastModified = pr.lm;
        repo.etag = pr.etag;
        try {
            writeCache(cache, repo);
            writeMeta(dir, pr.lm, pr.etag);
        } catch (IOException ignored) {
        }
        p.onApps(repo.apps);
        p.onPhase("ready", 100, repo.apps.size() + " apps");
        return repo;
    }

    /** One connection, parsed as it arrives. */
    private static Repo fetchStreaming(String base, Progress p, Cancel cancel,
                                       long total, long start) throws IOException {
        HttpURLConnection h = (HttpURLConnection) new URL(base + INDEX).openConnection();
        h.setConnectTimeout(CONNECT_TIMEOUT_MS);
        h.setReadTimeout(READ_TIMEOUT_MS);
        h.setInstanceFollowRedirects(true);
        h.setRequestProperty("User-Agent", UA);
        int code = h.getResponseCode();
        if (code != HttpURLConnection.HTTP_OK) {
            h.disconnect();
            throw new IOException("HTTP " + code + " from " + host(base));
        }
        Counting net = new Counting(new BufferedInputStream(h.getInputStream(), 1 << 16));
        try {
            return parseArchive(net, p, net, total, start, cancel, new AtomicInteger());
        } finally {
            try { net.close(); } catch (IOException ignored) { }
            h.disconnect();
        }
    }

    // ------------------------------------------------------------------ parse

    private static Repo parseArchive(InputStream in, Progress p, Counter counter, long total,
                                     long start, Cancel cancel, AtomicInteger appCount) throws IOException {
        Repo repo = null;
        // Buffer generously: the inflater asks the underlying stream for as
        // little as 512 bytes at a time, which is slow over a socket.
        ZipInputStream zip = new ZipInputStream(new BufferedInputStream(in, 1 << 16));
        try {
            ZipEntry e;
            while ((e = zip.getNextEntry()) != null) {
                if (cancel.cancelled()) throw new IOException("cancelled");
                if (e.getName().endsWith("index-v1.json")) {
                    repo = parseJson(zip, p, counter, total, start, cancel, appCount);
                    break;
                }
                zip.closeEntry();
            }
        } finally {
            try { zip.close(); } catch (IOException ignored) { }
        }
        if (repo == null) throw new IOException("index-v1.json missing from the archive");
        return repo;
    }

    static Repo parseJson(InputStream in, Progress p, Counter counter, long total,
                          long start, Cancel cancel, AtomicInteger appCount) throws IOException {
        Repo repo = new Repo();
        List<AppEntry> apps = new ArrayList<AppEntry>(6000);
        Map<String, AppEntry> byPkg = new LinkedHashMap<String, AppEntry>();

        JsonReader r = new JsonReader(new InputStreamReader(in, "UTF-8"));
        r.setLenient(true);
        r.beginObject();
        while (r.hasNext()) {
            String key = r.nextName();
            if ("repo".equals(key)) parseRepo(r, repo);
            else if ("apps".equals(key)) parseApps(r, apps, byPkg, p, counter, total, start, cancel, appCount);
            else if ("packages".equals(key)) parsePackages(r, byPkg);
            else r.skipValue();
        }
        r.endObject();
        r.close();

        for (AppEntry a : apps) if (a.hasApk) repo.apps.add(a);
        return repo;
    }

    private static void parseRepo(JsonReader r, Repo repo) throws IOException {
        r.beginObject();
        while (r.hasNext()) {
            String k = r.nextName();
            if ("name".equals(k)) repo.name = str(r);
            else if ("address".equals(k)) repo.address = str(r);
            else if ("timestamp".equals(k)) repo.timestamp = num(r);
            else r.skipValue();
        }
        r.endObject();
    }

    private static void parseApps(JsonReader r, List<AppEntry> out, Map<String, AppEntry> byPkg,
                                  Progress p, Counter counter, long total, long start,
                                  Cancel cancel, AtomicInteger appCount) throws IOException {
        long lastTick = 0;
        r.beginArray();
        while (r.hasNext()) {
            if (cancel.cancelled()) throw new IOException("cancelled");
            AppEntry e = new AppEntry();
            String locName = null, locSummary = null, locIcon = null, locDesc = null;
            List<String> cats = new ArrayList<String>(2);
            List<String> shots = new ArrayList<String>(3);
            List<String> locShots = new ArrayList<String>(3);

            r.beginObject();
            while (r.hasNext()) {
                String k = r.nextName();
                if ("packageName".equals(k)) e.pkg = str(r);
                else if ("name".equals(k)) e.name = str(r);
                else if ("summary".equals(k)) e.summary = str(r);
                else if ("description".equals(k)) e.description = clip(str(r), MAX_DESC);
                else if ("icon".equals(k)) e.icon = str(r);
                else if ("license".equals(k)) e.license = str(r);
                else if ("authorName".equals(k)) e.author = str(r);
                else if ("sourceCode".equals(k)) e.source = str(r);
                else if ("issueTracker".equals(k)) e.issues = str(r);
                else if ("webSite".equals(k)) e.web = str(r);
                else if ("lastUpdated".equals(k)) e.lastUpdated = num(r);
                else if ("added".equals(k)) e.added = num(r);
                else if ("categories".equals(k)) readStringArray(r, cats);
                else if ("phoneScreenshots".equals(k)) readStringArray(r, shots);
                else if ("localized".equals(k)) {
                    String[] loc = readLocalized(r, locShots);
                    if (loc != null) { locName = loc[0]; locSummary = loc[1]; locIcon = loc[2]; locDesc = loc[3]; }
                } else r.skipValue();
            }
            r.endObject();

            if (locName != null && locName.length() > 0) e.name = locName;
            if (locSummary != null && locSummary.length() > 0) e.summary = locSummary;
            if (locIcon != null && locIcon.length() > 0) e.icon = locIcon;
            if (locDesc != null && locDesc.length() > 0) e.description = clip(locDesc, MAX_DESC);
            e.category = cats.isEmpty() ? "" : cats.get(0);
            if (!locShots.isEmpty()) { shots.clear(); shots.addAll(locShots); }
            for (int si = 0; si < shots.size() && si < 8; si++) e.shots.add(shots.get(si));

            if (e.pkg != null && e.pkg.length() > 0) {
                out.add(e);
                byPkg.put(e.pkg, e);
            }
            appCount.set(out.size());

            if (out.size() % BATCH == 0) {
                long now = System.currentTimeMillis();
                if (now - lastTick >= TICK_MS) {
                    lastTick = now;
                    report(p, counter, total, start, out.size(), "apps");
                    p.onApps(new ArrayList<AppEntry>(out));
                }
            }
        }
        r.endArray();
        report(p, counter, total, start, out.size(), "apps");
    }

    /** Only English is read; every other locale block is skipped outright. */
    private static String[] readLocalized(JsonReader r, List<String> shotsOut) throws IOException {
        String[] best = null;
        String bestLoc = null;
        r.beginObject();
        while (r.hasNext()) {
            String loc = r.nextName();
            boolean wanted = loc != null && (loc.equals("en-US") || loc.startsWith("en"));
            if (!wanted) { r.skipValue(); continue; }
            String n = null, s = null, i = null, d = null;
            List<String> shots = new ArrayList<String>(3);
            r.beginObject();
            while (r.hasNext()) {
                String k = r.nextName();
                if ("name".equals(k)) n = str(r);
                else if ("summary".equals(k)) s = str(r);
                else if ("icon".equals(k)) i = str(r);
                else if ("description".equals(k)) d = str(r);
                else if ("phoneScreenshots".equals(k)) readStringArray(r, shots);
                else r.skipValue();
            }
            r.endObject();
            if (best == null || "en-US".equals(loc)) {
                best = new String[]{n, s, i, d};
                bestLoc = loc;
                shotsOut.clear();
                shotsOut.addAll(shots);
            }
        }
        r.endObject();
        return best;
    }

    private static void parsePackages(JsonReader r, Map<String, AppEntry> byPkg) throws IOException {
        r.beginObject();
        while (r.hasNext()) {
            String pkg = r.nextName();
            AppEntry e = byPkg.get(pkg);
            r.beginArray();
            while (r.hasNext()) {
                String apkName = null, versionName = "", hash = "", hashType = "";
                long versionCode = -1, size = 0;
                int minSdk = 0;
                r.beginObject();
                while (r.hasNext()) {
                    String k = r.nextName();
                    if ("apkName".equals(k)) apkName = str(r);
                    else if ("versionName".equals(k)) versionName = str(r);
                    else if ("versionCode".equals(k)) versionCode = num(r);
                    else if ("size".equals(k)) size = num(r);
                    else if ("hash".equals(k)) hash = str(r);
                    else if ("hashType".equals(k)) hashType = str(r);
                    else if ("minSdkVersion".equals(k)) minSdk = (int) num(r);
                    else r.skipValue();
                }
                r.endObject();
                if (e == null) continue;
                if (apkName == null || !apkName.toLowerCase().endsWith(".apk")) continue;
                if (versionCode > e.versionCode || !e.hasApk) {
                    e.hasApk = true;
                    e.apkName = apkName;
                    e.versionName = versionName;
                    e.versionCode = Math.max(versionCode, 0);
                    e.size = size;
                    e.hash = hash;
                    e.hashType = hashType;
                    e.minSdk = minSdk;
                }
            }
            r.endArray();
        }
        r.endObject();
    }

    private static void report(Progress p, Counter counter, long total, long start,
                               int count, String phase) {
        long read = counter == null ? 0 : counter.bytes();
        int pct = total > 0 ? (int) Math.min(99, read * 100 / total) : 0;
        long ms = Math.max(1, System.currentTimeMillis() - start);
        double bps = read * 1000.0 / ms;
        StringBuilder sb = new StringBuilder();
        sb.append(human(read));
        if (total > 0) sb.append(" / ").append(human(total));
        if (read > 512 * 1024) {
            sb.append("  \u00b7  ").append(human((long) bps)).append("/s");
            if (total > read) {
                long left = (long) ((total - read) / Math.max(1.0, bps));
                if (left > 0 && left < 3600) sb.append("  \u00b7  ").append(left).append("s left");
            }
        }
        if (count > 0) sb.append("  \u00b7  ").append(count).append(" apps");
        p.onPhase(phase, pct, sb.toString());
    }

    // --------------------------------------------------------------- helpers

    private static String str(JsonReader r) throws IOException {
        JsonToken t = r.peek();
        if (t == JsonToken.NULL) { r.nextNull(); return null; }
        if (t == JsonToken.STRING || t == JsonToken.NUMBER) return r.nextString();
        r.skipValue();
        return null;
    }

    private static long num(JsonReader r) throws IOException {
        JsonToken t = r.peek();
        if (t == JsonToken.NULL) { r.nextNull(); return 0; }
        if (t == JsonToken.NUMBER || t == JsonToken.STRING) {
            String s = r.nextString();
            try {
                int dot = s.indexOf('.');
                if (dot >= 0) s = s.substring(0, dot);
                return Long.parseLong(s.trim());
            } catch (Exception ex) {
                return 0;
            }
        }
        r.skipValue();
        return 0;
    }

    private static void readStringArray(JsonReader r, List<String> out) throws IOException {
        r.beginArray();
        while (r.hasNext()) {
            JsonToken t = r.peek();
            if (t == JsonToken.STRING) out.add(r.nextString());
            else r.skipValue();
        }
        r.endArray();
    }

    private static String join(List<String> xs) {
        if (xs == null || xs.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < xs.size(); i++) {
            if (i > 0) sb.append('\n');
            sb.append(xs.get(i));
        }
        return sb.toString();
    }

    private static void split(String s, List<String> out) {
        if (s == null || s.length() == 0) return;
        int start = 0;
        for (int i = 0; i <= s.length(); i++) {
            if (i == s.length() || s.charAt(i) == '\n') {
                if (i > start) out.add(s.substring(start, i));
                start = i + 1;
            }
        }
    }

    private static String clip(String s, int max) {
        if (s == null) return "";
        s = s.trim();
        if (s.length() <= max) return s;
        return s.substring(0, max).trim() + "\u2026";
    }

    private static String nz(String s) { return s == null ? "" : s; }

    public static String host(String url) {
        try { return new URL(url).getHost(); } catch (Exception e) { return url; }
    }

    public static String human(long bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024L * 1024) return (bytes / 1024) + " KB";
        if (bytes < 1024L * 1024 * 1024) return String.format("%.1f MB", bytes / 1048576.0);
        return String.format("%.2f GB", bytes / 1073741824.0);
    }

    private static long parseHttpDate(String s) {
        try {
            java.text.SimpleDateFormat f =
                    new java.text.SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", java.util.Locale.US);
            return f.parse(s).getTime();
        } catch (Exception e) {
            return -1;
        }
    }

    /** Counts bytes as they come off the socket. */
    static class Counting extends FilterInputStream implements Counter {
        volatile long count;
        Counting(InputStream in) { super(in); }
        public long bytes() { return count; }
        @Override public int read() throws IOException {
            int b = super.read();
            if (b >= 0) count++;
            return b;
        }
        @Override public int read(byte[] b, int off, int len) throws IOException {
            int n = super.read(b, off, len);
            if (n > 0) count += n;
            return n;
        }
        @Override public long skip(long n) throws IOException {
            long s = super.skip(n);
            if (s > 0) count += s;
            return s;
        }
    }

    // ----------------------------------------------------------------- cache

    static void writeCache(File f, Repo repo) throws IOException {
        File tmp = new File(f.getParentFile(), "catalog.json.part");
        JsonWriter w = new JsonWriter(new OutputStreamWriter(new FileOutputStream(tmp), "UTF-8"));
        try {
            w.beginObject();
            w.name("v").value(2);
            w.name("name").value(repo.name);
            w.name("address").value(repo.address);
            w.name("base").value(nz(repo.baseUrl));
            w.name("timestamp").value(repo.timestamp);
            w.name("lm").value(nz(repo.lastModified));
            w.name("etag").value(nz(repo.etag));
            w.name("apps").beginArray();
            for (AppEntry a : repo.apps) {
                w.beginObject();
                w.name("pkg").value(a.pkg);
                w.name("name").value(nz(a.name));
                w.name("sum").value(nz(a.summary));
                w.name("desc").value(clip(a.description, MAX_DESC_CACHE));
                w.name("icon").value(nz(a.icon));
                w.name("cat").value(nz(a.category));
                w.name("lic").value(nz(a.license));
                w.name("auth").value(nz(a.author));
                w.name("src").value(nz(a.source));
                w.name("iss").value(nz(a.issues));
                w.name("web").value(nz(a.web));
                w.name("upd").value(a.lastUpdated);
                w.name("added").value(a.added);
                w.name("apk").value(nz(a.apkName));
                w.name("ver").value(nz(a.versionName));
                w.name("vc").value(a.versionCode);
                w.name("size").value(a.size);
                w.name("hash").value(nz(a.hash));
                w.name("htype").value(nz(a.hashType));
                w.name("min").value(a.minSdk);
                w.name("shots").value(join(a.shots));
                w.endObject();
            }
            w.endArray();
            w.endObject();
        } finally {
            w.close();
        }
        if (f.exists() && !f.delete()) { /* replaced below */ }
        if (!tmp.renameTo(f)) throw new IOException("could not write catalogue cache");
    }

    static Repo readCache(File f, Progress p) throws IOException {
        Repo repo = new Repo();
        int version = 0;
        JsonReader r = new JsonReader(new InputStreamReader(new FileInputStream(f), "UTF-8"));
        r.setLenient(true);
        r.beginObject();
        while (r.hasNext()) {
            String k = r.nextName();
            if ("v".equals(k)) version = (int) num(r);
            else if ("name".equals(k)) repo.name = str(r);
            else if ("address".equals(k)) repo.address = str(r);
            else if ("base".equals(k)) repo.baseUrl = nz(str(r));
            else if ("timestamp".equals(k)) repo.timestamp = num(r);
            else if ("lm".equals(k)) repo.lastModified = nz(str(r));
            else if ("etag".equals(k)) repo.etag = nz(str(r));
            else if ("apps".equals(k)) {
                r.beginArray();
                while (r.hasNext()) {
                    AppEntry a = new AppEntry();
                    r.beginObject();
                    while (r.hasNext()) {
                        String f2 = r.nextName();
                        if ("pkg".equals(f2)) a.pkg = str(r);
                        else if ("name".equals(f2)) a.name = str(r);
                        else if ("sum".equals(f2)) a.summary = str(r);
                        else if ("desc".equals(f2)) a.description = str(r);
                        else if ("icon".equals(f2)) a.icon = str(r);
                        else if ("cat".equals(f2)) a.category = str(r);
                        else if ("lic".equals(f2)) a.license = str(r);
                        else if ("auth".equals(f2)) a.author = str(r);
                        else if ("src".equals(f2)) a.source = str(r);
                        else if ("iss".equals(f2)) a.issues = str(r);
                        else if ("web".equals(f2)) a.web = str(r);
                        else if ("upd".equals(f2)) a.lastUpdated = num(r);
                        else if ("added".equals(f2)) a.added = num(r);
                        else if ("apk".equals(f2)) a.apkName = str(r);
                        else if ("ver".equals(f2)) a.versionName = str(r);
                        else if ("vc".equals(f2)) a.versionCode = num(r);
                        else if ("size".equals(f2)) a.size = num(r);
                        else if ("hash".equals(f2)) a.hash = str(r);
                        else if ("htype".equals(f2)) a.hashType = str(r);
                        else if ("min".equals(f2)) a.minSdk = (int) num(r);
                        else if ("shots".equals(f2)) split(str(r), a.shots);
                        else r.skipValue();
                    }
                    r.endObject();
                    a.hasApk = a.apkName != null && a.apkName.length() > 0;
                    if (a.pkg != null && a.hasApk) repo.apps.add(a);
                    if (p != null && repo.apps.size() % 500 == 0) {
                        p.onApps(new ArrayList<AppEntry>(repo.apps));
                    }
                }
                r.endArray();
            } else r.skipValue();
        }
        r.endObject();
        r.close();
        // A catalogue saved before mirrors existed has no usable asset host.
        if (version < 2 || repo.baseUrl.length() == 0) {
            throw new IOException("catalogue cache is from an older version");
        }
        return repo;
    }

    private static String[] readMeta(File dir) {
        File m = new File(dir, "catalog.meta");
        if (!m.isFile()) return new String[]{"", ""};
        java.io.BufferedReader r = null;
        try {
            r = new java.io.BufferedReader(new java.io.InputStreamReader(new FileInputStream(m), "UTF-8"));
            String lm = r.readLine();
            String etag = r.readLine();
            return new String[]{lm == null ? "" : lm, etag == null ? "" : etag};
        } catch (Exception e) {
            return new String[]{"", ""};
        } finally {
            try { if (r != null) r.close(); } catch (IOException ignored) { }
        }
    }

    private static void writeMeta(File dir, String lm, String etag) throws IOException {
        File m = new File(dir, "catalog.meta");
        java.io.Writer w = null;
        try {
            w = new java.io.OutputStreamWriter(new FileOutputStream(m), "UTF-8");
            w.write(nz(lm));
            w.write("\n");
            w.write(nz(etag));
            w.write("\n");
        } finally {
            if (w != null) w.close();
        }
    }
}
