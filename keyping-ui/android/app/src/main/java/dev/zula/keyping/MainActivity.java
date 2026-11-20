package dev.zula.keyping;

import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KeypingNativePlugin.class);
        super.onCreate(savedInstanceState);
        // Todas las pantallas pueden mostrar secretos: se bloquean las capturas y la grabación de
        // pantalla, y la vista de apps recientes muestra la ventana en blanco.
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
    }
}
