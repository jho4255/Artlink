package cc.artlink.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 앱 안의 플러그인은 npm 이 아니라 여기서 등록한다 — super.onCreate 가 브리지를 만들기 **전에** 불러야 한다
        registerPlugin(ArtLinkShellPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
