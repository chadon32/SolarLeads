import { useEffect, useRef, useState } from "react";
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
  WebViewMessageEvent,
  WebViewNavigationEvent,
} from "react-native-webview/lib/WebViewTypes";
import {
  ALLOWED_HOSTS,
  APP_URL,
  buildEstimateUrl,
  buildShareUrl,
} from "../config";
import {
  createNativeSectionNavigationScript,
  initialNativeAnalysisState,
  transitionNativeAnalysisState,
  type AnalysisSection,
  type NativeAnalysisEvent,
} from "../analysis-bridge";
import { isEstimateDocument, sanitizeEstimateShareUrl } from "../estimate-navigation";
import { colors } from "../theme";

type AnalysisScreenProps = {
  address: string;
  onHome: () => void;
};

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

    function postSection(section) {
      if (window.__solartelligenceNativeLastSection === section) return;
      window.__solartelligenceNativeLastSection = section;
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'analysis-section',
          section: section
        }));
      }
    }

    function observeSection() {
      var rooftop = document.getElementById('rooftop-analysis');
      var report = document.getElementById('report-dashboard');
      var reportBox = report && report.getBoundingClientRect();
      var reportTablist = report && report.querySelector('[role="tablist"]');
      var reportTablistBox = reportTablist && reportTablist.getBoundingClientRect();
      var reportIsVisible =
        (reportTablistBox && reportTablistBox.top < window.innerHeight && reportTablistBox.bottom > 0) ||
        (reportBox && reportBox.top <= window.innerHeight * 0.5 && reportBox.bottom > 0);

      if (reportIsVisible) {
        var tabs = Array.prototype.slice.call(report.querySelectorAll('[role="tab"]'));
        var selectedTab = tabs.find(function (tab) { return tab.getAttribute('aria-selected') === 'true'; });
        if (selectedTab && (selectedTab.textContent || '').trim() === 'Send Report') {
          postSection('report');
          return;
        }
        postSection('overview');
        return;
      }

      if (rooftop) postSection('roof');
    }

    function scheduleSectionObservation() {
      if (window.__solartelligenceNativeSectionUpdatePending) return;
      window.__solartelligenceNativeSectionUpdatePending = true;
      requestAnimationFrame(function () {
        window.__solartelligenceNativeSectionUpdatePending = false;
        observeSection();
      });
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
          scheduleSectionObservation();
        });
      };
      window.__solartelligenceNativeObserver = new MutationObserver(scheduleAppMode);
      window.__solartelligenceNativeObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
      window.addEventListener('resize', scheduleAppMode);
    }
    if (!window.__solartelligenceNativeSectionObserver) {
      window.__solartelligenceNativeSectionObserver = true;
      window.addEventListener('scroll', scheduleSectionObservation, { passive: true });
      window.addEventListener('resize', scheduleSectionObservation);
      document.addEventListener('click', scheduleSectionObservation, true);
    }
    scheduleSectionObservation();
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
  const shareUrlRef = useRef(buildShareUrl(address));
  const loadCompletedRef = useRef(false);
  const analysisStateRef = useRef(initialNativeAnalysisState);
  const [estimateDocument, setEstimateDocument] = useState(true);
  const webViewRef = useRef<WebView>(null);
  const loadFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [webViewKey, setWebViewKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [hasError, setHasError] = useState(false);
  const [activeSection, setActiveSection] = useState<AnalysisSection>("roof");
  const [analysisReady, setAnalysisReady] = useState(false);

  useEffect(() => {
    return () => {
      if (loadFallbackRef.current) clearTimeout(loadFallbackRef.current);
    };
  }, []);

  function finishLoading() {
    if (loadFallbackRef.current) {
      clearTimeout(loadFallbackRef.current);
      loadFallbackRef.current = null;
    }
    setIsLoading(false);
    setLoadProgress(1);
  }

  function updateAnalysisState(event: NativeAnalysisEvent) {
    const nextState = transitionNativeAnalysisState(analysisStateRef.current, event);
    analysisStateRef.current = nextState;
    setAnalysisReady(nextState.analysisReady);
    setActiveSection(nextState.activeSection);
  }

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
    if (!isEstimateDocument(event.nativeEvent.url) || loadCompletedRef.current) {
      finishLoading();
      return;
    }
    if (event.nativeEvent.url !== "about:blank") {
      setLoadProgress((current) => Math.max(current, 0.9));
      if (loadFallbackRef.current) clearTimeout(loadFallbackRef.current);
      loadFallbackRef.current = setTimeout(finishLoading, 30_000);
    }
  }

  function handleMessage(event: WebViewMessageEvent) {
    try {
      const message = JSON.parse(event.nativeEvent.data) as {
        section?: unknown;
        status?: string;
        type?: string;
        url?: unknown;
      };

      if (!canStayInApp(event.nativeEvent.url)) return;
      if (message.type === "estimate-share") {
        const safeUrl = sanitizeEstimateShareUrl(message.url, APP_URL);
        if (safeUrl) shareUrlRef.current = safeUrl;
      }
      if (
        message.type === "analysis-status" &&
        (message.status === "done" ||
          message.status === "invalid" ||
          message.status === "error")
      ) {
        loadCompletedRef.current = true;
        updateAnalysisState({ type: "analysis-status", status: message.status });
        finishLoading();
      }
      if (message.type === "analysis-section") {
        updateAnalysisState({ type: "analysis-section", section: message.section });
      }
    } catch {
      // Ignore unrelated WebView messages. Only trusted typed bridge events
      // control native loading and section state.
    }
  }

  function retry() {
    if (loadFallbackRef.current) clearTimeout(loadFallbackRef.current);
    loadCompletedRef.current = false;
    updateAnalysisState({ type: "reset" });
    setHasError(false);
    setIsLoading(true);
    setLoadProgress(0);
    setWebViewKey((current) => current + 1);
  }

  function scrollToSection(section: AnalysisSection) {
    if (!analysisStateRef.current.analysisReady) return;
    webViewRef.current?.injectJavaScript(createNativeSectionNavigationScript(section));
  }

  async function shareEstimate() {
    try {
      await Share.share({
        title: "Solartelligence solar estimate",
        message: `See this customized solar estimate: ${shareUrlRef.current}`,
        url: shareUrlRef.current,
      });
    } catch {
      Alert.alert("Unable to share", "Your estimate is still available. Please try again.");
    }
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
          <View accessibilityLiveRegion="assertive" style={styles.errorState}>
            <View style={styles.errorMark} />
            <Text style={styles.errorEyebrow}>CONNECTION INTERRUPTED</Text>
            <Text style={styles.errorTitle}>Your analysis could not load.</Text>
            <Text style={styles.errorCopy}>
              Check your connection and retry. Your selected property is still saved.
            </Text>
            <Pressable
              accessibilityHint="Reloads the analysis for this property."
              accessibilityLabel="Try loading the analysis again"
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
              onContentProcessDidTerminate={() => {
                loadCompletedRef.current = false;
                updateAnalysisState({ type: "reset" });
                setHasError(false);
                setIsLoading(true);
                setLoadProgress(0.05);
                webViewRef.current?.reload();
              }}
              onError={() => {
                loadCompletedRef.current = false;
                updateAnalysisState({ type: "reset" });
                finishLoading();
                setHasError(true);
              }}
              onFileDownload={(event) => openExternal(event.nativeEvent.downloadUrl)}
              onHttpError={(event) => {
                if (
                  event.nativeEvent.statusCode >= 400 &&
                  isEstimateDocument(event.nativeEvent.url)
                ) {
                  loadCompletedRef.current = false;
                  updateAnalysisState({ type: "reset" });
                  finishLoading();
                  setHasError(true);
                }
              }}
              onLoadEnd={handleLoadEnd}
              onLoadProgress={(event) => {
                setLoadProgress(Math.min(event.nativeEvent.progress * 0.9, 0.9));
              }}
              onNavigationStateChange={(navigation) => {
                const estimate = isEstimateDocument(navigation.url);
                setEstimateDocument(estimate);
                if (!estimate) {
                  loadCompletedRef.current = false;
                  updateAnalysisState({ type: "reset" });
                  if (!navigation.loading) finishLoading();
                }
                const safeUrl = sanitizeEstimateShareUrl(navigation.url, APP_URL);
                if (safeUrl) shareUrlRef.current = safeUrl;
              }}
              onLoadStart={(event) => {
                if (loadFallbackRef.current) clearTimeout(loadFallbackRef.current);
                loadCompletedRef.current = false;
                updateAnalysisState({ type: "reset" });
                setEstimateDocument(isEstimateDocument(event.nativeEvent.url));
                setIsLoading(true);
                setLoadProgress(0.05);
              }}
              onOpenWindow={(event) => openExternal(event.nativeEvent.targetUrl)}
              onMessage={handleMessage}
              onShouldStartLoadWithRequest={handleNavigation}
            />
            {isLoading ? (
              <View
                accessible
                accessibilityLabel={estimateDocument ? "Building your roof model" : "Loading page"}
                accessibilityRole="progressbar"
                accessibilityValue={{
                  max: 100,
                  min: 0,
                  now: Math.round(loadProgress * 100),
                  text: `${Math.round(loadProgress * 100)} percent loaded`,
                }}
                pointerEvents="none"
                style={styles.loadingState}
              >
                <View style={styles.loadingCard}>
                  <ActivityIndicator color={colors.cyan} size="small" />
                  <View style={styles.loadingCopy}>
                    <Text style={styles.loadingTitle}>{estimateDocument ? "Building your roof model" : "Loading page"}</Text>
                    <Text style={styles.loadingSubtitle}>{estimateDocument ? "Loading satellite and solar data..." : "Opening your page..."}</Text>
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

      {estimateDocument ? (
        <View style={styles.tabBar}>
          <NativeTab
            active={analysisReady && activeSection === "roof"}
            enabled={analysisReady}
            label="Roof"
            onPress={() => scrollToSection("roof")}
          />
          <NativeTab
            active={analysisReady && activeSection === "overview"}
            enabled={analysisReady}
            label="Overview"
            onPress={() => scrollToSection("overview")}
          />
          <NativeTab
            active={analysisReady && activeSection === "report"}
            enabled={analysisReady}
            label="Report"
            onPress={() => scrollToSection("report")}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function NativeTab({
  active,
  enabled,
  label,
  onPress,
}: {
  active: boolean;
  enabled: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint={
        enabled
          ? `Moves the analysis to the ${label.toLowerCase()} section.`
          : "Available after the roof analysis finishes."
      }
      accessibilityLabel={`${label} section`}
      accessibilityRole="tab"
      accessibilityState={{ disabled: !enabled, selected: active }}
      disabled={!enabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tab,
        !enabled && styles.tabDisabled,
        pressed && enabled && styles.pressed,
      ]}
    >
      <View style={[styles.tabIndicator, active && styles.tabIndicatorActive]} />
      <Text style={[styles.tabLabel, !enabled && styles.tabLabelDisabled, active && styles.tabLabelActive]}>{label}</Text>
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
  headerTitle: { maxWidth: "100%", marginTop: 4, color: colors.text, fontSize: 13, fontWeight: "700" },
  shareButton: { minWidth: 66, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel },
  shareButtonText: { color: colors.text, fontSize: 13, fontWeight: "800" },
  webContainer: { flex: 1, backgroundColor: colors.background },
  webView: { flex: 1, backgroundColor: colors.background },
  loadingState: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: 14, paddingTop: 12 },
  loadingCard: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: "rgba(7, 16, 24, 0.96)" },
  loadingCopy: { flex: 1 },
  loadingTitle: { color: colors.text, fontSize: 13, fontWeight: "800" },
  loadingSubtitle: { marginTop: 3, color: colors.textSoft, fontSize: 12 },
  progressTrack: { height: 2, marginHorizontal: 8, overflow: "hidden", borderRadius: 1, backgroundColor: "rgba(148, 163, 184, 0.15)" },
  progressFill: { height: 2, borderRadius: 1, backgroundColor: colors.cyanStrong },
  tabBar: { minHeight: 62, flexDirection: "row", alignItems: "stretch", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.backgroundRaised },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 7 },
  tabDisabled: { opacity: 0.5 },
  tabIndicator: { width: 22, height: 3, borderRadius: 2, backgroundColor: "rgba(148, 163, 184, 0.22)" },
  tabIndicatorActive: { width: 34, backgroundColor: colors.cyan },
  tabLabel: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  tabLabelDisabled: { color: colors.muted },
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
