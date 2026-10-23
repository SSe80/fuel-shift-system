package com.fuelshiftsystem.tankwidget

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class WidgetSetupActivity : Activity() {
    private lateinit var baseUrl: EditText
    private lateinit var operatorId: EditText
    private lateinit var pin: EditText
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 28, 24, 24)
            setBackgroundColor(0xFF101B2A.toInt())
        }
        fun field(label: String, value: String = ""): EditText = EditText(this).apply {
            hint = label
            setText(value)
            setSingleLine(true)
            setTextColor(0xFFFFFFFF.toInt())
            setHintTextColor(0xFF91A8BD.toInt())
        }
        root.addView(TextView(this).apply { text = "Connect Tank Inventory"; textSize = 22f; setTextColor(0xFFFFFFFF.toInt()) })
        root.addView(TextView(this).apply {
            text = "Sign in with your Fuel Shift System admin Operator ID and PIN. The PIN is not saved; the session cookie is encrypted on this device."
            textSize = 14f
            setTextColor(0xFFC6D4E2.toInt())
            setPadding(0, 10, 0, 10)
        })
        baseUrl = field("Worker URL", TankWidgetWorker.DEFAULT_BASE_URL)
        operatorId = field("Admin Operator ID")
        pin = field("PIN").apply { inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD }
        status = TextView(this).apply { textSize = 13f; setTextColor(0xFFC6D4E2.toInt()) }
        root.addView(baseUrl, match())
        root.addView(operatorId, match())
        root.addView(pin, match())
        root.addView(status, match())
        root.addView(Button(this).apply { text = "Connect and refresh"; setOnClickListener { signIn() } }, match())
        root.addView(Button(this).apply { text = "Refresh now"; setOnClickListener { TankInventoryWidgetProvider.enqueueRefresh(this@WidgetSetupActivity) } }, match())
        setContentView(root)
    }

    private fun signIn() {
        val origin = baseUrl.text.toString().trim().trimEnd('/')
        val id = operatorId.text.toString().trim()
        val secret = pin.text.toString()
        if (!origin.startsWith("https://") || id.isBlank() || secret.isBlank()) {
            status.text = "Enter a valid HTTPS Worker URL, Operator ID and PIN."
            return
        }
        status.text = "Signing in securely…"
        thread {
            var connection: HttpURLConnection? = null
            try {
                connection = URL(origin + "/api/admin-login").openConnection() as HttpURLConnection
                connection.requestMethod = "POST"
                connection.connectTimeout = 12000
                connection.readTimeout = 12000
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.setRequestProperty("Accept", "application/json")
                val payload = JSONObject().put("operator_id", id).put("pin", secret).toString()
                connection.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }
                val code = connection.responseCode
                if (code !in 200..299) throw IllegalStateException("Sign-in failed. Check Operator ID, PIN and Worker URL.")
                val header = connection.getHeaderField("Set-Cookie") ?: throw IllegalStateException("No session cookie returned.")
                val cookie = header.substringAfter(TankWidgetWorker.ADMIN_COOKIE_NAME + "=", "").substringBefore(";")
                if (cookie.isBlank()) throw IllegalStateException("Admin session cookie was not returned.")
                securePrefs().edit().putString(TankWidgetWorker.KEY_BASE_URL, origin).putString(TankWidgetWorker.KEY_ADMIN_COOKIE, cookie).apply()
                runOnUiThread {
                    status.text = "Connected. Loading live tank stock…"
                    Toast.makeText(this, "Tank widget connected", Toast.LENGTH_SHORT).show()
                    TankInventoryWidgetProvider.updateAll(this)
                    finishConfigure()
                }
            } catch (e: Exception) {
                runOnUiThread { status.text = e.message ?: "Unable to connect. Try again." }
            } finally { connection?.disconnect() }
        }
    }

    private fun finishConfigure() {
        val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        if (id != AppWidgetManager.INVALID_APPWIDGET_ID) setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id))
        finish()
    }
    private fun match() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = 8 }
    private fun securePrefs() = EncryptedSharedPreferences.create(
        this, TankWidgetWorker.PREFS_NAME,
        MasterKey.Builder(this).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )
}
