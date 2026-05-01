#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266httpUpdate.h>
#include <WiFiClientSecureBearSSL.h>
#include <EEPROM.h>
#define MQTT_MAX_PACKET_SIZE 1200
#include <PubSubClient.h>
#include <DHT.h>

static const char* DEVICE_TYPE = "temp_humidity";
static const char FW_VERSION_DEFAULT[] = "v1.0.0";
static const char* MQTT_BROKER = "broker.hivemq.com";
static const uint16_t MQTT_PORT = 1883;
static const char* BASE_SERVER_URL = "http://localhost:3004";
static const char* BASE_REGISTRATION_TOKEN = "campus-reg-token-dev";
static const int DHT_PIN = 2;
static const int DHT_TYPE = DHT11;

ESP8266WebServer portal(80);
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
uint8_t resetBootCount = 0;
bool resetBootCountArmed = false;
unsigned long resetBootCountArmMs = 0;
bool resetBootCountCleared = false;

static uint8_t readResetBootCount() {
  EEPROM.begin(1024);
  uint8_t v = (uint8_t)EEPROM.read(1023);
  EEPROM.end();
  return v;
}

static void writeResetBootCount(uint8_t v) {
  EEPROM.begin(1024);
  EEPROM.write(1023, v);
  EEPROM.commit();
  EEPROM.end();
}

