package com.liquid.store;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * The on-disk half of the image cache, and its budget.
 *
 * Every icon and every screenshot the WebView could not load itself is fetched
 * once and kept under getCacheDir()/img so a later render does not go back to
 * the network. Nothing used to remove them again: the directory only ever grew,
 * for the whole life of the install, and a screenshot is allowed to be 900 KB.
 * The in-memory copy of the same bytes is already bounded (see IMG_DONE in
 * index.html), which leaves this one as the only unbounded cache in the app -
 * and the worse of the two, because it survives a reboot.
 *
 * So the directory now has a byte budget. Images are dropped oldest-first, in
 * batches, only once enough new bytes have arrived to be worth the directory
 * scan: the cost is amortised over megabytes rather than paid per image, and
 * the directory overshoots the budget by at most TRIM_AFTER_BYTES.
 *
 * Pure java.io, so a JVM test can drive it against a real directory.
 */
final class ImageCache {

    /** How much of the cache directory the store is allowed to keep. */
    static final long MAX_BYTES = 48L * 1024 * 1024;
    /** New bytes that may accumulate before the directory is scanned again. */
    static final long TRIM_AFTER_BYTES = 4L * 1024 * 1024;
    /** A temp file older than this belongs to a download that never finished. */
    static final long PART_MAX_AGE_MS = 60L * 60 * 1000L;

    private final File dir;
    private long sinceTrim;

    ImageCache(File dir) {
        this.dir = dir;
    }

    /** Count a freshly stored image; trims once enough new bytes have piled up. */
    synchronized void stored(long bytes) {
        if (bytes > 0) sinceTrim += bytes;
        if (sinceTrim >= TRIM_AFTER_BYTES) {
            sinceTrim = 0;
            trim();
        }
    }

    /** Trim now - used once at startup, so an older install shrinks straight away. */
    synchronized void checkNow() {
        sinceTrim = 0;
        trim();
    }

    /** Drop the oldest images until the directory is back inside the budget. */
    synchronized void trim() {
        File[] entries = dir.listFiles();
        if (entries == null || entries.length == 0) return;

        long now = System.currentTimeMillis();
        long total = 0;
        List<File> keep = new ArrayList<File>(entries.length);
        for (File f : entries) {
            if (!f.isFile()) continue;
            if (f.getName().endsWith(".part")) {
                /* a temp file this old was left by a fetch that was killed; the
                   code that would have renamed or deleted it is long gone */
                if (now - f.lastModified() > PART_MAX_AGE_MS) {
                    f.delete();
                    continue;
                }
            }
            total += f.length();
            keep.add(f);
        }
        if (total <= MAX_BYTES) return;

        Collections.sort(keep, new Comparator<File>() {
            public int compare(File a, File b) {
                return Long.compare(a.lastModified(), b.lastModified());
            }
        });
        /* take a tenth off, so the next store does not trigger another scan */
        long target = MAX_BYTES - MAX_BYTES / 10;
        for (File f : keep) {
            if (total <= target) break;
            long len = f.length();
            if (f.delete()) total -= len;
        }
    }

    /** Bytes currently held, for tests and diagnostics. */
    long totalBytes() {
        File[] entries = dir.listFiles();
        if (entries == null) return 0;
        long total = 0;
        for (File f : entries) if (f.isFile()) total += f.length();
        return total;
    }
}
