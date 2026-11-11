package cc.artlink.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.core.content.pm.PackageInfoCompat;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.kakao.sdk.auth.AuthCodeClient;
import com.kakao.sdk.auth.model.OAuthToken;
import com.kakao.sdk.common.KakaoSdk;
import com.kakao.sdk.common.model.ClientError;
import com.kakao.sdk.common.model.ClientErrorCause;
import com.kakao.sdk.user.UserApiClient;
import kotlin.Unit;
import kotlin.jvm.functions.Function2;
import java.net.URISyntaxException;
import java.util.Locale;

/**
 * ArtLink 껍데기 전용 플러그인 (2026-11-09) — 웹(artlink.cc)이 "이 앱이 무엇을 할 수 있는가"를 묻고,
 * WebView 가 혼자 처리하지 못하는 주소를 시스템에 넘긴다. 웹 쪽 짝은 frontend/src/lib/native.ts.
 *
 * ⚠️ 웹은 계속 배포되지만 이미 설치된 앱의 네이티브 코드는 그대로다. 웹이 새 네이티브 기능을 쓰려면
 *    info() 의 versionCode 를 보고 가를 것(옛 앱에서 없는 메서드를 부르면 실패한다).
 */
@CapacitorPlugin(name = "ArtLinkShell")
public class ArtLinkShellPlugin extends Plugin {

