package com.liquid.store;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {

    private WebView web;
    private StoreBridge bridge;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setBlockNetworkLoads(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setLoadsImagesAutomatically(true);
        s.setBlockNetworkImage(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        web.setBackgroundColor(0xFF070C14);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setLongClickable(false);

        bridge = new StoreBridge(this, web);
        web.addJavascriptInterface(bridge, "Android");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (url == null) return true;
                String u = url.toString();
                if (u.startsWith("file://")) return false;   // our own assets
                try {
                    Intent i = new Intent(Intent.ACTION_VIEW, url);
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Throwable ignored) {
                }
                return true;
            }
        });

        web.loadUrl("file:///android_asset/index.html");
        setContentView(web);
    }

    /** Let the page close an open sheet first; only then leave the app. */
    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript("(window.__onBack?window.__onBack():false)", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if (!"true".equals(value)) {
                    finish();
                }
            }
        });
    }

    /**
     * Tear the WebView down in the one order that is safe.
     *
     * The bridge reports back into the WebView from its own threads, and it is
     * reachable from InstallReceiver through a static field, so it has to stop
     * pointing at this WebView before the WebView is freed: web.destroy()
     * releases the native side, and a report that lands after it is a call into
     * a destroyed WebView from a background thread. shutdown() also clears that
     * static, which until now held this Activity - and the WebView with it - for
     * the life of the process.
     *
     * Removing it from the view tree first is what WebView.destroy() documents:
     * the view has been set as the content view, so it still has a parent.
     */
    @Override
    protected void onDestroy() {
        if (bridge != null) {
            bridge.shutdown();
            bridge = null;
        }
        if (web != null) {
            web.removeJavascriptInterface("Android");
            if (web.getParent() instanceof ViewGroup) {
                ((ViewGroup) web.getParent()).removeView(web);
            }
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
