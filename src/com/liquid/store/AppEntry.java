package com.liquid.store;

/** One catalogue entry, joined from the index "apps" and "packages" sections. */
public class AppEntry {
    public String pkg;
    public String name;
    public String summary = "";
    public String description = "";
    public String icon;          // icon file name, relative to the repo address
    public String category = "";
    public String license = "";
    public String author = "";
    public String source = "";
    public String issues = "";
    public String web = "";
    public long lastUpdated;
    public long added;

    /** screenshot file names, repo-relative, in display order */
    public final java.util.List<String> shots = new java.util.ArrayList<String>();

    // best available package
    public boolean hasApk;
    public String apkName = "";
    public String versionName = "";
    public long versionCode;
    public long size;
    public String hash = "";
    public String hashType = "";

    /** set for GitHub-release entries, where the APK is not repo-relative */
    public String absApkUrl = "";
    public String absIconUrl = "";
    public int minSdk;

    public String displayName() {
        return (name != null && name.length() > 0) ? name : pkg;
    }

    /**
     * name + package + summary + category, lowercased - the exact string the
     * search scan matches a needle against.
     *
     * It used to be rebuilt inside the scan, so every keystroke in the search
     * field concatenated four strings and lowercased the result for all six
     * thousand entries: five String allocations and a locale-aware lowercase
     * pass per entry, about 1.2 MB of garbage per character typed, and it all
     * ran synchronously on the WebView's JavaScript thread - the bridge only
     * answers list() when the method returns, so the page was frozen for the
     * length of the scan. Measured 13 ms warm and 232 ms cold per call on a
     * desktop CPU before the JIT had seen the loop, i.e. several times that on
     * a phone.
     *
     * Built once, on first use, and then kept. Nothing can make it stale: every
     * field it reads is assigned while the entry is being parsed and never
     * touched again, and a refresh builds brand new AppEntry objects rather
     * than editing the ones the store is already serving.
     */
    String haystack() {
        String h = hay;
        if (h == null) {
            h = (displayName() + " " + pkg + " " + summary + " " + category).toLowerCase(java.util.Locale.US);
            hay = h;
        }
        return h;
    }

    /** lazily built by haystack(); see there for why it can never go stale */
    private String hay;
}