    @Override
    public void load() {
        // 카카오 SDK — 키는 app/build.gradle 한 곳(resValue). 로그인 버튼을 누르기 전에 한 번만
        KakaoSdk.init(getContext(), getContext().getString(R.string.kakao_native_app_key), null, null);

        // WebView 는 내려받기를 하지 않는다(첨부 파일·포트폴리오 파일이 눌러도 아무 일 없음) — 주소를 시스템(브라우저)에 넘긴다.
        // blob:/data: 는 여기 오기 전에 웹이 직접 처리한다(native.ts saveFile).
        WebView webView = getBridge().getWebView();
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            Uri uri = Uri.parse(url);
            if (isHttp(uri)) openExternally(uri);
        });

        // ⚠️ Capacitor 는 화면(main frame)이 HTTP 오류(4xx·5xx)를 받으면 **어느 사이트든** 오류 화면(offline.html)으로 바꾼다.
        //    카카오 로그인(kauth.kakao.com)이 400 과 함께 KOE 안내 페이지를 내도 '아트링크에 연결하지 못했어요'가 떠서
        //    무슨 일인지 알 수 없었다(2026-11-11 에뮬레이터 실측). 바깥 사이트의 오류 페이지는 그대로 보여 주고,
        //    우리 서버가 오류를 낼 때(배포 중 502 등)만 오류 화면으로 바꾼다. 연결 자체가 안 될 때(onReceivedError)는 그대로다.
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                // (WebViewListener 들에게 알리는 건 건너뛴다 — 목록이 패키지 밖에 안 열려 있고, 그 알림을 쓰는 플러그인이 없다)
                if (request.isForMainFrame() && !isAppHost(request.getUrl())) return;
                super.onReceivedHttpError(view, request, errorResponse);
            }
        });
    }

    /** 앱이 띄우는 우리 서버(server.url — 실서버 artlink.cc, 개발 때 localhost:5173)인가 */
    private boolean isAppHost(Uri url) {
        String app = Uri.parse(getBridge().getAppUrl()).getHost();
        return app != null && app.equalsIgnoreCase(url.getHost());
    }

    /**
     * versionName·versionCode · push(이 앱에 Firebase 설정이 들어 있는가).
     * ⚠️ push=false 면 웹은 PushNotifications.register() 를 부르지 말 것 — google-services.json 없이 빌드한 앱에서 부르면
     *    FirebaseMessaging 이 초기화되지 않은 채 예외를 던지고 플러그인이 잡지 않아 **앱이 죽는다**.
     */
    @PluginMethod
    public void info(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            ret.put("versionName", pi.versionName);
            ret.put("versionCode", PackageInfoCompat.getLongVersionCode(pi));
        } catch (PackageManager.NameNotFoundException e) {
            ret.put("versionName", "");
            ret.put("versionCode", 0);
        }
        ret.put("push", hasFirebaseConfig());
        // 이 앱은 kakaoLogin() 을 안다 — 없는 옛 앱이면 웹은 예전처럼 카카오 웹 로그인으로(lib/native.ts)
        ret.put("kakao", true);
        call.resolve(ret);
    }

    /**
     * 카카오 로그인 — 폰의 카카오톡으로 바로(없거나 거기서 실패하면 카카오 계정 화면). 앱 안 웹 화면(WebView)에서는 카카오 웹 로그인이
     * 카카오톡으로 넘어갔다 돌아올 수 없어 이메일·비밀번호만 보였다(2026-11-11 실기기). 결과는 카카오 접근 토큰 —
     * 웹이 서버 POST /api/auth/kakao/native 로 넘기고, 서버가 우리 카카오 앱에서 나온 토큰인지 확인한 뒤 로그인시킨다.
     * 사용자가 취소하면 code=CANCELLED 로 실패(웹은 조용히 멈춘다).
     */
    @PluginMethod
    public void kakaoLogin(PluginCall call) {
        UserApiClient client = UserApiClient.Companion.getInstance();
        Function2<OAuthToken, Throwable, Unit> byAccount = (token, error) -> { finishKakao(call, token, error); return Unit.INSTANCE; };
        if (client.isKakaoTalkLoginAvailable(getActivity())) {
            client.loginWithKakaoTalk(getActivity(), AuthCodeClient.DEFAULT_REQUEST_CODE, null, null, null, (token, error) -> {
                if (error != null && !isKakaoCancel(error)) {
                    // 카카오톡에 로그인돼 있지 않은 등 — 카카오 계정 화면으로 이어 간다
                    client.loginWithKakaoAccount(getActivity(), null, null, null, null, null, byAccount);
                } else {
                    finishKakao(call, token, error);
                }
                return Unit.INSTANCE;
            });
        } else {
            client.loginWithKakaoAccount(getActivity(), null, null, null, null, null, byAccount);
        }
    }

    private static boolean isKakaoCancel(Throwable error) {
        return error instanceof ClientError && ((ClientError) error).getReason() == ClientErrorCause.Cancelled;
    }

    private static void finishKakao(PluginCall call, OAuthToken token, Throwable error) {
        if (error != null) {
            if (isKakaoCancel(error)) call.reject("카카오 로그인을 취소했어요.", "CANCELLED");
            else call.reject(error.getMessage() == null ? "카카오 로그인에 실패했어요." : error.getMessage(), "FAILED");
            return;
        }
        if (token == null) { call.reject("카카오 로그인에 실패했어요.", "FAILED"); return; }
        JSObject ret = new JSObject();
        ret.put("accessToken", token.getAccessToken());
        call.resolve(ret);
    }

    /** google-services 플러그인이 google-services.json 으로 만드는 리소스 — 있으면 Firebase 기본 앱이 뜬다 */
    private boolean hasFirebaseConfig() {
        return getContext().getResources().getIdentifier("google_app_id", "string", getContext().getPackageName()) != 0;
    }

    /**
     * WebView 가 열려는 주소를 먼저 본다. intent:// 만 맡고 나머지는 Capacitor 기본 규칙에 맡긴다
     * (우리 주소·allowNavigation 은 WebView 안, 그 밖의 http·tel·mailto·kakaotalk:// 등은 시스템).
     * intent:// 는 카카오 로그인 화면의 [카카오톡으로 로그인] 같은 '앱 띄우기' 주소다 — WebView 는 못 연다.
     */
    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        String scheme = url.getScheme() == null ? "" : url.getScheme().toLowerCase(Locale.ROOT);
        if ("intent".equals(scheme)) {
            openIntentUrl(url.toString());
            return true;
        }
        return null;
    }

    private void openIntentUrl(String raw) {
        Intent intent;
        try {
            intent = Intent.parseUri(raw, Intent.URI_INTENT_SCHEME);
        } catch (URISyntaxException e) {
            return;
        }
        // 웹 페이지가 아무 화면이나 띄우지 못하게 — 브라우저에서 열 수 있다고 밝힌(BROWSABLE) 화면만, 지정 컴포넌트는 지운다
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        intent.setComponent(null);
        intent.setSelector(null);
        // ⚠️ 주소에 실려 온 권한 넘기기(FLAG_GRANT_* — 우리 앱의 파일을 그 앱이 읽게 된다)·첨부(ClipData)는 지운다.
        //    기기 안 파일을 가리키는 주소(content://·file://)는 열지 않는다(2026-11-11 보안 검토).
        intent.setFlags(0);
        intent.setClipData(null);
        Uri data = intent.getData();
        String dataScheme = data == null || data.getScheme() == null ? "" : data.getScheme().toLowerCase(Locale.ROOT);
        if ("content".equals(dataScheme) || "file".equals(dataScheme)) return;
        try {
            getActivity().startActivity(intent);
            return;
        } catch (ActivityNotFoundException ignored) {
            // 그 앱이 없다 — 아래 대체 주소로
        }
        String fallback = intent.getStringExtra("browser_fallback_url");
        if (fallback != null) {
            Uri f = Uri.parse(fallback);
            // 허용 주소면 같은 WebView 로, 아니면 launchIntent 가 시스템에 넘기고 true 를 준다
            if (isHttp(f) && !getBridge().launchIntent(f)) {
                getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(fallback));
            }
            return;
        }
        String pkg = intent.getPackage();
        if (pkg != null) openExternally(Uri.parse("market://details?id=" + pkg));
    }

    private static boolean isHttp(Uri uri) {
        String s = uri.getScheme();
        return "http".equalsIgnoreCase(s) || "https".equalsIgnoreCase(s);
    }

    private void openExternally(Uri uri) {
        try {
            Intent view = new Intent(Intent.ACTION_VIEW, uri);
            view.addCategory(Intent.CATEGORY_BROWSABLE);
            getActivity().startActivity(view);
        } catch (ActivityNotFoundException ignored) {
            // 열 앱이 없다 — 할 수 있는 게 없다
        }
    }
}
