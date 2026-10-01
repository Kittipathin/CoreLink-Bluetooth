import { Buffer } from "buffer";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  PermissionsAndroid,
  PixelRatio,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  ViewStyle,
} from "react-native";
import { BleManager, Device, State, Subscription } from "react-native-ble-plx";
import { SafeAreaView } from "react-native-safe-area-context";

const SERVICE_UUID = "aee04821-1973-4e1f-a590-e84b10d580e7";
const CHAR_UUID = "cde07b1a-889b-44b7-a99f-c888dddac729";
const SCAN_DURATION_MS = 10000;

// One manager for the app's lifetime; ble-plx is a singleton and destroying it
// on unmount races with Fast Refresh re-creating it
const bleManager = new BleManager();

// UTF-8 safe, so Thai names survive the round trip
const decodeBase64 = (value: string) =>
  Buffer.from(value, "base64").toString("utf8");
const encodeBase64 = (value: string) =>
  Buffer.from(value, "utf8").toString("base64");

const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

const C = {
  ink: "#05060A",
  text: "#F5F3F0",
  textSoft: "rgba(245,243,240,0.62)",
  textFaint: "rgba(245,243,240,0.38)",
  hairline: "rgba(255,255,255,0.12)",
  glass: "rgba(20,22,28,0.88)",
  amber: "#FFC371",
  rose: "#FF8FA3",
  lavender: "#C8A2FF",
  cyan: "#7EF9FF",
  periwinkle: "#7AA7FF",
  violet: "#C084FC",
  success: "#8CF5C2",
  danger: "#FF8A8A",
};

const SUNSET = [C.amber, C.rose, C.lavender] as const;
const AURORA = [C.cyan, C.periwinkle, C.violet] as const;

type Feedback = { type: "success" | "error"; text: string } | null;
type StepKey = "read" | "write" | "grade";

interface ScannedDevice {
  id: string;
  name: string | null;
  rssi: number | null;
  rawDevice: Device;
}

const requestBlePermissions = async (): Promise<boolean> => {
  if (Platform.OS !== "android") return true;
  const permissions =
    Number(Platform.Version) >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(permissions);
  return permissions.every(
    (p) => result[p] === PermissionsAndroid.RESULTS.GRANTED,
  );
};

const signalLevel = (rssi: number | null) => {
  if (rssi == null) return 0;
  if (rssi >= -60) return 4;
  if (rssi >= -70) return 3;
  if (rssi >= -80) return 2;
  return 1;
};

const parseColor = (color: string): number[] => {
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(1);
  }
  const [r, g, b, a = 1] = (color.match(/[\d.]+/g) ?? []).map(Number);
  return [r, g, b, a];
};

