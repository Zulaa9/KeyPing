package dev.zula.keyping;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PersistableBundle;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/**
 * Servicios nativos de KeyPing para Android. Sin red: solo almacenamiento privado, portapapeles,
 * abrir enlaces http(s) en el navegador del sistema y entregar archivos de exportación.
 */
@CapacitorPlugin(name = "KeypingNative")
public class KeypingNativePlugin extends Plugin {

    private static final String DATA_DIR = "keyping";
    private static final String EXPORT_DIR = "exports";
    private static final String CLIP_LABEL = "KeyPing";
    // Solo los archivos que usa la app (kp-auth.json, keyping-vault.kp, ...): nada de rutas.
    private static final Pattern SAFE_NAME = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$");
    private static final Pattern SAFE_EXPORT = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\\.(kpenc|keyping)$");

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable pendingClear;
    private String pendingSaveData;

    // ---------------- Almacenamiento privado (Context.getFilesDir()/keyping) ----------------

    private File dataFile(String name) throws IOException {
        if (name == null || !SAFE_NAME.matcher(name).matches()) throw new IOException("invalid-name");
        File dir = new File(getContext().getFilesDir(), DATA_DIR);
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("mkdir-failed");
        return new File(dir, name);
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        try {
            File f = dataFile(call.getString("name"));
            JSObject ret = new JSObject();
            if (!f.exists()) {
                ret.put("data", JSObject.NULL);
            } else {
                try (InputStream in = new FileInputStream(f)) {
                    ret.put("data", new String(readAll(in), StandardCharsets.UTF_8));
                }
            }
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("read-error");
        }
    }

    /** Escritura atómica: temporal + fsync + rename (nunca deja la bóveda a medias). */
    @PluginMethod
    public void writeFile(PluginCall call) {
        try {
            File f = dataFile(call.getString("name"));
            String data = call.getString("data", "");
            File tmp = new File(f.getParentFile(), f.getName() + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(data.getBytes(StandardCharsets.UTF_8));
                out.getFD().sync();
            }
            if (!tmp.renameTo(f)) {
                tmp.delete();
                throw new IOException("rename-failed");
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("write-error");
        }
    }

    @PluginMethod
    public void deleteFile(PluginCall call) {
        try {
            File f = dataFile(call.getString("name"));
            if (f.exists() && !f.delete()) throw new IOException("delete-failed");
            call.resolve();
        } catch (Exception e) {
            call.reject("delete-error");
        }
    }

    // ---------------- Portapapeles sensible con autolimpieza ----------------

    @PluginMethod
    public void copySensitive(PluginCall call) {
        String text = call.getString("text", "");
        long ttl = Math.max(1000, Math.min(120000, call.getLong("ttlMs", 20000L)));
        ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
        ClipData clip = ClipData.newPlainText(CLIP_LABEL, text);
        // Android 13+: el sistema no muestra el contenido en la vista previa del portapapeles.
        PersistableBundle extras = new PersistableBundle();
        if (Build.VERSION.SDK_INT >= 33) {
            extras.putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true);
        } else {
            extras.putBoolean("android.content.extra.IS_SENSITIVE", true);
        }
        clip.getDescription().setExtras(extras);
        cm.setPrimaryClip(clip);
        if (pendingClear != null) handler.removeCallbacks(pendingClear);
        pendingClear = this::clearIfOwned;
        handler.postDelayed(pendingClear, ttl);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void clearClipboardIfOwned(PluginCall call) {
        if (pendingClear != null) {
            handler.removeCallbacks(pendingClear);
            clearIfOwned();
        }
        call.resolve();
    }

    private void clearIfOwned() {
        pendingClear = null;
        ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
        ClipDescription desc = cm.getPrimaryClipDescription();
        // Si el sistema no deja leer la descripción (app en segundo plano), se borra igualmente:
        // es preferible perder un texto ajeno copiado en esos segundos que dejar el secreto.
        if (desc != null && !CLIP_LABEL.contentEquals(desc.getLabel() == null ? "" : desc.getLabel())) return;
        if (Build.VERSION.SDK_INT >= 28) {
            cm.clearPrimaryClip();
        } else {
            cm.setPrimaryClip(ClipData.newPlainText("", ""));
        }
    }

    // ---------------- Enlaces ----------------

    /** Abre el enlace en el navegador del sistema. Solo http y https. */
    @PluginMethod
    public void openExternal(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            Uri uri = Uri.parse(call.getString("url", ""));
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
            if ((!scheme.equals("https") && !scheme.equals("http")) || uri.getHost() == null || uri.getUserInfo() != null) {
                ret.put("ok", false);
                call.resolve(ret);
                return;
            }
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            ret.put("ok", true);
        } catch (Exception e) {
            ret.put("ok", false);
        }
        call.resolve(ret);
    }

    // ---------------- Exportación: guardar con el selector del sistema o compartir ----------------

    @PluginMethod
    public void saveFile(PluginCall call) {
        String filename = call.getString("filename", "");
        if (!SAFE_EXPORT.matcher(filename).matches()) {
            call.reject("invalid-name");
            return;
        }
        pendingSaveData = call.getString("data", "");
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/octet-stream");
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(call, intent, "onSaveResult");
    }

    @ActivityCallback
    private void onSaveResult(PluginCall call, ActivityResult result) {
        JSObject ret = new JSObject();
        String data = pendingSaveData;
        pendingSaveData = null;
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null || data == null) {
            ret.put("ok", false);
            call.resolve(ret);
            return;
        }
        try (OutputStream out = getContext().getContentResolver().openOutputStream(result.getData().getData(), "wt")) {
            if (out == null) throw new IOException("no-stream");
            out.write(data.getBytes(StandardCharsets.UTF_8));
            ret.put("ok", true);
        } catch (Exception e) {
            ret.put("ok", false);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void shareFile(PluginCall call) {
        String filename = call.getString("filename", "");
        if (!SAFE_EXPORT.matcher(filename).matches()) {
            call.reject("invalid-name");
            return;
        }
        try {
            File dir = new File(getContext().getCacheDir(), EXPORT_DIR);
            // Solo un archivo compartido cada vez: los anteriores se borran.
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) f.delete();
            if (!dir.exists() && !dir.mkdirs()) throw new IOException("mkdir-failed");
            File file = new File(dir, filename);
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(call.getString("data", "").getBytes(StandardCharsets.UTF_8));
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("application/octet-stream");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, filename);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(chooser);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("share-error");
        }
    }

    // ---------------- Ciclo de vida ----------------

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        // La capa web bloquea la bóveda al recibirlo (además de visibilitychange).
        notifyListeners("paused", new JSObject());
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[16384];
        int n;
        while ((n = in.read(chunk)) != -1) buf.write(chunk, 0, n);
        return buf.toByteArray();
    }
}
