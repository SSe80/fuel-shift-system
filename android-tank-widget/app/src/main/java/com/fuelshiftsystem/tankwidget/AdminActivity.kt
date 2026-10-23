package com.fuelshiftsystem.tankwidget

import android.app.Activity
import android.app.DownloadManager
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

/** Hosts the existing Admin website and ships in the same APK as the native tank widget. */
class AdminActivity : Activity() {
    private lateinit var webView: WebView
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private val fileChooserRequest = 4102
    private val appUrl = "https://fuel-shift-system.servicestation50.workers.dev/admin-dashboard.html"
    private val allowedHost = "fuel-shift-system.servicestation50.workers.dev"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CookieManager.getInstance().setAcceptCookie(true)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFF071A33.toInt())
        }
        val toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(6, 4, 6, 4)
        }
        toolbar.addView(TextView(this).apply {
            text = "FUEL SHIFT"
            textSize = 12f
            setTextColor(0xFFFFFFFF.toInt())
            setPadding(8, 0, 4, 0)
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        toolbar.addView(toolbarButton("Admin") { webView.loadUrl(appUrl) })
        toolbar.addView(toolbarButton("Tank Widget") { startActivity(Intent(this, WidgetSetupActivity::class.java)) })
        toolbar.addView(toolbarButton("Reload") { webView.reload() })
        root.addView(toolbar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        webView = WebView(this)
        root.addView(webView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        configureWebView()
        requestWidgetPinOnFirstLaunch(root)
        if (savedInstanceState == null) webView.loadUrl(intent?.dataString ?: appUrl)
        else webView.restoreState(savedInstanceState)
    }

    /**
     * The widget is bundled in this APK. Android does not permit apps to place a
     * home-screen widget silently, so request the system's pin confirmation once
     * on first launch; the user can approve or decline it.
     */
    private fun requestWidgetPinOnFirstLaunch(anchor: View) {
        val prefs = getSharedPreferences("fuel_admin_widget_setup", MODE_PRIVATE)
        if (prefs.getBoolean("pin_prompt_attempted", false)) return

        val manager = AppWidgetManager.getInstance(this)
        if (!manager.isRequestPinAppWidgetSupported) {
            prefs.edit().putBoolean("pin_prompt_attempted", true).apply()
            Toast.makeText(
                this,
                "Tank widget is included. Add it from your Home screen's Widgets menu.",
                Toast.LENGTH_LONG
            ).show()
            return
        }

        anchor.postDelayed({
            if (isFinishing || isDestroyed) return@postDelayed
            val requested = try {
                manager.requestPinAppWidget(
                    ComponentName(this, TankInventoryWidgetProvider::class.java),
                    null,
                    null
                )
            } catch (_: Exception) {
                false
            }
            prefs.edit().putBoolean("pin_prompt_attempted", true).apply()
            if (!requested) {
                Toast.makeText(
                    this,
                    "Tank widget is included. Add it from your Home screen's Widgets menu.",
                    Toast.LENGTH_LONG
                ).show()
            }
        }, 1200L)
    }

    private fun toolbarButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        textSize = 10f
        isAllCaps = false
        setPadding(4, 0, 4, 0)
        setOnClickListener { action() }
    }

    @Suppress("SetJavaScriptEnabled")
    private fun configureWebView() {
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.loadsImagesAutomatically = true
        webView.settings.javaScriptCanOpenWindowsAutomatically = true
        webView.settings.setSupportMultipleWindows(false)
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = true
        webView.settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                val uri = Uri.parse(url)
                if (uri.host == allowedHost && uri.path?.endsWith("/admin-login.html") == true) {
                    view.evaluateJavascript(
                        "(function(){var a=document.querySelector('a[href*="Fuel-Shift-System-Admin.apk"]');if(a)a.remove();})();",
                        null
                    )
                }
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (uri.scheme == "https" && uri.host == allowedHost) return false
                if (uri.scheme == "http" || uri.scheme == "https" || uri.scheme == "mailto" || uri.scheme == "tel") {
                    return try { startActivity(Intent(Intent.ACTION_VIEW, uri)); true } catch (_: Exception) { true }
                }
                return true
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = callback
                return try {
                    @Suppress("DEPRECATION")
                    startActivityForResult(params.createIntent(), fileChooserRequest)
                    true
                } catch (_: Exception) {
                    fileChooserCallback?.onReceiveValue(null)
                    fileChooserCallback = null
                    false
                }
            }
        }
        webView.setDownloadListener(DownloadListener { url, userAgent, disposition, mimeType, _ ->
            try {
                val filename = URLUtil.guessFileName(url, disposition, mimeType)
                val request = DownloadManager.Request(Uri.parse(url)).apply {
                    setMimeType(mimeType)
                    addRequestHeader("User-Agent", userAgent)
                    CookieManager.getInstance().getCookie(url)?.let { addRequestHeader("Cookie", it) }
                    setTitle(filename)
                    setDescription("Downloading Fuel Shift System file")
                    setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
                }
                (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
                Toast.makeText(this, "Download started", Toast.LENGTH_SHORT).show()
            } catch (_: Exception) {
                Toast.makeText(this, "Unable to download this file", Toast.LENGTH_LONG).show()
            }
        })
    }

    @Deprecated("Deprecated Android API retained for WebView file chooser compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == fileChooserRequest) {
            val callback = fileChooserCallback ?: return
            fileChooserCallback = null
            callback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    @Deprecated("Deprecated Android API retained for WebView back navigation")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = null
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }
}
