#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <HTTPClient.h>
#include <Update.h>
#define MQTT_MAX_PACKET_SIZE 2048
#include <PubSubClient.h>
#include <DHT.h>

static const char* DEVICE_TYPE = "temp_humidity";
static const char FW_VERSION_DEFAULT[] = "v1.0.0";
static const char* MQTT_BROKER = "broker.hivemq.com";
static const uint16_t MQTT_PORT = 1883;
static const char* BASE_REGISTRATION_TOKEN = "campus-reg-token-dev";
static const char* BASE_SERVER_URL = "http://localhost:3004";
static const int DHT_PIN = 25;
static const int DHT_TYPE = DHT11;

Preferences prefs;
WebServer portal(80);
WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);
DHT dht(DHT_PIN, DHT_TYPE);

String wifiSsid;
String wifiPassword;
String mapId;
String deviceId;
String topicPrefix;
String firmwareVersion;
bool configured = false;
bool bootStatusSent = false;
unsigned long lastPublishMs = 0;

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

String statusTopic() { return topicPrefix + "/status"; }
String otaTopic() { return topicPrefix + "/ota/update"; }

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
    "\",\"state\":true" +
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
  WiFi.softAP("CampusTempHumiSetup");
  portal.on("/", HTTP_GET, []() {
    portal.send(200, "text/html",
      "<html><body><h3>Temp/Humi Provisioning</h3><form method='POST' action='/save'>"
      "SSID:<input name='ssid'/><br/>Password:<input name='pass'/><br/>Topic Prefix:<input name='prefix'/><br/>"
      "<button type='submit'>Save</button></form></body></html>");
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

void publishSensorStatus(float temperature, float humidity) {
  char payload[192];
  snprintf(payload, sizeof(payload), "{\"type\":\"%s\",\"state\":true,\"temperature\":%.2f,\"humidity\":%.2f,\"firmwareVersion\":\"%s\"}", DEVICE_TYPE, temperature, humidity, firmwareVersion.c_str());
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
    String clientId = "esp32-temphumi-" + deviceId;
    if (mqttClient.connect(clientId.c_str())) {
      mqttClient.subscribe(otaTopic().c_str());
    } else {
      delay(2000);
    }
  }
}

void setup() {
  dht.begin();
  loadFirmwareVersion();
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
  bootStatusSent = sendBootStatusLog();
}

void loop() {
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

  if (millis() - lastPublishMs >= 5000) {
    lastPublishMs = millis();
    float humidity = dht.readHumidity();
    float temperature = dht.readTemperature();
    if (!isnan(humidity) && !isnan(temperature)) {
      publishSensorStatus(temperature, humidity);
    }
  }
}
