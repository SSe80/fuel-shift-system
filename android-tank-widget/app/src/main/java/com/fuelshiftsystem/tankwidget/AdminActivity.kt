package com.fuelshiftsystem.tankwidget

import android.app.Activity
import android.app.AlertDialog
import android.app.DownloadManager
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
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
import android.widget.LinearLayout
import android.widget.Toast
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** Hosts the Admin login first and connects the bundled tank widget after successful sign-in. */
class AdminActivity : Activity() {
    private lateinit var webView: WebView
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private val fileChooserRequest = 4102
    private val appUrl = "https://fuel-shift-system.servicestation50.workers.dev/admin-login.html"
    private val allowedHost = "fuel-shift-system.servicestation50.workers.dev"
    private var widgetPromptShownThisLaunch = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CookieManager.getInstance().setAcceptCookie(true)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFFFFFFFF.toInt())
        }
        // Keep the web experience full-screen: no app-specific toolbar above the website.
        webView = WebView(this)
        root.addView(webView, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ))
        setContentView(root)
        configureWebView()
        if (savedInstanceState == null) webView.loadUrl(appUrl)
        else webView.restoreState(savedInstanceState)
    }

    /**
     * The website login sets the authoritative HttpOnly admin session cookie.
     * Copy that cookie into encrypted app storage so the widget uses the same
     * signed-in admin session without asking for the Operator ID and PIN again.
     */
    private fun captureAdminSessionAndOfferWidget(url: String) {
        val uri = Uri.parse(url)
        if (uri.host != allowedHost || uri.path?.endsWith("/admin-dashboard.html") != true) return

        val allCookies = CookieManager.getInstance().getCookie("https://$allowedHost") ?: return
        val cookie = allCookies.split(";")
            .map { it.trim() }
            .firstOrNull { it.startsWith(TankWidgetWorker.ADMIN_COOKIE_NAME + "=") }
            ?.substringAfter("=")
            ?.takeIf { it.isNotBlank() } ?: return

        try {
            securePrefs().edit()
                .putString(TankWidgetWorker.KEY_BASE_URL, "https://$allowedHost")
                .putString(TankWidgetWorker.KEY_ADMIN_COOKIE, cookie)
                .apply()
            TankInventoryWidgetProvider.updateAll(this)
        } catch (_: Exception) {
            Toast.makeText(this, "Could not securely connect the tank widget.", Toast.LENGTH_LONG).show()
            return
        }

        if (widgetPromptShownThisLaunch) return
        val prefs = getSharedPreferences("fuel_admin_widget_setup", MODE_PRIVATE)
        if (prefs.getBoolean("widget_enable_prompted", false)) return
        widgetPromptShownThisLaunch = true

        AlertDialog.Builder(this)
            .setTitle("Enable Tank Inventory widget?")
            .setMessage("Your admin account is now connected. Add the Tank Inventory widget to your Home screen to see live tank stock. Android will ask you to confirm adding it.")
            .setPositiveButton("Enable widget") { _, _ ->
                prefs.edit().putBoolean("widget_enable_prompted", true).apply()
                val manager = AppWidgetManager.getInstance(this)
                val component = ComponentName(this, TankInventoryWidgetProvider::class.java)
                val existing = manager.getAppWidgetIds(component)
                if (existing.isNotEmpty()) {
                    TankInventoryWidgetProvider.updateAll(this)
                    Toast.makeText(this, "Tank widget connected to your admin account.", Toast.LENGTH_LONG).show()
                    return@setPositiveButton
                }
                if (!manager.isRequestPinAppWidgetSupported) {
                    Toast.makeText(this, "Your launcher does not support automatic widget adding. Add Tank Inventory from the Home screen Widgets menu.", Toast.LENGTH_LONG).show()
                    return@setPositiveButton
                }
                val requested = try {
                    manager.requestPinAppWidget(component, null, null)
                } catch (_: Exception) {
                    false
                }
                if (!requested) {
                    Toast.makeText(this, "Add Tank Inventory from your Home screen Widgets menu.", Toast.LENGTH_LONG).show()
                }
            }
            .setNegativeButton("Not now") { _, _ ->
                prefs.edit().putBoolean("widget_enable_prompted", true).apply()
            }
            .setCancelable(true)
            .show()
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
                        """(function(){var a=document.querySelector('a[href*="Fuel-Shift-System-Admin.apk"]');if(a)a.remove();})();""",
                        null
                    )
                }
                captureAdminSessionAndOfferWidget(url)
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

    private fun securePrefs() = EncryptedSharedPreferences.create(
        this,
        TankWidgetWorker.PREFS_NAME,
        MasterKey.Builder(this).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

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
