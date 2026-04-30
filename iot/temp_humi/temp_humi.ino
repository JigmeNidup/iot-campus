#include <WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>

// --------- Hardcoded device configuration (temporary) ----------
static const char* DEVICE_TYPE = "temp_humidity";
static const char* WIFI_SSID = "YOUR_WIFI_SSID";
static const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
static const char* MQTT_BROKER = "broker.hivemq.com";
static const uint16_t MQTT_PORT = 1883;
static const char* MQTT_CLIENT_ID = "esp32-temp-humi-001";
static const char* MQTT_STATUS_TOPIC = "campus/demo-map/device/demo-temp-humi-001/status";

// Optional command topic (not required for sensor-only flow, kept for future use)
static const char* MQTT_CMD_TOPIC = "campus/demo-map/device/demo-temp-humi-001/command";

// --------- DHT11 wiring ----------
// DHT11 data pin connected to ESP32 GPIO 25 (as requested)
static const int DHT_PIN = 25;
static const int DHT_TYPE = DHT11;

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);
DHT dht(DHT_PIN, DHT_TYPE);

unsigned long lastPublishMs = 0;
static const unsigned long PUBLISH_INTERVAL_MS = 5000; // 5s

void publishSensorStatus(float temperature, float humidity) {
  char payload[128];
  snprintf(
    payload,
    sizeof(payload),
    "{\"type\":\"%s\",\"state\":true,\"temperature\":%.2f,\"humidity\":%.2f}",
    DEVICE_TYPE,
    temperature,
    humidity
  );
  mqttClient.publish(MQTT_STATUS_TOPIC, payload, false);

  Serial.print("[MQTT] Published: ");
  Serial.println(payload);
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  // Reserved for future command handling (e.g. calibration trigger)
  Serial.print("[MQTT] Command topic: ");
  Serial.print(topic);
  Serial.print(" payload: ");
  for (unsigned int i = 0; i < length; i++) {
    Serial.print((char)payload[i]);
  }
  Serial.println();
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("WiFi connected. IP: ");
  Serial.println(WiFi.localIP());
}

void connectMqtt() {
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);

  while (!mqttClient.connected()) {
    Serial.print("Connecting to MQTT broker...");
    if (mqttClient.connect(MQTT_CLIENT_ID)) {
      Serial.println("connected");
      mqttClient.subscribe(MQTT_CMD_TOPIC);
    } else {
      Serial.print("failed, rc=");
      Serial.print(mqttClient.state());
      Serial.println(" retrying in 2s");
      delay(2000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  dht.begin();

  connectWifi();
  connectMqtt();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
  }
  if (!mqttClient.connected()) {
    connectMqtt();
  }

  mqttClient.loop();

  if (millis() - lastPublishMs >= PUBLISH_INTERVAL_MS) {
    lastPublishMs = millis();

    float humidity = dht.readHumidity();
    float temperature = dht.readTemperature(); // Celsius

    if (isnan(humidity) || isnan(temperature)) {
      Serial.println("[DHT11] Failed to read sensor data");
      return;
    }

    Serial.print("[DHT11] Temp: ");
    Serial.print(temperature);
    Serial.print(" C, Humidity: ");
    Serial.print(humidity);
    Serial.println(" %");

    publishSensorStatus(temperature, humidity);
  }
}