static bool shouldEnterProvisioningByTripleReset() {
  const unsigned long nowMs = millis();
  resetBootCount = (uint8_t)(readResetBootCount() + 1);
  writeResetBootCount(resetBootCount);
  resetBootCountArmed = true;
  resetBootCountArmMs = nowMs;
  resetBootCountCleared = false;

  if (resetBootCount >= 3) {
    writeResetBootCount(0);
    resetBootCountCleared = true;
    return true;
  }
  return false;
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

void saveCfg(const String& ssid, const String& pass, const String& prefix) {
  EEPROM.begin(1024);
  String blob = ssid + "\n" + pass + "\n" + prefix + "\n" + firmwareVersion + "\n";
  for (int i = 0; i < 1023; i++) EEPROM.write(i, i < blob.length() ? blob[i] : 0);
  EEPROM.commit();
  EEPROM.end();
}

void loadCfg() {
  firmwareVersion = String(FW_VERSION_DEFAULT);
  EEPROM.begin(1024);
  String blob = "";
  for (int i = 0; i < 1023; i++) {
    char c = (char)EEPROM.read(i);
    if (c == 0) break;
    blob += c;
  }
  EEPROM.end();
  int p1 = blob.indexOf('\n');
  int p2 = blob.indexOf('\n', p1 + 1);
  int p3 = blob.indexOf('\n', p2 + 1);
  if (p1 < 0 || p2 < 0 || p3 < 0) return;
  wifiSsid = blob.substring(0, p1);
  wifiPassword = blob.substring(p1 + 1, p2);
  topicPrefix = blob.substring(p2 + 1, p3);
  int p4 = blob.indexOf('\n', p3 + 1);
  if (p4 >= 0) {
    int p5 = blob.indexOf('\n', p4 + 1);
    String fv = (p5 < 0) ? blob.substring(p4 + 1) : blob.substring(p4 + 1, p5);
    if (fv.length() > 0) firmwareVersion = fv;
  }
  configured = wifiSsid.length() > 0 && topicPrefix.length() > 0 && parseTopicPrefix(topicPrefix, mapId, deviceId);
}

void startPortal() {
  // Force portal mode even if config exists.
  configured = false;
  WiFi.disconnect();
  WiFi.mode(WIFI_AP);
  WiFi.softAP("ESP01TempSetup");
  portal.on("/", HTTP_GET, []() {
    portal.send(
      200,
      "text/html",
      "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'/>"
      "<title>ESP-01 Temp/Humi Setup</title>"
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
      "<h2>ESP-01 Temp/Humi Setup</h2>"
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
    saveCfg(ssid, pass, prefix);
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

bool sendBootStatusLog() {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  const String url = String(BASE_SERVER_URL) + "/api/iot/status";
  if (url.startsWith("https://")) {
    BearSSL::WiFiClientSecure client;
    client.setInsecure();
    http.begin(client, url);
  } else {
    WiFiClient client;
    http.begin(client, url);
  }
  http.addHeader("Content-Type", "application/json");
  String body = "{\"mapId\":\"" + mapId +
    "\",\"deviceId\":\"" + deviceId +
    "\",\"state\":true" +
    ",\"firmwareVersion\":\"" + firmwareVersion +
    "\",\"wifiSsid\":\"" + wifiSsid +
    "\",\"mqttTopicPrefix\":\"" + topicPrefix +
    "\",\"boardTarget\":\"esp01\"}";
  int code = http.POST(body);
  http.end();
  return code >= 200 && code < 300;
}

void performOta(const String& url, const String& ver) {
  ESPhttpUpdate.rebootOnUpdate(false);
  ESPhttpUpdate.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  mqttClient.publish((topicPrefix + "/ota/ack").c_str(), "{\"status\":\"flashing\"}", false);
  t_httpUpdate_return ret;
  if (url.startsWith("https://")) {
    BearSSL::WiFiClientSecure secureClient;
    secureClient.setInsecure();
    ret = ESPhttpUpdate.update(secureClient, url);
  } else {
    WiFiClient client;
    ret = ESPhttpUpdate.update(client, url);
  }
  if (ret == HTTP_UPDATE_OK) {
    if (ver.length() > 0) {
      firmwareVersion = ver;
      saveCfg(wifiSsid, wifiPassword, topicPrefix);
    }
    mqttClient.publish((topicPrefix + "/ota/ack").c_str(), "{\"status\":\"success\"}", false);
    delay(300);
    ESP.restart();
  } else {
    mqttClient.publish((topicPrefix + "/ota/ack").c_str(), "{\"status\":\"failed\"}", false);
  }
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
      String otaVer = parseJsonStringField(body, "version");
      mqttClient.publish((topicPrefix + "/ota/ack").c_str(), "{\"status\":\"downloading\"}", false);
      performOta(url, otaVer);
    }
  });
  while (!mqttClient.connected()) {
    String clientId = "esp01-temphumi-" + deviceId;
    if (mqttClient.connect(clientId.c_str())) {
      mqttClient.subscribe(otaTopic().c_str());
    } else delay(2000);
  }
}

void setup() {
  dht.begin();
  loadCfg();

  if (shouldEnterProvisioningByTripleReset()) {
    startPortal();
    return;
  }

  if (!configured) {
    startPortal();
    return;
  }
  connectWifi();
  registerComplete();
  connectMqtt();
  bootStatusSent = sendBootStatusLog();
}

void loop() {
  if (resetBootCountArmed && !resetBootCountCleared && millis() - resetBootCountArmMs >= 3000) {
    resetBootCountArmed = false;
    writeResetBootCount(0);
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

  if (millis() - lastPublishMs >= 5000) {
    lastPublishMs = millis();

    float humidity = dht.readHumidity();
    float temperature = dht.readTemperature();
    if (isnan(humidity) || isnan(temperature)) {
      return;
    }

    publishSensorStatus(temperature, humidity);
  }
}

void registerComplete() {
  HTTPClient http;
  const String url = String(BASE_SERVER_URL) + "/api/iot/register/complete";
  if (url.startsWith("https://")) {
    BearSSL::WiFiClientSecure client;
    client.setInsecure();
    http.begin(client, url);
  } else {
    WiFiClient client;
    http.begin(client, url);
  }
  http.addHeader("Content-Type", "application/json");
  String body = "{\"mapId\":\"" + mapId + "\",\"deviceId\":\"" + deviceId + "\",\"registrationToken\":\"" + String(BASE_REGISTRATION_TOKEN) +
    "\",\"boardTarget\":\"esp01\",\"wifiSsid\":\"" + wifiSsid + "\",\"mqttTopicPrefix\":\"" + topicPrefix +
    "\",\"firmwareVersion\":\"" + firmwareVersion + "\"}";
  int code = http.POST(body);
  if (code < 200 || code >= 300) {
    delay(500);
    code = http.POST(body);
  }
  http.end();
}
