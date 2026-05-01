#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <HTTPClient.h>
#include <Update.h>
#define MQTT_MAX_PACKET_SIZE 2048
#include <PubSubClient.h>

static const char* DEVICE_TYPE = "water_valve";
static const char FW_VERSION_DEFAULT[] = "v1.0.0";
static const char* MQTT_BROKER = "broker.hivemq.com";
static const uint16_t MQTT_PORT = 1883;
static const char* BASE_REGISTRATION_TOKEN = "campus-reg-token-dev";
static const char* BASE_SERVER_URL = "http://localhost:3004";
static const int VALVE_PIN = 4;

Preferences prefs;
WebServer portal(80);
WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

String wifiSsid;
String wifiPassword;
String mapId;
String deviceId;
String topicPrefix;
String firmwareVersion;
bool configured = false;
bool valveState = false;
bool bootStatusSent = false;
unsigned long lastStatusPublishMs = 0;
uint8_t resetBootCount = 0;
bool resetBootCountArmed = false;
unsigned long resetBootCountArmMs = 0;
bool resetBootCountCleared = false;

static bool shouldEnterProvisioningByTripleReset() {
  const esp_reset_reason_t reason = esp_reset_reason();
  const unsigned long nowMs = millis();
  (void)reason;

  prefs.begin("rst", false);
  resetBootCount = (uint8_t)prefs.getUChar("cnt", 0);
  resetBootCount = (uint8_t)(resetBootCount + 1);
  prefs.putUChar("cnt", resetBootCount);
  prefs.end();
  resetBootCountArmed = true;
  resetBootCountArmMs = nowMs;
  resetBootCountCleared = false;

  if (resetBootCount >= 3) {
    prefs.begin("rst", false);
    prefs.putUChar("cnt", 0);
    prefs.end();
    resetBootCountCleared = true;
    return true;
  }
  return false;
}

void loadFirmwareVersion() {
  prefs.begin("fw", true);
  String v = prefs.getString("ver", "");
  prefs.end();
  firmwareVersion = (v.length() > 0) ? v : String(FW_VERSION_DEFAULT);
}

void saveFirmwareVersionNs(const String& ver) {
  prefs.begin("fw", false);
  prefs.putString("ver", ver);
  prefs.end();
}

static String parseJsonStringField(const String& body, const char* field) {
  String key = String('"') + field + "\":\"";
  int idx = body.indexOf(key);
  if (idx < 0) return "";
  int start = idx + key.length();
  int end = body.indexOf('"', start);
  if (end <= start) return "";
  return body.substring(start, end);
}

String commandTopic() { return topicPrefix + "/command"; }
String statusTopic() { return topicPrefix + "/status"; }
String otaTopic() { return topicPrefix + "/ota/update"; }

void setValve(bool on) {
  valveState = on;
  digitalWrite(VALVE_PIN, on ? HIGH : LOW);
}

bool parseTopicPrefix(const String& prefix, String& outMapId, String& outDeviceId) {
  int first = prefix.indexOf('/');
  int second = prefix.indexOf('/', first + 1);
  int third = prefix.indexOf('/', second + 1);
  if (first < 0 || second < 0 || third < 0) return false;
  if (prefix.substring(0, first) != "campus") return false;
  if (prefix.substring(second + 1, third) != "device") return false;
  outMapId = prefix.substring(first + 1, second);
  int fourth = prefix.indexOf('/', third + 1);
  outDeviceId = fourth < 0
    ? prefix.substring(third + 1)
    : prefix.substring(third + 1, fourth);
  if (outMapId.length() == 0 || outDeviceId.length() == 0) return false;
  return true;
}

