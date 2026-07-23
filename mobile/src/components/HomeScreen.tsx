import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  fetchPlaceAddress,
  PlaceLookupError,
  searchArizonaAddresses,
  type PlacePrediction,
} from "../api/places";
import { APP_URL } from "../config";
import { colors, radii } from "../theme";

type HomeScreenProps = {
  lastAddress: string;
  onAnalyze: (address: string) => void;
};

export function HomeScreen({ lastAddress, onAnalyze }: HomeScreenProps) {
  const [query, setQuery] = useState("");
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [selectedAddress, setSelectedAddress] = useState("");
  const [searching, setSearching] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState("");
  const requestNumber = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    const currentRequest = ++requestNumber.current;
    const controller = new AbortController();

    if (selectedAddress || trimmed.length < 3) {
      return () => controller.abort();
    }

    const timer = setTimeout(() => {
      setSearching(true);
      setError("");

      void searchArizonaAddresses(trimmed, controller.signal)
        .then((results) => {
          if (currentRequest !== requestNumber.current) return;
          setPredictions(results);
          if (!results.length) {
            setError("No matching Arizona homes found. Check the street and ZIP code.");
          }
        })
        .catch((lookupError: unknown) => {
          if (controller.signal.aborted || currentRequest !== requestNumber.current) {
            return;
          }
          setPredictions([]);
          setError(
            lookupError instanceof PlaceLookupError
              ? lookupError.message
              : "Address search is temporarily unavailable."
          );
        })
        .finally(() => {
          if (currentRequest === requestNumber.current) setSearching(false);
        });
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, selectedAddress]);

  async function selectPrediction(prediction: PlacePrediction) {
    setSelecting(true);
    setError("");
    Keyboard.dismiss();

    try {
      const property = await fetchPlaceAddress(prediction.place_id);
      setQuery(property.address);
      setSelectedAddress(property.address);
      setPredictions([]);
    } catch (lookupError) {
      setError(
        lookupError instanceof PlaceLookupError
          ? lookupError.message
          : "That property could not be verified."
      );
    } finally {
      setSelecting(false);
    }
  }

  function updateQuery(value: string) {
    setQuery(value);
    setSelectedAddress("");
    setPredictions([]);
    setSearching(false);
    setError("");
  }

  function submitSearch() {
    if (selectedAddress) {
      onAnalyze(selectedAddress);
      return;
    }

    if (predictions[0]) {
      void selectPrediction(predictions[0]);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "right", "bottom", "left"]}>
      <StatusDecoration />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <View style={styles.brandSun} />
            </View>
            <View style={styles.brandCopy}>
              <Text style={styles.brand}>SOLARTELLIGENCE</Text>
              <Text style={styles.brandTagline}>ROOF INTELLIGENCE FOR HOMEOWNERS</Text>
            </View>
          </View>

          <View style={styles.hero}>
            <View style={styles.eyebrowPill}>
              <View style={styles.liveDot} />
              <Text style={styles.eyebrow}>ARIZONA SOLAR READINESS</Text>
            </View>
            <Text style={styles.title}>See what solar could do for your roof.</Text>
            <Text style={styles.subtitle}>
              Search your address for a satellite roof model, preliminary panel
              layout, and personalized savings estimate.
            </Text>
          </View>

          <View style={styles.searchCard}>
            <Text style={styles.inputLabel}>PROPERTY ADDRESS</Text>
            <View style={[styles.inputShell, error ? styles.inputShellError : null]}>
              <View style={styles.pinOuter}>
                <View style={styles.pinInner} />
              </View>
              <TextInput
                accessibilityLabel="Arizona property address"
                autoCapitalize="words"
                autoComplete="street-address"
                autoCorrect={false}
                onChangeText={updateQuery}
                onSubmitEditing={submitSearch}
                placeholder="Enter an Arizona home address"
                placeholderTextColor="#667588"
                returnKeyType="search"
                selectionColor={colors.cyan}
                style={styles.input}
                value={query}
              />
              {searching || selecting ? (
                <ActivityIndicator color={colors.cyan} size="small" />
              ) : null}
            </View>

            {predictions.length > 0 ? (
              <View style={styles.suggestionList}>
                {predictions.map((prediction, index) => (
                  <Pressable
                    accessibilityRole="button"
                    key={prediction.place_id}
                    onPress={() => void selectPrediction(prediction)}
                    style={({ pressed }) => [
                      styles.suggestion,
                      index > 0 && styles.suggestionDivider,
                      pressed && styles.suggestionPressed,
                    ]}
                  >
                    <View style={styles.suggestionMarker} />
                    <View style={styles.suggestionCopy}>
                      <Text numberOfLines={1} style={styles.suggestionMain}>
                        {prediction.structured_formatting?.main_text ??
                          prediction.description}
                      </Text>
                      <Text numberOfLines={1} style={styles.suggestionSecondary}>
                        {prediction.structured_formatting?.secondary_text ??
                          prediction.description}
                      </Text>
                    </View>
                    <Text style={styles.chevron}>{">"}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            {selectedAddress ? (
              <View style={styles.selectedCard}>
                <Text style={styles.selectedLabel}>VERIFIED PROPERTY</Text>
                <Text style={styles.selectedAddress}>{selectedAddress}</Text>
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={!selectedAddress || selecting}
              onPress={() => onAnalyze(selectedAddress)}
              style={({ pressed }) => [
                styles.primaryButton,
                !selectedAddress && styles.primaryButtonDisabled,
                pressed && selectedAddress && styles.primaryButtonPressed,
              ]}
            >
              <Text style={styles.primaryButtonText}>Analyze this roof</Text>
              <Text style={styles.primaryArrow}>{">"}</Text>
            </Pressable>
            <Text style={styles.helper}>
              Free preliminary analysis. Final design requires installer verification.
            </Text>
          </View>

          {lastAddress && lastAddress !== selectedAddress ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => onAnalyze(lastAddress)}
              style={({ pressed }) => [
                styles.recentCard,
                pressed && styles.suggestionPressed,
              ]}
            >
              <View style={styles.recentIcon}>
                <View style={styles.recentIconHand} />
              </View>
              <View style={styles.recentCopy}>
                <Text style={styles.recentLabel}>CONTINUE LAST ANALYSIS</Text>
                <Text numberOfLines={2} style={styles.recentAddress}>
                  {lastAddress}
                </Text>
              </View>
              <Text style={styles.chevron}>{">"}</Text>
            </Pressable>
          ) : null}

          <View style={styles.trustRow}>
            <TrustItem label="Private by default" />
            <TrustItem label="No sales call required" />
            <TrustItem label="About 60 seconds" />
          </View>

          <View style={styles.legalRow}>
            <Pressable onPress={() => void Linking.openURL(`${APP_URL}/privacy`)}>
              <Text style={styles.legalLink}>Privacy</Text>
            </Pressable>
            <View style={styles.legalDot} />
            <Pressable onPress={() => void Linking.openURL(`${APP_URL}/terms`)}>
              <Text style={styles.legalLink}>Estimate terms</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function StatusDecoration() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />
      <View style={styles.gridLineOne} />
      <View style={styles.gridLineTwo} />
    </View>
  );
}

function TrustItem({ label }: { label: string }) {
  return (
    <View style={styles.trustItem}>
      <View style={styles.checkDot}>
        <Text style={styles.check}>+</Text>
      </View>
      <Text style={styles.trustText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  brandMark: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: "rgba(34, 211, 238, 0.08)",
  },
  brandSun: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.cyan,
  },
  brandCopy: { flex: 1 },
  brand: { color: colors.text, fontSize: 13, fontWeight: "800", letterSpacing: 2.3 },
  brandTagline: { marginTop: 3, color: colors.muted, fontSize: 8, fontWeight: "700", letterSpacing: 1.35 },
  hero: { paddingTop: 42, paddingBottom: 27 },
  eyebrowPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(15, 23, 42, 0.64)",
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.cyan },
  eyebrow: { color: colors.cyan, fontSize: 9, fontWeight: "800", letterSpacing: 1.8 },
  title: {
    maxWidth: 350,
    marginTop: 20,
    color: colors.text,
    fontFamily: Platform.select({ ios: "Georgia", default: undefined }),
    fontSize: 42,
    fontWeight: "600",
    lineHeight: 47,
    letterSpacing: -1.4,
  },
  subtitle: { maxWidth: 354, marginTop: 16, color: colors.textSoft, fontSize: 15, lineHeight: 23 },
  searchCard: {
    padding: 16,
    borderRadius: radii.large,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(8, 16, 25, 0.94)",
    shadowColor: "#000",
    shadowOpacity: 0.34,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
  },
  inputLabel: { marginBottom: 10, color: colors.cyan, fontSize: 9, fontWeight: "800", letterSpacing: 1.8 },
  inputShell: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.black,
  },
  inputShellError: { borderColor: "rgba(251, 113, 133, 0.55)" },
  pinOuter: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.cyan,
  },
  pinInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.cyan },
  input: { flex: 1, minHeight: 52, color: colors.text, fontSize: 15, paddingVertical: 0 },
  suggestionList: {
    marginTop: 10,
    overflow: "hidden",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelSoft,
  },
  suggestion: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 13, paddingVertical: 10 },
  suggestionDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  suggestionPressed: { opacity: 0.72, backgroundColor: "rgba(103, 232, 249, 0.06)" },
  suggestionMarker: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.cyanStrong },
  suggestionCopy: { flex: 1 },
  suggestionMain: { color: colors.text, fontSize: 14, fontWeight: "700" },
  suggestionSecondary: { marginTop: 4, color: colors.muted, fontSize: 12 },
  chevron: { color: colors.cyan, fontSize: 20, fontWeight: "700" },
  error: { marginTop: 10, color: "#fda4af", fontSize: 12, lineHeight: 18 },
  selectedCard: { marginTop: 12, padding: 13, borderRadius: 16, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: "rgba(8, 51, 68, 0.42)" },
  selectedLabel: { color: colors.cyan, fontSize: 8, fontWeight: "800", letterSpacing: 1.6 },
  selectedAddress: { marginTop: 6, color: colors.text, fontSize: 14, fontWeight: "700", lineHeight: 20 },
  primaryButton: { minHeight: 54, marginTop: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: radii.pill, backgroundColor: colors.white },
  primaryButtonDisabled: { opacity: 0.28 },
  primaryButtonPressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  primaryButtonText: { color: colors.black, fontSize: 15, fontWeight: "800" },
  primaryArrow: { color: colors.black, fontSize: 17, fontWeight: "800" },
  helper: { marginTop: 11, paddingHorizontal: 8, color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: "center" },
  recentCard: { minHeight: 80, marginTop: 14, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 15, paddingVertical: 13, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.border, backgroundColor: "rgba(11, 21, 32, 0.88)" },
  recentIcon: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 17, borderWidth: 1, borderColor: colors.borderStrong },
  recentIconHand: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.cyan, borderTopColor: "transparent" },
  recentCopy: { flex: 1 },
  recentLabel: { color: colors.cyan, fontSize: 8, fontWeight: "800", letterSpacing: 1.4 },
  recentAddress: { marginTop: 5, color: colors.textSoft, fontSize: 13, lineHeight: 18 },
  trustRow: { marginTop: 22, gap: 10 },
  trustItem: { flexDirection: "row", alignItems: "center", gap: 9 },
  checkDot: { width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: "rgba(34, 211, 238, 0.12)" },
  check: { color: colors.cyan, fontSize: 11, fontWeight: "800" },
  trustText: { color: colors.textSoft, fontSize: 12 },
  legalRow: { marginTop: 25, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  legalLink: { color: colors.muted, fontSize: 11, textDecorationLine: "underline" },
  legalDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.muted },
  glowTop: { position: "absolute", top: -120, right: -90, width: 300, height: 300, borderRadius: 150, backgroundColor: "rgba(8, 145, 178, 0.08)" },
  glowBottom: { position: "absolute", bottom: -170, left: -130, width: 360, height: 360, borderRadius: 180, backgroundColor: "rgba(14, 116, 144, 0.05)" },
  gridLineOne: { position: "absolute", top: 0, bottom: 0, left: "33%", width: 1, backgroundColor: "rgba(148, 163, 184, 0.025)" },
  gridLineTwo: { position: "absolute", top: 0, bottom: 0, right: "19%", width: 1, backgroundColor: "rgba(148, 163, 184, 0.025)" },
});
