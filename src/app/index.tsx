import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { BleManager, Device, Subscription } from "react-native-ble-plx";

// กำหนด UUID ประจำบอร์ดของอาจารย์
const SERVICE_UUID = "aee04821-1973-4e1f-a590-e84b10d580e7";
const CHAR_UUID = "cde07b1a-889b-44b7-a99f-c888dddac729";

// ฟังก์ชันแปลงข้อมูล Base64 ที่ BLE ส่งมา ให้กลับเป็นข้อความปกติ
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

  // ค่าเซ็นเซอร์สดจากบอร์ด
  const [sensorPayload, setSensorPayload] = useState<string>("--");
  const monitorSubscriptionRef = useRef<Subscription | null>(null);

  useEffect(() => {
    bleManagerRef.current = new BleManager();

    return () => {
      stopScan();
      if (monitorSubscriptionRef.current) {
        monitorSubscriptionRef.current.remove();
      }
      bleManagerRef.current?.destroy();
    };
  }, []);

  const startScan = () => {
    if (!bleManagerRef.current) return;
    setIsScanning(true);
    setDevices([]);

    bleManagerRef.current.startDeviceScan(null, null, (error, device) => {
      if (error) {
        console.error("Scan Error:", error);
        setIsScanning(false);
        return;
      }

      if (device) {
        setDevices((prevDevices) => {
          const exists = prevDevices.some((d) => d.id === device.id);
          if (exists) return prevDevices;
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

    // หยุดสแกนอัตโนมัติหลังผ่านไป 12 วินาทีเพื่อประหยัดแบตเตอรี่
    setTimeout(() => {
      stopScan();
    }, 12000);
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
      // 1. สั่งเชื่อมต่อ
      const connected = await scanned.rawDevice.connect();
      // 2. สั่งค้นหา Services และ Characteristics ทั้งหมดบนบอร์ด
      const discovered =
        await connected.discoverAllServicesAndCharacteristics();

      setConnectedDevice(scanned);

      // 3. เริ่มดักฟังค่าจาก CHAR_UUID ของอาจารย์
      monitorSubscriptionRef.current =
        discovered.monitorCharacteristicForService(
          SERVICE_UUID,
          CHAR_UUID,
          (error, characteristic) => {
            if (error) {
              console.error("Telemetry Error:", error);
              return;
            }
            if (characteristic?.value) {
              const rawData = decodeBase64(characteristic.value);
              setSensorPayload(rawData);
            }
          },
        );
    } catch (err: any) {
      console.error("Connection Failed:", err);
      Alert.alert(
        "Connection Error",
        err?.message || "ไม่สามารถเชื่อมต่อกับอุปกรณ์ได้",
      );
    }
  };

  const handleDisconnect = async () => {
    if (monitorSubscriptionRef.current) {
      monitorSubscriptionRef.current.remove();
      monitorSubscriptionRef.current = null;
    }
    if (connectedDevice) {
      try {
        await connectedDevice.rawDevice.cancelConnection();
      } catch (e) {
        console.error(e);
      }
    }
    setConnectedDevice(null);
    setSensorPayload("--");
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0B0E14" />

      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.titleWrapper}>
            <Text style={styles.headerTag}>SYSTEM TELEMETRY</Text>
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

        {/* Dashboard แสดงผลเมื่อเชื่อมต่อสำเร็จ */}
        {connectedDevice && (
          <View style={styles.dashboardCard}>
            <View style={styles.deviceConnectedHeader}>
              <View>
                <Text style={styles.connectedLabel}>อุปกรณ์ที่เชื่อมต่อ</Text>
                <Text style={styles.connectedName}>
                  {connectedDevice.name || "Target Node"}
                </Text>
                <Text style={styles.connectedMac}>{connectedDevice.id}</Text>
              </View>
              <View style={styles.rssiBubble}>
                <Text style={styles.rssiBubbleText}>
                  {connectedDevice.rssi || "--"} dBm
                </Text>
              </View>
            </View>

            <View style={styles.telemetryStreamCard}>
              <Text style={styles.telemetryStreamLabel}>
                LIVE PAYLOAD STREAM
              </Text>
              <Text style={styles.telemetryStreamValue}>{sensorPayload}</Text>
            </View>

            <TouchableOpacity
              style={styles.disconnectBtn}
              onPress={handleDisconnect}
            >
              <Text style={styles.disconnectBtnText}>ยกเลิกการเชื่อมต่อ</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* รายการอุปกรณ์ที่สแกนเจอจริง */}
        {!connectedDevice && (
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
                      แตะปุ่มด้านล่างเพื่อสแกนค้นหาอุปกรณ์
                    </Text>
                  </View>
                ) : null
              }
            />
          </View>
        )}
      </View>

      {/* ปุ่มสแกนแบบ 3D Floating */}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#0B0E14" },
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 16 },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 24,
  },
  titleWrapper: { flex: 1 },
  headerTag: {
    color: "#00D2FF",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 2,
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.5,
  },
  headerAccent: { color: "#00D2FF" },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 8,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  statusDotOn: {
    backgroundColor: "#00E676",
    shadowColor: "#00E676",
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
  statusDotOff: { backgroundColor: "#64748b" },
  statusText: { color: "#E0E0E0", fontSize: 12, fontWeight: "600" },

  dashboardCard: {
    backgroundColor: "#151923",
    borderRadius: 24,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.03)",
  },
  deviceConnectedHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
  },
  connectedLabel: {
    color: "#8A94A6",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 4,
  },
  connectedName: { color: "#FFFFFF", fontSize: 20, fontWeight: "700" },
  connectedMac: {
    color: "#475569",
    fontSize: 11,
    fontFamily: "monospace",
    marginTop: 2,
  },
  rssiBubble: {
    backgroundColor: "rgba(0, 210, 255, 0.1)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  rssiBubbleText: { color: "#00D2FF", fontSize: 12, fontWeight: "700" },

  telemetryStreamCard: {
    backgroundColor: "rgba(0, 210, 255, 0.04)",
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(0, 210, 255, 0.2)",
    marginBottom: 20,
    alignItems: "center",
  },
  telemetryStreamLabel: {
    color: "#00D2FF",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  telemetryStreamValue: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "800",
    fontFamily: "monospace",
  },

  disconnectBtn: {
    backgroundColor: "rgba(255, 69, 58, 0.1)",
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: "center",
  },
  disconnectBtnText: { color: "#FF453A", fontSize: 14, fontWeight: "700" },

  listSection: { flex: 1 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 14,
  },
  listContent: { paddingBottom: 120 },
  deviceCard: {
    backgroundColor: "#151923",
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  deviceInfo: { flex: 1, marginRight: 10 },
  deviceName: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4,
  },
  deviceMac: { color: "#8A94A6", fontSize: 12, fontFamily: "monospace" },
  connectBtn: {
    backgroundColor: "#00D2FF",
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
  },
  connectBtnText: { color: "#0B0E14", fontSize: 13, fontWeight: "700" },

  emptyState: { alignItems: "center", marginTop: 50 },
  emptyStateIcon: { fontSize: 36, marginBottom: 14, opacity: 0.8 },
  emptyStateText: { color: "#8A94A6", fontSize: 14, fontWeight: "500" },

  floatingBtnWrapper: {
    position: "absolute",
    bottom: Platform.OS === "ios" ? 40 : 28,
    left: 24,
    right: 24,
  },
  floatingBtn: {
    backgroundColor: "#00D2FF",
    borderRadius: 100,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#00D2FF",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
  },
  floatingBtnActive: { backgroundColor: "#00ff88" },
  floatingBtnContent: { flexDirection: "row", alignItems: "center", gap: 10 },
  floatingBtnText: {
    color: "#0B0E14",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
});