void saveConfig(const String& ssid, const String& pass, const String& prefix) {
  prefs.begin("cfg", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  prefs.putString("prefix", prefix);
  prefs.end();
}

void loadConfig() {
  prefs.begin("cfg", true);
  wifiSsid = prefs.getString("ssid", "");
  wifiPassword = prefs.getString("pass", "");
  topicPrefix = prefs.getString("prefix", "");
  prefs.end();
  configured = wifiSsid.length() > 0 && topicPrefix.length() > 0 && parseTopicPrefix(topicPrefix, mapId, deviceId);
}

bool completeRegistration() {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.begin(String(BASE_SERVER_URL) + "/api/iot/register/complete");
  http.addHeader("Content-Type", "application/json");
  String body = "{\"mapId\":\"" + mapId + "\",\"deviceId\":\"" + deviceId + "\",\"registrationToken\":\"" + String(BASE_REGISTRATION_TOKEN) +
    "\",\"boardTarget\":\"esp32\",\"wifiSsid\":\"" + wifiSsid + "\",\"mqttTopicPrefix\":\"" + topicPrefix +
    "\",\"firmwareVersion\":\"" + firmwareVersion + "\"}";
  int code = http.POST(body);
  http.end();
  return code >= 200 && code < 300;
}

bool sendBootStatusLog() {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.begin(String(BASE_SERVER_URL) + "/api/iot/status");
  http.addHeader("Content-Type", "application/json");
  String body = "{\"mapId\":\"" + mapId +
    "\",\"deviceId\":\"" + deviceId +
    "\",\"state\":" + String(valveState ? "true" : "false") +
    ",\"firmwareVersion\":\"" + firmwareVersion +
    "\",\"wifiSsid\":\"" + wifiSsid +
    "\",\"mqttTopicPrefix\":\"" + topicPrefix +
    "\",\"boardTarget\":\"esp32\"}";
  int code = http.POST(body);
  http.end();
  return code >= 200 && code < 300;
}

void startProvisionPortal() {
  WiFi.mode(WIFI_AP);
  WiFi.softAP("CampusValveSetup");
  portal.on("/", HTTP_GET, []() {
    portal.send(
      200,
      "text/html",
      "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'/>"
      "<title>ESP32 Water Valve Setup</title>"
      "<style>"
      "body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;margin:0;background:#0b1220;color:#e5e7eb}"
      ".card{max-width:520px;margin:24px auto;padding:20px;border:1px solid #1f2937;border-radius:14px;background:#0f172a}"
      "h2{margin:0 0 6px;font-size:18px}"
      "p{margin:0 0 14px;color:#9ca3af;font-size:13px;line-height:1.35}"
      "label{display:block;margin:10px 0 6px;font-size:12px;color:#cbd5e1}"
      "input{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #334155;background:#0b1220;color:#e5e7eb}"
      "button{margin-top:14px;width:100%;padding:10px 12px;border-radius:10px;border:1px solid #2563eb;background:#2563eb;color:white;font-weight:600}"
      ".hint{margin-top:12px;font-size:12px;color:#9ca3af}"
      ".mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}"
      "</style></head><body>"
      "<div class='card'>"
      "<h2>ESP32 Water Valve Setup</h2>"
      "<p>Enter WiFi and MQTT topic prefix to provision this device.</p>"
      "<form method='POST' action='/save'>"
      "<label>WiFi SSID</label><input name='ssid' placeholder='WiFi name'/>"
      "<label>WiFi Password</label><input name='pass' type='password' placeholder='WiFi password'/>"
      "<label>MQTT Topic Prefix</label><input class='mono' name='prefix' placeholder='campus/&lt;mapId&gt;/device/&lt;deviceId&gt;'/>"
      "<button type='submit'>Save &amp; reboot</button>"
      "</form>"
      "<div class='hint'>Example prefix: <span class='mono'>campus/123/device/abc</span></div>"
      "</div></body></html>"
    );
  });
  portal.on("/save", HTTP_POST, []() {
    String ssid = portal.arg("ssid");
    String pass = portal.arg("pass");
    String prefix = portal.arg("prefix");
    String parsedMapId = "";
    String parsedDeviceId = "";
    if (ssid.length() == 0 || prefix.length() == 0 || !parseTopicPrefix(prefix, parsedMapId, parsedDeviceId)) {
      portal.send(400, "text/plain", "SSID and valid topicPrefix are required");
      return;
    }
    saveConfig(ssid, pass, prefix);
    portal.send(200, "text/plain", "Saved. Rebooting...");
    delay(500);
    ESP.restart();
  });
  portal.begin();
}

void publishStatus() {
  char payload[192];
  snprintf(payload, sizeof(payload), "{\"type\":\"%s\",\"state\":%s,\"firmwareVersion\":\"%s\"}", DEVICE_TYPE, valveState ? "true" : "false", firmwareVersion.c_str());
  mqttClient.publish(statusTopic().c_str(), payload, false);
}

bool applyOtaFromUrl(const String& url, const String& reportedVersion) {
  HTTPClient http;
  http.begin(url);
  int code = http.GET();
  if (code != 200) { http.end(); return false; }
  int len = http.getSize();
  WiFiClient* stream = http.getStreamPtr();
  if (!Update.begin(len > 0 ? (size_t)len : UPDATE_SIZE_UNKNOWN)) { http.end(); return false; }
  size_t written = Update.writeStream(*stream);
  bool ok = written > 0 && Update.end();
  http.end();
  if (ok && Update.isFinished()) {
    if (reportedVersion.length() > 0) {
      saveFirmwareVersionNs(reportedVersion);
      firmwareVersion = reportedVersion;
    }
    mqttClient.publish((topicPrefix + "/ota/ack").c_str(), "{\"status\":\"success\"}", false);
    delay(300);
    ESP.restart();
  }
  return ok;
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());
  unsigned long started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 20000) delay(500);
}