const mixStops = (stops: readonly string[], t: number) => {
  const scaled = t * (stops.length - 1);
  const i = Math.min(Math.floor(scaled), stops.length - 2);
  const f = scaled - i;
  const from = parseColor(stops[i]);
  const to = parseColor(stops[i + 1]);
  const [r, g, b, a] = from.map((v, k) => v + (to[k] - v) * f);
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a.toFixed(3)})`;
};

// Pure-View gradient: thin solid slices, so no native ViewManager is needed
function GradientFill({
  colors,
  vertical,
  slices = 36,
  style,
}: {
  colors: readonly string[];
  vertical?: boolean;
  slices?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [length, setLength] = useState(0);
  return (
    <View
      pointerEvents="none"
      style={[styles.gradientFill, style]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setLength(vertical ? height : width);
      }}
    >
      {length > 0 &&
        Array.from({ length: slices }).map((_, i) => {
          // Edges snap to physical pixels and are shared, so no seams or overlaps
          const edge = (n: number) =>
            PixelRatio.roundToNearestPixel((n * length) / slices);
          const start = edge(i);
          const size = edge(i + 1) - start;
          return (
            <View
              key={i}
              style={[
                styles.gradientSlice,
                vertical
                  ? { top: start, height: size, left: 0, right: 0 }
                  : { left: start, width: size, top: 0, bottom: 0 },
                { backgroundColor: mixStops(colors, i / (slices - 1)) },
              ]}
            />
          );
        })}
    </View>
  );
}

const TRACES = [
  { top: 0.9, left: 0.58, width: 0.3, drop: 0.05, color: C.amber },
  { top: 0.56, left: 0.1, width: 0.42, drop: 0.12, color: C.cyan },
  { top: 0.68, left: 0.48, width: 0.36, drop: 0.08, color: C.lavender },
  { top: 0.8, left: 0.16, width: 0.24, drop: 0.07, color: C.rose },
];

// Stacked translucent discs fake a soft radial falloff without extra deps
function RadialGlow({
  size,
  color,
  style,
}: {
  size: number;
  color: string;
  style: StyleProp<ViewStyle>;
}) {
  const rings = 40;
  return (
    <View style={[styles.glowAnchor, { width: size, height: size }, style]}>
      {Array.from({ length: rings }).map((_, i) => {
        const d = size * (1 - i / rings);
        return (
          <View
            key={i}
            style={{
              position: "absolute",
              width: d,
              height: d,
              borderRadius: d / 2,
              backgroundColor: color,
              opacity: 0.018,
            }}
          />
        );
      })}
    </View>
  );
}

function EditorialBackdrop() {
  const { width, height } = useWindowDimensions();
  const cell = 44;
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <GradientFill
        colors={["#0B0D16", "#07080D", C.ink]}
        vertical
        slices={24}
        style={StyleSheet.absoluteFill}
      />
      <RadialGlow
        size={width * 1.4}
        color={C.rose}
        style={{ top: -width * 0.75, right: -width * 0.6 }}
      />
      <RadialGlow
        size={width * 1.3}
        color={C.cyan}
        style={{ top: height * 0.22, left: -width * 0.8 }}
      />
      <RadialGlow
        size={width * 1.1}
        color={C.amber}
        style={{ bottom: -width * 0.55, right: -width * 0.45 }}
      />
      {Array.from({ length: cols }).map((_, i) => (
        <View key={`v${i}`} style={[styles.gridV, { left: i * cell }]} />
      ))}
      {Array.from({ length: rows }).map((_, i) => (
        <View key={`h${i}`} style={[styles.gridH, { top: i * cell }]} />
      ))}
      {TRACES.map((t, i) => {
        const top = t.top * height;
        const left = t.left * width;
        const w = t.width * width;
        const drop = t.drop * height;
        return (
          <View key={`t${i}`}>
            <View
              style={[
                styles.traceH,
                { top, left, width: w, backgroundColor: t.color },
              ]}
            />
            <View
              style={[
                styles.traceV,
                { top, left: left + w, height: drop, backgroundColor: t.color },
              ]}
            />
            <View
              style={[
                styles.traceNode,
                { top: top - 3, left: left - 3, borderColor: t.color },
              ]}
            />
            <View
              style={[
                styles.traceNode,
                styles.traceNodeFilled,
                {
                  top: top + drop - 3,
                  left: left + w - 3,
                  backgroundColor: t.color,
                },
              ]}
            />
          </View>
        );
      })}
      <GradientFill
        colors={["rgba(5,6,10,0)", "rgba(5,6,10,0.5)", "rgba(5,6,10,0.85)", C.ink]}
        vertical
        slices={40}
        style={[styles.vignette, { height: height * 0.6 }]}
      />
    </View>
  );
}

function Glass({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.glassShell, style]}>
      <View style={styles.glassSheen} pointerEvents="none" />
      <View style={styles.glassContent}>{children}</View>
    </View>
  );
}

function GradientPill({
  label,
  onPress,
  loading,
  disabled,
  palette = SUNSET,
  compact,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  palette?: readonly [string, string, ...string[]];
  compact?: boolean;
}) {
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.pillWrap,
        pressed && styles.pressed,
        inactive && styles.dimmed,
      ]}
    >
      <GradientFill colors={palette} style={styles.pillHalo} />
      <View style={[styles.pill, compact && styles.pillCompact]}>
        <GradientFill colors={palette} style={StyleSheet.absoluteFill} />
        {loading ? (
          <ActivityIndicator size="small" color={C.ink} />
        ) : (
          <Text style={styles.pillText}>{label}</Text>
        )}
      </View>
    </Pressable>
  );
}

function GhostPill({
  label,
  onPress,
  loading,
  disabled,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.ghostPill,
        pressed && styles.pressed,
        inactive && styles.dimmed,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={C.text} />
      ) : (
        <Text style={styles.ghostPillText}>{label}</Text>
      )}
    </Pressable>
  );
}

function SignalMeter({ rssi }: { rssi: number | null }) {
  const level = signalLevel(rssi);
  return (
    <View style={styles.signal}>
      <View style={styles.signalBars}>
        {[1, 2, 3, 4].map((i) => (
          <View
            key={i}
            style={[
              styles.signalBar,
              { height: 3 + i * 3 },
              i <= level && styles.signalBarOn,
            ]}
          />
        ))}
      </View>
      <Text style={styles.signalText}>{rssi ?? "--"}</Text>
    </View>
  );
}

function FeedbackLine({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  const color = feedback.type === "success" ? C.success : C.danger;
  return (
    <View style={styles.feedback}>
      <View style={[styles.feedbackDot, { backgroundColor: color }]} />
      <Text style={[styles.feedbackText, { color }]}>{feedback.text}</Text>
    </View>
  );
}

function StepTag({
  index,
  label,
  done,
}: {
  index: number;
  label: string;
  done: boolean;
}) {
  return (
    <View style={styles.stepTagRow}>
      <Text style={styles.stepTagIndex}>{String(index).padStart(2, "0")}</Text>
      <View style={styles.stepTagRule} />
      <Text style={styles.stepTagLabel}>{label}</Text>
      {done && <Text style={styles.stepTagDone}>DONE</Text>}
    </View>
  );
}

function Notice({ tone, text }: { tone: "danger" | "warning"; text: string }) {
  return (
    <View
      style={[
        styles.notice,
        {
          borderColor:
            tone === "danger"
              ? "rgba(255,138,138,0.4)"
              : "rgba(255,195,113,0.4)",
        },
      ]}
    >
      <View
        style={[
          styles.feedbackDot,
          { backgroundColor: tone === "danger" ? C.danger : C.amber },
        ]}
      />
      <Text style={styles.noticeText}>{text}</Text>
    </View>
  );
}

export default function CoreLinkBluetoothScreen() {
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disconnectSubRef = useRef<Subscription | null>(null);

  const [bluetoothState, setBluetoothState] = useState<State>(State.Unknown);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [showUnnamed, setShowUnnamed] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectedDevice, setConnectedDevice] = useState<ScannedDevice | null>(
    null,
  );
  const [lostConnection, setLostConnection] = useState(false);

  const [initialValue, setInitialValue] = useState<string | null>(null);
  const [myName, setMyName] = useState("");
  const [buddyName, setBuddyName] = useState("");
  const [namesWritten, setNamesWritten] = useState(false);
  const [predictedGrade, setPredictedGrade] = useState<string | null>(null);
  const [busyStep, setBusyStep] = useState<StepKey | null>(null);
  const [feedback, setFeedback] = useState<Record<StepKey, Feedback>>({
    read: null,
    write: null,
    grade: null,
  });

  useEffect(() => {
    let active = true;
    const stateSub = bleManager.onStateChange(setBluetoothState);
    // ble-plx's emitCurrentState=true leaves this promise uncaught, so read it here
    bleManager
      .state()
      .then((s) => active && setBluetoothState(s))
      .catch(() => active && setBluetoothState(State.Unsupported));
    return () => {
      active = false;
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
      stateSub.remove();
      disconnectSubRef.current?.remove();
      bleManager.stopDeviceScan().catch(() => {});
    };
  }, []);

  const bluetoothOff =
    bluetoothState === State.PoweredOff ||
    bluetoothState === State.Unauthorized ||
    bluetoothState === State.Unsupported;

  const visibleDevices = useMemo(
    () =>
      devices
        .filter((d) => showUnnamed || d.name)
        .sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999)),
    [devices, showUnnamed],
  );
  const hiddenCount = devices.filter((d) => !d.name).length;

  const stopScan = () => {
    if (scanTimerRef.current) {
      clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    bleManager.stopDeviceScan().catch(() => {});
    setIsScanning(false);
  };

  const startScan = async () => {
    setScanError(null);
    setLostConnection(false);

    const granted = await requestBlePermissions();
    if (!granted) {
      setScanError("ต้องอนุญาตสิทธิ์ Bluetooth และตำแหน่งที่ตั้งก่อนสแกน");
      return;
    }

    setDevices([]);
    setIsScanning(true);
    bleManager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        setScanError(error.message || "สแกนไม่สำเร็จ กรุณาลองใหม่");
        stopScan();
        return;
      }
      if (!device) return;
      setDevices((prev) => {
        const entry: ScannedDevice = {
          id: device.id,
          name: device.name || device.localName || null,
          rssi: device.rssi,
          rawDevice: device,
        };
        const index = prev.findIndex((d) => d.id === device.id);
        if (index === -1) return [...prev, entry];
        const next = [...prev];
        next[index] = { ...entry, name: entry.name ?? prev[index].name };
        return next;
      });
    });

    scanTimerRef.current = setTimeout(stopScan, SCAN_DURATION_MS);
  };

  const resetSession = () => {
    disconnectSubRef.current?.remove();
    disconnectSubRef.current = null;
    setConnectedDevice(null);
    setInitialValue(null);
    setNamesWritten(false);
    setPredictedGrade(null);
    setFeedback({ read: null, write: null, grade: null });
  };

  const handleConnect = async (scanned: ScannedDevice) => {
    stopScan();
    setConnectingId(scanned.id);
    setScanError(null);
    try {
      const connected = await scanned.rawDevice.connect();
      await connected.discoverAllServicesAndCharacteristics();
      disconnectSubRef.current = connected.onDisconnected(() => {
        resetSession();
        setLostConnection(true);
      });
      setConnectedDevice(scanned);
    } catch (err: any) {
      setScanError(
        `เชื่อมต่อ "${scanned.name || "อุปกรณ์"}" ไม่สำเร็จ: ${err?.message || "ไม่ทราบสาเหตุ"}`,
      );
    } finally {
      setConnectingId(null);
    }
  };

  const handleDisconnect = async () => {
    const device = connectedDevice;
    resetSession();
    try {
      await device?.rawDevice.cancelConnection();
    } catch (e) {
      console.error(e);
    }
  };

  const setStepFeedback = (step: StepKey, value: Feedback) =>
    setFeedback((prev) => ({ ...prev, [step]: value }));

  const readCharacteristic = async () => {
    const characteristic =
      await connectedDevice!.rawDevice.readCharacteristicForService(
        SERVICE_UUID,
        CHAR_UUID,
      );
    return characteristic.value ? decodeBase64(characteristic.value) : "";
  };

  // Requirement 1: Read the Characteristic value
  const handleReadInitial = async () => {
    if (!connectedDevice) return;
    setBusyStep("read");
    setStepFeedback("read", null);
    try {
      const value = await readCharacteristic();
      setInitialValue(value || "(empty)");
      setStepFeedback("read", { type: "success", text: "อ่านค่าสำเร็จ" });
    } catch (err: any) {
      setStepFeedback("read", {
        type: "error",
        text: err?.message || "อ่านค่าไม่สำเร็จ",
      });
    } finally {
      setBusyStep(null);
    }
  };

  // Requirement 2: Write a value (your name and your buddy)
  const payload = `${myName.trim()} & ${buddyName.trim()}`;
  const canWrite = myName.trim().length > 0 && buddyName.trim().length > 0;

  const handleWriteNames = async () => {
    if (!connectedDevice || !canWrite) return;
    setBusyStep("write");
    setStepFeedback("write", null);
    try {
      await connectedDevice.rawDevice.writeCharacteristicWithResponseForService(
        SERVICE_UUID,
        CHAR_UUID,
        encodeBase64(payload),
      );
      setNamesWritten(true);
      setStepFeedback("write", {
        type: "success",
        text: `ส่ง "${payload}" ไปยังอุปกรณ์แล้ว`,
      });
    } catch (err: any) {
      setStepFeedback("write", {
        type: "error",
        text: err?.message || "เขียนข้อมูลลงอุปกรณ์ไม่สำเร็จ",
      });
    } finally {
      setBusyStep(null);
    }
  };

  // Requirement 3: Read Characteristic value again (grade prediction)
  const handleReadPredictedGrade = async () => {
    if (!connectedDevice) return;
    setBusyStep("grade");
    setStepFeedback("grade", null);
    try {
      const value = await readCharacteristic();
      setPredictedGrade(value || "(empty)");
      setStepFeedback("grade", { type: "success", text: "ได้รับผลทำนายแล้ว" });
    } catch (err: any) {
      setStepFeedback("grade", {
        type: "error",
        text: err?.message || "อ่านผลทำนายไม่สำเร็จ",
      });
    } finally {
      setBusyStep(null);
    }
  };

  const completed = [
    initialValue != null,
    namesWritten,
    predictedGrade != null,
  ];
  const completedCount = completed.filter(Boolean).length;

  const statusLabel = connectedDevice
    ? "LINKED"
    : bluetoothOff
      ? "BT OFF"
      : isScanning
        ? "SCANNING"
        : "IDLE";
  const statusColor = connectedDevice
    ? C.success
    : bluetoothOff
      ? C.danger
      : isScanning
        ? C.cyan
        : C.textFaint;

  const renderTopBar = () => (
    <View style={styles.topBar}>
      <Text style={styles.brand}>CORELINK</Text>
      <View style={styles.statusChip}>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <Text style={styles.statusText}>{statusLabel}</Text>
      </View>
    </View>
  );

  const renderScanView = () => (
    <View style={styles.flex}>
      <Glass style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <View>
            <Text style={styles.eyebrow}>NEARBY DEVICES</Text>
            <Text style={styles.sheetCount}>
              {String(visibleDevices.length).padStart(2, "0")}
              <Text style={styles.sheetCountMuted}> found</Text>
            </Text>
          </View>
          <View style={styles.segment}>
            {(["NAMED", "ALL"] as const).map((option) => {
              const active = option === "ALL" ? showUnnamed : !showUnnamed;
              return (
                <Pressable
                  key={option}
                  onPress={() => setShowUnnamed(option === "ALL")}
                  style={[
                    styles.segmentItem,
                    active && styles.segmentItemActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      active && styles.segmentTextActive,
                    ]}
                  >
                    {option}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {bluetoothOff && (
          <Notice
            tone="danger"
            text="Bluetooth ปิดอยู่ — เปิดในการตั้งค่าเครื่องแล้วลองอีกครั้ง"
          />
        )}
        {lostConnection && (
          <Notice
            tone="warning"
            text="อุปกรณ์หลุดการเชื่อมต่อ — สแกนและเชื่อมต่อใหม่"
          />
        )}
        {scanError && <Notice tone="danger" text={scanError} />}

        <FlatList
          data={visibleDevices}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => {
            const isConnecting = connectingId === item.id;
            return (
              <View style={styles.deviceRow}>
                <SignalMeter rssi={item.rssi} />
                <View style={styles.deviceInfo}>
                  <Text style={styles.deviceName} numberOfLines={1}>
                    {item.name || "Unnamed device"}
                  </Text>
                  <Text style={styles.deviceId} numberOfLines={1}>
                    {item.id}
                  </Text>
                </View>
                <Pressable
                  onPress={() => handleConnect(item)}
                  disabled={connectingId != null}
                  style={({ pressed }) => [
                    styles.connectChip,
                    pressed && styles.pressed,
                    connectingId != null && !isConnecting && styles.dimmed,
                  ]}
                >
                  {isConnecting ? (
                    <ActivityIndicator size="small" color={C.text} />
                  ) : (
                    <Text style={styles.connectChipText}>CONNECT</Text>
                  )}
                </Pressable>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>
                {isScanning ? "Listening for signals…" : "No devices yet"}
              </Text>
              <Text style={styles.emptyBody}>
                {isScanning
                  ? "วางโทรศัพท์ไว้ใกล้อุปกรณ์เป้าหมาย"
                  : hiddenCount > 0
                    ? `มีอุปกรณ์ไม่มีชื่อ ${hiddenCount} รายการ — เลือก ALL เพื่อดู`
                    : "แตะปุ่ม Scan ด้านล่างเพื่อเริ่มค้นหา"}
              </Text>
            </View>
          }
        />
      </Glass>

      <View style={styles.floatingCta}>
        {isScanning ? (
          <GhostPill label="Stop Scanning" onPress={stopScan} />
        ) : (
          <GradientPill
            label="Scan for Devices"
            onPress={startScan}
            disabled={bluetoothOff || connectingId != null}
          />
        )}
      </View>
    </View>
  );

  const renderConnectedView = () => (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.connectedHero}>
          <Text style={styles.eyebrow}>CONNECTED TO</Text>
          <Text style={styles.connectedName} numberOfLines={2}>
            {connectedDevice?.name || "BLE Device"}
          </Text>
          <Text style={styles.connectedId}>{connectedDevice?.id}</Text>
          <View style={styles.connectedMeta}>
            <View style={styles.progressBlock}>
              <Text style={styles.progressValue}>
                {String(completedCount).padStart(2, "0")}
                <Text style={styles.progressTotal}> / 03</Text>
              </Text>
              <View style={styles.progressTrack}>
                <GradientFill
                  colors={SUNSET}
                  style={[
                    styles.progressFill,
                    { width: `${(completedCount / 3) * 100}%` },
                  ]}
                />
              </View>
            </View>
            <Pressable
              onPress={handleDisconnect}
              style={({ pressed }) => [
                styles.disconnectChip,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.disconnectText}>DISCONNECT</Text>
            </Pressable>
          </View>
        </View>

        <Glass style={styles.card}>
          <StepTag index={1} label="READ INITIAL" done={completed[0]} />
          <Text style={styles.cardTitle}>ค่าเริ่มต้นจากอุปกรณ์</Text>
          <View style={styles.readout}>
            <Text style={styles.readoutLabel}>CHARACTERISTIC VALUE</Text>
            <Text
              style={[
                styles.readoutValue,
                initialValue == null && styles.readoutPlaceholder,
              ]}
              selectable
            >
              {initialValue ?? "— not read yet —"}
            </Text>
          </View>
          <GhostPill
            label={completed[0] ? "Read Again" : "Read Characteristic"}
            onPress={handleReadInitial}
            loading={busyStep === "read"}
            disabled={busyStep != null}
          />
          <FeedbackLine feedback={feedback.read} />
        </Glass>

        <Glass style={styles.card}>
          <StepTag index={2} label="WRITE NAMES" done={completed[1]} />
          <Text style={styles.cardTitle}>ส่งชื่อคุณและคู่หู</Text>
          <Text style={styles.inputLabel}>MY NAME</Text>
          <TextInput
            style={styles.input}
            placeholder="Your name"
            placeholderTextColor={C.textFaint}
            value={myName}
            onChangeText={setMyName}
            returnKeyType="next"
            selectionColor={C.rose}
          />
          <Text style={styles.inputLabel}>BUDDY NAME</Text>
          <TextInput
            style={styles.input}
            placeholder="Your buddy's name"
            placeholderTextColor={C.textFaint}
            value={buddyName}
            onChangeText={setBuddyName}
            returnKeyType="send"
            onSubmitEditing={handleWriteNames}
            selectionColor={C.rose}
          />
          <View style={styles.payloadRow}>
            <Text style={styles.payloadLabel}>PAYLOAD</Text>
            <Text style={styles.payloadValue} numberOfLines={1}>
              {canWrite ? payload : "—"}
            </Text>
          </View>
          <GradientPill
            label="Write to Device"
            onPress={handleWriteNames}
            loading={busyStep === "write"}
            disabled={!canWrite || busyStep != null}
          />
          {!canWrite && (
            <Text style={styles.hint}>กรอกชื่อให้ครบทั้งสองช่องเพื่อส่ง</Text>
          )}
          <FeedbackLine feedback={feedback.write} />
        </Glass>

        <Glass style={[styles.card, styles.showcase]}>
          <StepTag index={3} label="PREDICT GRADE" done={completed[2]} />
          <Text style={styles.cardTitle}>ผลทำนายเกรดของคุณ</Text>
          <View style={styles.gradeStage}>
            <Text
              style={[
                styles.gradeValue,
                predictedGrade == null && styles.gradePlaceholder,
              ]}
              numberOfLines={2}
              adjustsFontSizeToFit
            >
              {predictedGrade ?? "?"}
            </Text>
            <GradientFill colors={AURORA} style={styles.gradeRule} />
            <Text style={styles.gradeCaption}>
              {predictedGrade != null
                ? "PREDICTED BY THE DEVICE"
                : namesWritten
                  ? "READY — TAP READ AGAIN"
                  : "COMPLETE STEP 02 FIRST"}
            </Text>
          </View>
          <GradientPill
            label="Read Again"
            palette={AURORA}
            onPress={handleReadPredictedGrade}
            loading={busyStep === "grade"}
            disabled={busyStep != null}
          />
          <FeedbackLine feedback={feedback.grade} />
        </Glass>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  return (
    <View style={styles.root}>
      <StatusBar
        barStyle="light-content"
        translucent
        backgroundColor="transparent"
      />
      <EditorialBackdrop />
      <SafeAreaView style={styles.flex} edges={["top", "bottom"]}>
        {renderTopBar()}
        {connectedDevice ? renderConnectedView() : renderScanView()}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.ink },
  flex: { flex: 1 },

  gradientFill: { overflow: "hidden" },
  gradientSlice: { position: "absolute" },
  glowAnchor: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  gridV: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.035)",
  },
  gridH: {
    position: "absolute",
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.035)",
  },
  traceH: { position: "absolute", height: 1, opacity: 0.35 },
  traceV: { position: "absolute", width: 1, opacity: 0.35 },
  traceNode: {
    position: "absolute",
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1,
    opacity: 0.7,
  },
  traceNodeFilled: { borderWidth: 0 },
  vignette: { position: "absolute", left: 0, right: 0, bottom: 0 },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 4,
  },
  brand: {
    color: C.text,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "900",
    letterSpacing: 5,
    includeFontPadding: false,
  },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.hairline,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: {
    color: C.text,
    fontSize: 10,
    fontFamily: MONO,
    letterSpacing: 1.5,
  },

  eyebrow: {
    color: C.textSoft,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 3,
  },

  glassShell: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.hairline,
    borderRadius: 24,
    backgroundColor: C.glass,
  },
  glassSheen: {
    position: "absolute",
    top: 0,
    left: 24,
    right: 24,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  glassContent: { flex: 1 },

  sheet: {
    flex: 1,
    marginHorizontal: 12,
    marginTop: 20,
    marginBottom: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
    marginBottom: 18,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  sheetCount: {
    color: C.text,
    fontSize: 28,
    fontWeight: "800",
    fontFamily: MONO,
    marginTop: 6,
  },
  sheetCountMuted: {
    color: C.textFaint,
    fontSize: 14,
    fontWeight: "500",
  },
  segment: {
    flexDirection: "row",
    padding: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.hairline,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  segmentItem: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  segmentItemActive: { backgroundColor: "rgba(255,255,255,0.14)" },
  segmentText: {
    color: C.textFaint,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  segmentTextActive: { color: C.text },

  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  noticeText: { flex: 1, color: C.text, fontSize: 12, lineHeight: 18 },

  listContent: { paddingBottom: 110, flexGrow: 1 },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.hairline,
  },
  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
  },
  deviceInfo: { flex: 1 },
  deviceName: { color: C.text, fontSize: 15, fontWeight: "600" },
  deviceId: {
    color: C.textFaint,
    fontSize: 10,
    fontFamily: MONO,
    letterSpacing: 0.5,
    marginTop: 3,
  },
  signal: { alignItems: "center", width: 34, gap: 4 },
  signalBars: { flexDirection: "row", alignItems: "flex-end", gap: 2 },
  signalBar: {
    width: 3,
    borderRadius: 1,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  signalBarOn: { backgroundColor: C.cyan },
  signalText: { color: C.textFaint, fontSize: 9, fontFamily: MONO },
  connectChip: {
    minWidth: 84,
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  connectChipText: {
    color: C.text,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.5,
  },

  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    color: C.text,
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  emptyBody: {
    color: C.textSoft,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },

  floatingCta: { position: "absolute", left: 28, right: 28, bottom: 32 },

  pillWrap: { justifyContent: "center" },
  pillHalo: {
    position: "absolute",
    top: -5,
    left: -5,
    right: -5,
    bottom: -5,
    borderRadius: 999,
    opacity: 0.22,
  },
  pill: {
    minHeight: 58,
    borderRadius: 999,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  pillCompact: { minHeight: 46 },
  pillText: {
    color: C.ink,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  ghostPill: {
    minHeight: 52,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  ghostPillText: {
    color: C.text,
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  dimmed: { opacity: 0.4 },

  scrollContent: { paddingHorizontal: 12, paddingBottom: 40 },
  connectedHero: { paddingHorizontal: 12, paddingTop: 24, paddingBottom: 24 },
  connectedName: {
    color: C.text,
    fontSize: 40,
    lineHeight: 44,
    fontWeight: "800",
    letterSpacing: -1.5,
    marginTop: 10,
  },
  connectedId: {
    color: C.textFaint,
    fontSize: 11,
    fontFamily: MONO,
    letterSpacing: 0.5,
    marginTop: 6,
  },
  connectedMeta: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 16,
    marginTop: 22,
  },
  progressBlock: { flex: 1 },
  progressValue: {
    color: C.text,
    fontSize: 22,
    fontWeight: "800",
    fontFamily: MONO,
  },
  progressTotal: { color: C.textFaint, fontSize: 14 },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.12)",
    marginTop: 8,
    overflow: "hidden",
  },
  progressFill: { height: 3, borderRadius: 2 },
  disconnectChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,138,138,0.4)",
    backgroundColor: "rgba(255,138,138,0.08)",
  },
  disconnectText: {
    color: C.danger,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.5,
  },

  card: { padding: 22, marginBottom: 14 },
  showcase: { borderColor: "rgba(126,249,255,0.24)" },
  stepTagRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepTagIndex: {
    color: C.text,
    fontSize: 11,
    fontWeight: "700",
    fontFamily: MONO,
  },
  stepTagRule: { width: 18, height: 1, backgroundColor: C.hairline },
  stepTagLabel: {
    flex: 1,
    color: C.textSoft,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 3,
  },
  stepTagDone: {
    color: C.success,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 2,
    fontFamily: MONO,
  },
  cardTitle: {
    color: C.text,
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.5,
    marginTop: 12,
    marginBottom: 18,
  },

  readout: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.hairline,
    backgroundColor: "rgba(0,0,0,0.3)",
    paddingVertical: 18,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  readoutLabel: {
    color: C.textFaint,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 2.5,
    marginBottom: 8,
  },
  readoutValue: {
    color: C.text,
    fontSize: 20,
    fontFamily: MONO,
    fontWeight: "600",
  },
  readoutPlaceholder: { color: C.textFaint, fontSize: 14, fontWeight: "400" },

  inputLabel: {
    color: C.textFaint,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 2.5,
    marginBottom: 8,
  },
  input: {
    color: C.text,
    fontSize: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(0,0,0,0.3)",
    marginBottom: 16,
  },
  payloadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    marginBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: C.hairline,
  },
  payloadLabel: {
    color: C.textFaint,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 2.5,
  },
  payloadValue: {
    flex: 1,
    color: C.amber,
    fontSize: 13,
    fontFamily: MONO,
    textAlign: "right",
  },
  hint: {
    color: C.textFaint,
    fontSize: 12,
    textAlign: "center",
    marginTop: 12,
  },

  gradeStage: { alignItems: "center", paddingTop: 4, paddingBottom: 24 },
  gradeValue: {
    color: C.text,
    fontSize: 120,
    lineHeight: 128,
    fontWeight: "900",
    letterSpacing: -6,
    textAlign: "center",
  },
  gradePlaceholder: { color: "rgba(255,255,255,0.14)" },
  gradeRule: { width: 72, height: 3, borderRadius: 2, marginTop: 4 },
  gradeCaption: {
    color: C.textSoft,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 3,
    fontFamily: MONO,
    marginTop: 14,
  },

  feedback: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
  },
  feedbackDot: { width: 6, height: 6, borderRadius: 3 },
  feedbackText: { flex: 1, fontSize: 12, fontWeight: "600" },
});
