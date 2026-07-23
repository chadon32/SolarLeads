import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewNavigation } from "react-native-webview";
import type {
  WebViewErrorEvent,
  WebViewNavigationEvent,
} from "react-native-webview/lib/WebViewTypes";
import {
  ALLOWED_HOSTS,
  buildEstimateUrl,
  buildShareUrl,
} from "../config";
import { colors } from "../theme";

type AnalysisScreenProps = {
  address: string;
  onHome: () => void;
};

type AnalysisSection = "roof" | "overview" | "report";

const nativeBootstrapScript = `
  (function () {
    document.documentElement.setAttribute('data-solartelligence-native', 'ios');
    var appModeApplied = false;
    var viewportContent = 'width=device-width, initial-scale=1, viewport-fit=cover';
    var style = document.getElementById('solartelligence-native-style');

    if (!style) {
      style = document.createElement('style');
      style.id = 'solartelligence-native-style';
      (document.head || document.documentElement).appendChild(style);
    }

    style.textContent = [
      'html, body { width: 100% !important; min-width: 0 !important; max-width: 100% !important; overflow-x: hidden !important; background: #03070b !important; overscroll-behavior-y: contain; -webkit-text-size-adjust: 100%; }',
      'body::before { display: none !important; }',
      '#main-content, main, #solar-workspace { width: 100% !important; min-width: 0 !important; max-width: 100% !important; overflow-x: clip !important; }',
      '#solar-workspace { padding: 8px 8px 20px !important; }',
      '#solar-workspace > .grid { width: 100% !important; min-width: 0 !important; max-width: 100% !important; grid-template-columns: minmax(0, 1fr) !important; }',
      '#rooftop-analysis, #report-dashboard { width: 100% !important; min-width: 0 !important; max-width: 100% !important; grid-column: 1 / -1 !important; }',
      '#rooftop-analysis > div, #rooftop-analysis article { width: 100% !important; min-width: 0 !important; max-width: 100% !important; }',
      '#rooftop-analysis { scroll-margin-top: 8px !important; }',
      '.analysis-section { animation: none !important; }'
    ].join(' ');

    function enforceMobileViewport() {
      var viewport = document.querySelector('meta[name="viewport"]');
      if (!viewport) {
        viewport = document.createElement('meta');
        viewport.setAttribute('name', 'viewport');
        (document.head || document.documentElement).appendChild(viewport);
      }
      viewport.setAttribute('content', viewportContent);
    }

    function constrainToViewport(element) {
      if (!element) return;
      element.style.width = '100%';
      element.style.minWidth = '0';
      element.style.maxWidth = '100%';
    }

    function applyAppMode() {
      enforceMobileViewport();
      var main = document.querySelector('main');
      var workspace = document.getElementById('solar-workspace');
      if (!main || !workspace) return;

      Array.prototype.forEach.call(main.children, function (child) {
        if (child !== workspace && !child.contains(workspace)) {
          child.style.display = 'none';
        }
      });

      Array.prototype.forEach.call(workspace.children, function (child) {
        if ((child.textContent || '').indexOf('Roof analysis workspace') !== -1 &&
            !child.querySelector('#rooftop-analysis')) {
          child.style.display = 'none';
        }
      });

      var rooftop = document.getElementById('rooftop-analysis');
      var report = document.getElementById('report-dashboard');
      var contentGrid = rooftop && rooftop.parentElement;

      constrainToViewport(main);
      constrainToViewport(workspace);
      constrainToViewport(contentGrid);
      constrainToViewport(rooftop);
      constrainToViewport(report);

      if (contentGrid) {
        contentGrid.style.gridTemplateColumns = 'minmax(0, 1fr)';
      }
      if (rooftop) rooftop.style.gridColumn = '1 / -1';
      if (report) report.style.gridColumn = '1 / -1';

      if (!appModeApplied) {
        appModeApplied = true;
        requestAnimationFrame(function () { window.scrollTo(0, 0); });
      }
    }

    applyAppMode();
    if (!window.__solartelligenceNativeObserver) {
      var updatePending = false;
      var scheduleAppMode = function () {
        if (updatePending) return;
        updatePending = true;
        requestAnimationFrame(function () {
          updatePending = false;
          applyAppMode();
        });
      };
      window.__solartelligenceNativeObserver = new MutationObserver(scheduleAppMode);
      window.__solartelligenceNativeObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
      window.addEventListener('resize', scheduleAppMode);
    }
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
  })();
  true;
`;

function canStayInApp(rawUrl: string) {
  if (rawUrl === "about:blank" || rawUrl.startsWith("blob:")) return true;

  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && ALLOWED_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function shouldOpenOutside(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return url.pathname === "/api/report/pdf" && url.searchParams.get("download") === "1";
  } catch {
    return false;
  }
}