void connectMqtt() {
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback([](char* topic, byte* payload, unsigned int length) {
    String t = String(topic);
    String body = "";
    for (unsigned int i = 0; i < length; i++) body += (char)payload[i];
    if (t == commandTopic()) {
      if (body.indexOf("\"state\":true") >= 0 || body == "ON") setValve(true);
      else if (body.indexOf("\"state\":false") >= 0 || body == "OFF") setValve(false);
      publishStatus();
      return;
    }
    if (t == otaTopic()) {
      int idx = body.indexOf("\"url\":\"");
      int start = idx + 7;
      if (idx < 0) {
        idx = body.indexOf("\"downloadUrl\":\"");
        start = idx + 15;
      }
      if (idx < 0) return;
      int end = body.indexOf("\"", start);
      if (end <= start) return;
      String url = body.substring(start, end);
      String ver = parseJsonStringField(body, "version");
      mqttClient.publish((topicPrefix + "/ota/ack").c_str(), "{\"status\":\"downloading\"}", false);
      bool otaOk = applyOtaFromUrl(url, ver);
      if (!otaOk) mqttClient.publish((topicPrefix + "/ota/ack").c_str(), "{\"status\":\"failed\"}", false);
    }
  });
  while (!mqttClient.connected()) {
    String clientId = "esp32-valve-" + deviceId;
    if (mqttClient.connect(clientId.c_str())) {
      mqttClient.subscribe(commandTopic().c_str());
      mqttClient.subscribe(otaTopic().c_str());
      publishStatus();
    } else {
      delay(2000);
    }
  }
}

void setup() {
  pinMode(VALVE_PIN, OUTPUT);
  setValve(false);
  loadFirmwareVersion();

  if (shouldEnterProvisioningByTripleReset()) {
    startProvisionPortal();
    return;
  }

  loadConfig();
  if (!configured) {
    startProvisionPortal();
    return;
  }
  connectWifi();
  if (WiFi.status() != WL_CONNECTED) {
    startProvisionPortal();
    return;
  }
  completeRegistration();
  connectMqtt();
  publishStatus();
  bootStatusSent = sendBootStatusLog();
  lastStatusPublishMs = millis();
}

void loop() {
  if (resetBootCountArmed && !resetBootCountCleared && millis() - resetBootCountArmMs >= 3000) {
    resetBootCountArmed = false;
    prefs.begin("rst", false);
    prefs.putUChar("cnt", 0);
    prefs.end();
    resetBootCountCleared = true;
  }

  if (!configured) {
    portal.handleClient();
    return;
  }
  if (WiFi.status() != WL_CONNECTED) connectWifi();
  if (!mqttClient.connected()) connectMqtt();
  mqttClient.loop();
  if (!bootStatusSent && WiFi.status() == WL_CONNECTED) {
    bootStatusSent = sendBootStatusLog();
  }
  if (millis() - lastStatusPublishMs > 30000) {
    publishStatus();
    lastStatusPublishMs = millis();
  }
}
