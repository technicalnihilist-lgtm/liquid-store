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
}