export function AnalysisScreen({ address, onHome }: AnalysisScreenProps) {
  const webViewRef = useRef<WebView>(null);
  const [webViewKey, setWebViewKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [hasError, setHasError] = useState(false);
  const [activeSection, setActiveSection] = useState<AnalysisSection>("roof");

  function openExternal(url: string) {
    void Linking.openURL(url).catch(() => {
      Alert.alert("Unable to open link", "Please try again in a moment.");
    });
  }

  function handleNavigation(request: WebViewNavigation) {
    if (shouldOpenOutside(request.url)) {
      openExternal(request.url);
      return false;
    }

    if (canStayInApp(request.url)) return true;

    if (
      request.url.startsWith("mailto:") ||
      request.url.startsWith("tel:") ||
      request.url.startsWith("sms:") ||
      request.url.startsWith("https:")
    ) {
      openExternal(request.url);
    }

    return false;
  }

  function handleLoadEnd(event: WebViewNavigationEvent | WebViewErrorEvent) {
    if (event.nativeEvent.url !== "about:blank") {
      setIsLoading(false);
      setLoadProgress(1);
    }
  }

  function retry() {
    setHasError(false);
    setIsLoading(true);
    setLoadProgress(0);
    setWebViewKey((current) => current + 1);
  }

  function scrollToSection(section: AnalysisSection) {
    setActiveSection(section);

    const script =
      section === "report"
        ? `
          (function () {
            var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
            var reportTab = tabs.find(function (tab) { return (tab.textContent || '').trim() === 'Send Report'; });
            if (reportTab) reportTab.click();
            requestAnimationFrame(function () {
              var target = document.getElementById('report-dashboard') || document.getElementById('generate-report');
              if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
          })(); true;
        `
        : section === "overview"
          ? `
            (function () {
              var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
              var overviewTab = tabs.find(function (tab) { return (tab.textContent || '').trim() === 'Overview'; });
              if (overviewTab) overviewTab.click();
              requestAnimationFrame(function () {
                var target = document.getElementById('report-dashboard');
                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
              });
            })(); true;
          `
          : `
            (function () {
              var target = document.getElementById('rooftop-analysis') || document.getElementById('solar-workspace');
              if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            })(); true;
          `;

    webViewRef.current?.injectJavaScript(script);
  }

  async function shareEstimate() {
    await Share.share({
      title: "Solartelligence solar estimate",
      message: `See the solar potential for ${address}: ${buildShareUrl(address)}`,
      url: buildShareUrl(address),
    });
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "right", "bottom", "left"]}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Return home"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onHome}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
        >
          <Text style={styles.headerButtonIcon}>{"<"}</Text>
          <Text style={styles.headerButtonText}>Home</Text>
        </Pressable>
        <View style={styles.headerAddress}>
          <Text style={styles.headerEyebrow}>SOLAR ANALYSIS</Text>
          <Text numberOfLines={1} style={styles.headerTitle}>
            {address}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Share estimate"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => void shareEstimate()}
          style={({ pressed }) => [styles.shareButton, pressed && styles.pressed]}
        >
          <Text style={styles.shareButtonText}>Share</Text>
        </Pressable>
      </View>

      <View style={styles.webContainer}>
        {hasError ? (
          <View style={styles.errorState}>
            <View style={styles.errorMark} />
            <Text style={styles.errorEyebrow}>CONNECTION INTERRUPTED</Text>
            <Text style={styles.errorTitle}>Your analysis could not load.</Text>
            <Text style={styles.errorCopy}>
              Check your connection and retry. Your selected property is still saved.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={retry}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            >
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={onHome} style={styles.homeLink}>
              <Text style={styles.homeLinkText}>Choose another property</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <WebView
              key={webViewKey}
              ref={webViewRef}
              source={{
                uri: buildEstimateUrl(address),
                headers: { "X-App-Platform": "ios" },
              }}
              style={styles.webView}
              originWhitelist={["https://*", "mailto:*", "tel:*", "sms:*", "blob:*"]}
              applicationNameForUserAgent="Solartelligence-iOS/1.1"
              allowsBackForwardNavigationGestures
              allowsInlineMediaPlayback
              allowsLinkPreview={false}
              automaticallyAdjustContentInsets={false}
              bounces
              cacheEnabled
              contentMode="mobile"
              contentInsetAdjustmentBehavior="never"
              injectedJavaScript={nativeBootstrapScript}
              injectedJavaScriptBeforeContentLoaded={nativeBootstrapScript}
              javaScriptCanOpenWindowsAutomatically={false}
              keyboardDisplayRequiresUserAction={false}
              mediaPlaybackRequiresUserAction
              pullToRefreshEnabled
              setSupportMultipleWindows={false}
              sharedCookiesEnabled
              startInLoadingState={false}
              thirdPartyCookiesEnabled
              onContentProcessDidTerminate={() => webViewRef.current?.reload()}
              onError={() => setHasError(true)}
              onFileDownload={(event) => openExternal(event.nativeEvent.downloadUrl)}
              onHttpError={(event) => {
                if (event.nativeEvent.statusCode >= 500) setHasError(true);
              }}
              onLoadEnd={handleLoadEnd}
              onLoadProgress={(event) => {
                setLoadProgress(event.nativeEvent.progress);
                if (event.nativeEvent.progress >= 0.85) setIsLoading(false);
              }}
              onLoadStart={() => {
                setIsLoading(true);
                setLoadProgress(0.05);
              }}
              onOpenWindow={(event) => openExternal(event.nativeEvent.targetUrl)}
              onShouldStartLoadWithRequest={handleNavigation}
            />
            {isLoading ? (
              <View pointerEvents="none" style={styles.loadingState}>
                <View style={styles.loadingCard}>
                  <ActivityIndicator color={colors.cyan} size="small" />
                  <View style={styles.loadingCopy}>
                    <Text style={styles.loadingTitle}>Building your roof model</Text>
                    <Text style={styles.loadingSubtitle}>Loading satellite and solar data...</Text>
                  </View>
                </View>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${Math.max(8, loadProgress * 100)}%` }]} />
                </View>
              </View>
            ) : null}
          </>
        )}
      </View>

      <View style={styles.tabBar}>
        <NativeTab
          active={activeSection === "roof"}
          label="Roof"
          onPress={() => scrollToSection("roof")}
        />
        <NativeTab
          active={activeSection === "overview"}
          label="Overview"
          onPress={() => scrollToSection("overview")}
        />
        <NativeTab
          active={activeSection === "report"}
          label="Report"
          onPress={() => scrollToSection("report")}
        />
      </View>
    </SafeAreaView>
  );
}

function NativeTab({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
    >
      <View style={[styles.tabIndicator, active && styles.tabIndicatorActive]} />
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.backgroundRaised,
  },
  headerButton: { minWidth: 66, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 4, justifyContent: "flex-start" },
  headerButtonIcon: { color: colors.cyan, fontSize: 21, fontWeight: "700" },
  headerButtonText: { color: colors.textSoft, fontSize: 13, fontWeight: "700" },
  headerAddress: { flex: 1, alignItems: "center" },
  headerEyebrow: { color: colors.cyan, fontSize: 8, fontWeight: "800", letterSpacing: 1.5 },
  headerTitle: { maxWidth: "100%", marginTop: 4, color: colors.text, fontSize: 12, fontWeight: "700" },
  shareButton: { minWidth: 62, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel },
  shareButtonText: { color: colors.text, fontSize: 12, fontWeight: "800" },
  webContainer: { flex: 1, backgroundColor: colors.background },
  webView: { flex: 1, backgroundColor: colors.background },
  loadingState: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: 14, paddingTop: 12 },
  loadingCard: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: "rgba(7, 16, 24, 0.96)" },
  loadingCopy: { flex: 1 },
  loadingTitle: { color: colors.text, fontSize: 13, fontWeight: "800" },
  loadingSubtitle: { marginTop: 3, color: colors.muted, fontSize: 11 },
  progressTrack: { height: 2, marginHorizontal: 8, overflow: "hidden", borderRadius: 1, backgroundColor: "rgba(148, 163, 184, 0.15)" },
  progressFill: { height: 2, borderRadius: 1, backgroundColor: colors.cyanStrong },
  tabBar: { minHeight: 62, flexDirection: "row", alignItems: "stretch", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.backgroundRaised },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 7 },
  tabIndicator: { width: 22, height: 3, borderRadius: 2, backgroundColor: "rgba(148, 163, 184, 0.22)" },
  tabIndicatorActive: { width: 34, backgroundColor: colors.cyan },
  tabLabel: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  tabLabelActive: { color: colors.text },
  errorState: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 30 },
  errorMark: { width: 36, height: 36, marginBottom: 22, borderRadius: 18, borderWidth: 2, borderColor: colors.danger },
  errorEyebrow: { color: colors.danger, fontSize: 9, fontWeight: "800", letterSpacing: 1.6 },
  errorTitle: { marginTop: 12, color: colors.text, fontSize: 25, fontWeight: "800", textAlign: "center" },
  errorCopy: { marginTop: 10, color: colors.textSoft, fontSize: 14, lineHeight: 21, textAlign: "center" },
  retryButton: { width: "100%", minHeight: 52, marginTop: 24, alignItems: "center", justifyContent: "center", borderRadius: 26, backgroundColor: colors.white },
  retryText: { color: colors.black, fontSize: 14, fontWeight: "800" },
  homeLink: { minHeight: 46, marginTop: 8, alignItems: "center", justifyContent: "center" },
  homeLinkText: { color: colors.cyan, fontSize: 13, fontWeight: "700" },
  pressed: { opacity: 0.68 },
});
