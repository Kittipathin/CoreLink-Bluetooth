import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { BleManager, Device } from "react-native-ble-plx";

const SERVICE_UUID = "aee04821-1973-4e1f-a590-e84b10d580e7";
const CHAR_UUID = "cde07b1a-889b-44b7-a99f-c888dddac729";

// ฟังก์ชันแปลง Base64 -> Text
const decodeBase64 = (base64String: string): string => {
  try {
    if (typeof atob === "function") {
      return atob(base64String);
    }
  } catch (e) {
    console.error("Decode error:", e);
  }
  return base64String;
};

// ฟังก์ชันแปลง Text -> Base64
const encodeBase64 = (input: string): string => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  let str = input;
  let output = "";
  for (
    let block = 0, charCode, i = 0, map = chars;
    str.charAt(i | 0) || ((map = "="), i % 1);
    output += map.charAt(63 & (block >> (8 - (i % 1) * 8)))
  ) {
    charCode = str.charCodeAt((i += 3 / 4));
    block = (block << 8) | charCode;
  }
  return output;
};

interface ScannedDevice {
  id: string;
  name: string | null;
  rssi: number | null;
  rawDevice: Device;
}

export default function CoreLinkBluetoothScreen() {
  const bleManagerRef = useRef<BleManager | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [connectedDevice, setConnectedDevice] = useState<ScannedDevice | null>(
    null,
  );
  const [devices, setDevices] = useState<ScannedDevice[]>([]);

  // State สำหรับ Requirements ของอาจารย์
  const [initialValue, setInitialValue] = useState<string>("--");
  const [myName, setMyName] = useState<string>("");
  const [buddyName, setBuddyName] = useState<string>("");
  const [predictedGrade, setPredictedGrade] = useState<string>("--");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    bleManagerRef.current = new BleManager();
    return () => {
      stopScan();
      bleManagerRef.current?.destroy();
    };
  }, []);

  const startScan = () => {
    if (!bleManagerRef.current) return;
    setIsScanning(true);
    setDevices([]);

    bleManagerRef.current.startDeviceScan(null, null, (error, device) => {
      if (error) {
        setIsScanning(false);
        return;
      }
      if (device) {
        setDevices((prevDevices) => {
          if (prevDevices.some((d) => d.id === device.id)) return prevDevices;
          return [
            ...prevDevices,
            {
              id: device.id,
              name: device.name || device.localName || null,
              rssi: device.rssi,
              rawDevice: device,
            },
          ];
        });
      }
    });

    setTimeout(() => {
      stopScan();
    }, 10000);
  };

  const stopScan = () => {
    bleManagerRef.current?.stopDeviceScan();
    setIsScanning(false);
  };

  const toggleScan = () => {
    if (isScanning) {
      stopScan();
    } else {
      startScan();
    }
  };

  const handleConnect = async (scanned: ScannedDevice) => {
    stopScan();
    try {
      const connected = await scanned.rawDevice.connect();
      await connected.discoverAllServicesAndCharacteristics();
      setConnectedDevice(scanned);
      Alert.alert("สำเร็จ", "เชื่อมต่อบอร์ดของอาจารย์เรียบร้อยแล้ว");
    } catch (err: any) {
      Alert.alert("ข้อผิดพลาด", err?.message || "ไม่สามารถเชื่อมต่อได้");
    }
  };

  const handleDisconnect = async () => {
    if (connectedDevice) {
      try {
        await connectedDevice.rawDevice.cancelConnection();
      } catch (e) {
        console.error(e);
      }
    }
    setConnectedDevice(null);
    setInitialValue("--");
    setPredictedGrade("--");
  };

  // Requirement 1: Read the Characteristic value (ค่าเริ่มต้น)
  const handleReadInitial = async () => {
    if (!connectedDevice) return;
    setIsLoading(true);
    try {
      const characteristic =
        await connectedDevice.rawDevice.readCharacteristicForService(
          SERVICE_UUID,
          CHAR_UUID,
        );
      if (characteristic.value) {
        const decoded = decodeBase64(characteristic.value);
        setInitialValue(decoded);
      }
    } catch (err: any) {
      Alert.alert("Read Error", err?.message || "อ่านค่าไม่สำเร็จ");
    } finally {
      setIsLoading(false);
    }
  };

  // Requirement 2: Write a value (your name and your buddy)
  const handleWriteNames = async () => {
    if (!connectedDevice) return;
    if (!myName.trim() || !buddyName.trim()) {
      Alert.alert("แจ้งเตือน", "กรุณากรอกชื่อของคุณและชื่อคู่หูก่อนกดส่ง");
      return;
    }

    setIsLoading(true);
    try {
      const payloadString = `${myName.trim()} & ${buddyName.trim()}`;
      const base64Data = encodeBase64(payloadString);

      await connectedDevice.rawDevice.writeCharacteristicWithResponseForService(
        SERVICE_UUID,
        CHAR_UUID,
        base64Data,
      );

      Alert.alert("สำเร็จ", `ส่งชื่อ "${payloadString}" ลงบอร์ดแล้ว`);
    } catch (err: any) {
      Alert.alert(
        "Write Error",
        err?.message || "ไม่สามารถเขียนข้อมูลลงบอร์ดได้",
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Requirement 3: Read Characteristic value again (ทำนายเกรด)
  const handleReadPredictedGrade = async () => {
    if (!connectedDevice) return;
    setIsLoading(true);
    try {
      const characteristic =
        await connectedDevice.rawDevice.readCharacteristicForService(
          SERVICE_UUID,
          CHAR_UUID,
        );
      if (characteristic.value) {
        const decoded = decodeBase64(characteristic.value);
        setPredictedGrade(decoded);
      }
    } catch (err: any) {
      Alert.alert("Read Error", err?.message || "อ่านค่าทำนายเกรดไม่สำเร็จ");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0B0E14" />

      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.titleWrapper}>
            <Text style={styles.headerTag}>ACADEMIC ASSIGNMENT</Text>
            <Text style={styles.headerTitle}>
              CoreLink <Text style={styles.headerAccent}>Bluetooth</Text>
            </Text>
          </View>
          <View style={styles.statusBadge}>
            <View
              style={[
                styles.statusDot,
                connectedDevice ? styles.statusDotOn : styles.statusDotOff,
              ]}
            />
            <Text style={styles.statusText}>
              {connectedDevice ? "เชื่อมต่อแล้ว" : "พร้อมทำงาน"}
            </Text>
          </View>
        </View>

        {/* Dashboard 3 Steps เมื่อเชื่อมต่อสำเร็จ */}
        {connectedDevice ? (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContainer}
          >
            <View style={styles.deviceConnectedHeader}>
              <View>
                <Text style={styles.connectedLabel}>บอร์ดเป้าหมาย</Text>
                <Text style={styles.connectedName}>
                  {connectedDevice.name || "ESP32 Target Board"}
                </Text>
                <Text style={styles.connectedMac}>{connectedDevice.id}</Text>
              </View>
              <TouchableOpacity
                style={styles.disconnectHeaderBtn}
                onPress={handleDisconnect}
              >
                <Text style={styles.disconnectHeaderBtnText}>
                  ตัดการเชื่อมต่อ
                </Text>
              </TouchableOpacity>
            </View>

            {/* STEP 1: READ INITIAL */}
            <View style={styles.cardStep}>
              <View style={styles.cardStepHeader}>
                <Text style={styles.stepBadge}>STEP 1</Text>
                <Text style={styles.stepTitle}>อ่านค่าเริ่มต้นจากบอร์ด</Text>
              </View>
              <View style={styles.resultDisplay}>
                <Text style={styles.resultLabel}>INITIAL VALUE</Text>
                <Text style={styles.resultValue}>{initialValue}</Text>
              </View>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={handleReadInitial}
              >
                <Text style={styles.actionBtnText}>1. Read Characteristic</Text>
              </TouchableOpacity>
            </View>

            {/* STEP 2: WRITE NAMES */}
            <View style={styles.cardStep}>
              <View style={styles.cardStepHeader}>
                <Text style={styles.stepBadge}>STEP 2</Text>
                <Text style={styles.stepTitle}>
                  เขียนชื่อคุณและคู่หูลงบอร์ด
                </Text>
              </View>
              <TextInput
                style={styles.input}
                placeholder="ชื่อของคุณ (เช่น Kittipathin)"
                placeholderTextColor="#64748b"
                value={myName}
                onChangeText={setMyName}
              />
              <TextInput
                style={styles.input}
                placeholder="ชื่อคู่หู (Buddy Name)"
                placeholderTextColor="#64748b"
                value={buddyName}
                onChangeText={setBuddyName}
              />
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnWrite]}
                onPress={handleWriteNames}
              >
                <Text style={styles.actionBtnTextWrite}>
                  2. Write Value (ส่งชื่อ)
                </Text>
              </TouchableOpacity>
            </View>

            {/* STEP 3: READ GRADE PREDICTION */}
            <View style={[styles.cardStep, styles.cardStepGrade]}>
              <View style={styles.cardStepHeader}>
                <Text style={[styles.stepBadge, styles.stepBadgeGrade]}>
                  STEP 3
                </Text>
                <Text style={styles.stepTitle}>อ่านผลทำนายเกรด</Text>
              </View>
              <View style={styles.resultDisplayGrade}>
                <Text style={styles.resultLabelGrade}>PREDICTED GRADE</Text>
                <Text style={styles.resultValueGrade}>{predictedGrade}</Text>
              </View>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnGrade]}
                onPress={handleReadPredictedGrade}
              >
                <Text style={styles.actionBtnTextGrade}>
                  3. Read Characteristic Again
                </Text>
              </TouchableOpacity>
            </View>

            {isLoading && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color="#00D2FF" />
              </View>
            )}
          </ScrollView>
        ) : (
          /* รายการอุปกรณ์ที่สแกนเจอ */
          <View style={styles.listSection}>
            <Text style={styles.sectionTitle}>
              อุปกรณ์ใกล้เคียง ({devices.length})
            </Text>
            <FlatList
              data={devices}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => (
                <View style={styles.deviceCard}>
                  <View style={styles.deviceInfo}>
                    <Text style={styles.deviceName}>
                      {item.name || "อุปกรณ์ไม่ระบุชื่อ"}
                    </Text>
                    <Text style={styles.deviceMac}>{item.id}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.connectBtn}
                    onPress={() => handleConnect(item)}
                  >
                    <Text style={styles.connectBtnText}>เชื่อมต่อ</Text>
                  </TouchableOpacity>
                </View>
              )}
              ListEmptyComponent={
                !isScanning && devices.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyStateIcon}>📡</Text>
                    <Text style={styles.emptyStateText}>
                      แตะปุ่มด้านล่างเพื่อสแกนค้นหาบอร์ดของอาจารย์
                    </Text>
                  </View>
                ) : null
              }
            />
          </View>
        )}
      </View>

      {/* Floating Scan Button */}
      {!connectedDevice && (
        <View style={styles.floatingBtnWrapper}>
          <TouchableOpacity
            style={[styles.floatingBtn, isScanning && styles.floatingBtnActive]}
            onPress={toggleScan}
            activeOpacity={0.8}
          >
            {isScanning ? (
              <View style={styles.floatingBtnContent}>
                <ActivityIndicator size="small" color="#0B0E14" />
                <Text style={styles.floatingBtnText}>กำลังค้นหาสัญญาณ...</Text>
              </View>
            ) : (
              <Text style={styles.floatingBtnText}>เริ่มสแกน (Scan)</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#0B0E14" },
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
  },
  titleWrapper: { flex: 1 },
  headerTag: {
    color: "#00D2FF",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 2,
    marginBottom: 4,
  },
  headerTitle: { fontSize: 24, fontWeight: "800", color: "#FFFFFF" },
  headerAccent: { color: "#00D2FF" },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 6,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  statusDotOn: { backgroundColor: "#00E676" },
  statusDotOff: { backgroundColor: "#64748b" },
  statusText: { color: "#E0E0E0", fontSize: 11, fontWeight: "600" },

  scrollContainer: { paddingBottom: 40 },
  deviceConnectedHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#151923",
    padding: 16,
    borderRadius: 18,
    marginBottom: 16,
  },
  connectedLabel: { color: "#8A94A6", fontSize: 11, fontWeight: "600" },
  connectedName: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  connectedMac: { color: "#64748b", fontSize: 10, fontFamily: "monospace" },
  disconnectHeaderBtn: {
    backgroundColor: "rgba(255, 69, 58, 0.15)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  disconnectHeaderBtnText: {
    color: "#FF453A",
    fontSize: 12,
    fontWeight: "700",
  },

  // Step Cards
  cardStep: {
    backgroundColor: "#151923",
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.04)",
  },
  cardStepGrade: {
    borderColor: "rgba(0, 230, 118, 0.3)",
    backgroundColor: "#121b1b",
  },
  cardStepHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  stepBadge: {
    backgroundColor: "#00D2FF",
    color: "#0B0E14",
    fontSize: 10,
    fontWeight: "900",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  stepBadgeGrade: { backgroundColor: "#00E676" },
  stepTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },

  resultDisplay: {
    backgroundColor: "rgba(0, 210, 255, 0.05)",
    padding: 14,
    borderRadius: 14,
    alignItems: "center",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(0, 210, 255, 0.15)",
  },
  resultLabel: {
    color: "#00D2FF",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: 4,
  },
  resultValue: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "800",
    fontFamily: "monospace",
  },

  resultDisplayGrade: {
    backgroundColor: "rgba(0, 230, 118, 0.08)",
    padding: 16,
    borderRadius: 14,
    alignItems: "center",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(0, 230, 118, 0.3)",
  },
  resultLabelGrade: {
    color: "#00E676",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: 4,
  },
  resultValueGrade: {
    color: "#00E676",
    fontSize: 32,
    fontWeight: "900",
    fontFamily: "monospace",
  },

  input: {
    backgroundColor: "#0B0E14",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: "#FFFFFF",
    fontSize: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },

  actionBtn: {
    backgroundColor: "rgba(0, 210, 255, 0.15)",
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
  },
  actionBtnText: { color: "#00D2FF", fontSize: 13, fontWeight: "700" },
  actionBtnWrite: { backgroundColor: "#00D2FF" },
  actionBtnTextWrite: { color: "#0B0E14", fontSize: 13, fontWeight: "800" },
  actionBtnGrade: { backgroundColor: "#00E676" },
  actionBtnTextGrade: { color: "#0B0E14", fontSize: 13, fontWeight: "800" },

  loadingOverlay: { marginTop: 10, alignItems: "center" },

  // Scan View
  listSection: { flex: 1 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 14,
  },
  listContent: { paddingBottom: 100 },
  deviceCard: {
    backgroundColor: "#151923",
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  deviceInfo: { flex: 1, marginRight: 10 },
  deviceName: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4,
  },
  deviceMac: { color: "#8A94A6", fontSize: 11, fontFamily: "monospace" },
  connectBtn: {
    backgroundColor: "#00D2FF",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  connectBtnText: { color: "#0B0E14", fontSize: 13, fontWeight: "700" },
  emptyState: { alignItems: "center", marginTop: 50 },
  emptyStateIcon: { fontSize: 36, marginBottom: 14, opacity: 0.8 },
  emptyStateText: { color: "#8A94A6", fontSize: 14, fontWeight: "500" },

  floatingBtnWrapper: {
    position: "absolute",
    bottom: Platform.OS === "ios" ? 40 : 24,
    left: 20,
    right: 20,
  },
  floatingBtn: {
    backgroundColor: "#00D2FF",
    borderRadius: 100,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  floatingBtnActive: { backgroundColor: "#00ff88" },
  floatingBtnContent: { flexDirection: "row", alignItems: "center", gap: 10 },
  floatingBtnText: { color: "#0B0E14", fontSize: 15, fontWeight: "800" },
});
