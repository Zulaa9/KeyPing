package dev.zula.keyping;

import android.os.Bundle;
import android.view.WindowManager;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KeypingNativePlugin.class);
        super.onCreate(savedInstanceState);
        // Todas las pantallas pueden mostrar secretos: se bloquean las capturas y la grabación de
        // pantalla, y la vista de apps recientes muestra la ventana en blanco.
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        // Atrás del sistema: cierra la pantalla de la app (historial de la WebView). En la pantalla
        // principal la app pasa a segundo plano (y se bloquea) en lugar de cerrarse.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (bridge != null && bridge.getWebView() != null && bridge.getWebView().canGoBack()) {
                    bridge.getWebView().goBack();
                } else {
                    moveTaskToBack(true);
                }
            }
        });
    }
}
