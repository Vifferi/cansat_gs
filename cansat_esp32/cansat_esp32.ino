/*
 * CanSat NAJA — ESP32 Firmware
 * ==============================
 * Hardware (จาก schematic):
 *   I2C  : BME280, ADXL345, QMC5883L, MAX17043, INA219  (SDA=21, SCL=22)
 *   UART2: FOXEER M10Q GPS                               (RX=16, TX=17)
 *   UART1: PMSA003 PM Sensor                             (RX=25, TX=26)
 *   SPI  : SD Card (CS=14), LoRa RFM95W (NSS=5, DIO0=12, RST=13)
 *   PWM  : Deployment Servo (IO15)
 *   DIO  : Buzzer (ผ่าน transistor 2N5904)
 *
 * Serial output (CSV) → server.py @ 115200 baud:
 *   team_id,time,packet_id,lat,lon,sat,temp,humidity,alt_baro,
 *   acc_x,acc_y,acc_z,heading,pm1_0,pm2_5,pm10,
 *   voltage,current,watt,battery_percent,status
 *
 * Libraries ที่ต้องติดตั้ง (Arduino Library Manager):
 *   - Adafruit BME280 Library
 *   - Adafruit ADXL345
 *   - QMC5883LCompass   (by mprograms)
 *   - SparkFun MAX1704x Fuel Gauge Arduino Library
 *   - Adafruit INA219
 *   - TinyGPSPlus
 *   - ESP32Servo
 *   - LoRa               (by Sandeep Mistry) — optional
 */

#include <Wire.h>
#include <SPI.h>
#include <SD.h>

#include <Adafruit_BME280.h>
#include <Adafruit_BMP280.h>
#include <Adafruit_ADXL345_U.h>
#include <QMC5883LCompass.h>
#include <SparkFun_MAX1704x_Fuel_Gauge_Arduino_Library.h>
#include <Adafruit_INA219.h>
#include <TinyGPSPlus.h>
#include <ESP32Servo.h>
#include <LoRa.h>

// ─── Pin Definitions ──────────────────────────────────────────────────────────
#define I2C_SDA         21
#define I2C_SCL         22

#define GPS_RX          16      // UART2 RX ← TX ของ GPS module
#define GPS_TX          17      // UART2 TX → RX ของ GPS module

#define PMS_RX          4       // UART1 RX ← TX ของ PMSA003
#define PMS_TX          2       // UART1 TX → RX ของ PMSA003

#define SD_CS_PIN       25
#define LORA_NSS_PIN    5
#define LORA_DIO0_PIN   12
#define LORA_RST_PIN    13

#define SERVO_PIN       33      // DEP-SER (deployment servo)
#define BUZZER_PIN      32      // ผ่าน transistor 2N5904

// ─── Flight Config ────────────────────────────────────────────────────────────
#define TEAM_ID             "14"
#define BAUD_USB            115200
#define SEND_INTERVAL_MS    1000        // ส่ง CSV ทุก 1 วินาที
#define SEA_LEVEL_HPA       1013.25f    // ปรับตามวันบิน (ดูจาก weather station)

// ─── LoRa Config (ทีม 14 — UNISEC Thailand 2026) ─────────────────────────────
#define LORA_FREQ_HZ        923.75E6    // Main Center Frequency
#define LORA_BW_HZ          125E3       // Main BW 125 kHz
#define LORA_SF             11          // Main SF

#define APOGEE_MIN_ALT_M    250.0f      // ต้องขึ้นไปอย่างน้อย 250m ก่อน detect apogee
#define LANDED_THRESH_M     2.0f        // ถ้าต่ำกว่า 2m และไม่ขยับ = ลงจอด

// Status bitmask — ตรงกับ server.py decode_status()
#define STATUS_ASCENDING    1
#define STATUS_APOGEE       2
#define STATUS_DEPLOYMENT   4
#define STATUS_DESCENDING   8
#define STATUS_LANDED       16

// ─── Objects ──────────────────────────────────────────────────────────────────
Adafruit_BME280     bme;
Adafruit_BMP280     bmp;
Adafruit_ADXL345_Unified adxl(12345);
QMC5883LCompass     compass;
SFE_MAX1704X        fuelGauge(MAX1704X_MAX17043);
//SFE_MAX1704X        fuelGauge(MAX17043);
Adafruit_INA219     ina219;
TinyGPSPlus         gps;
Servo               deployServo;

HardwareSerial gpsSerial(2);    // UART2
HardwareSerial pmsSerial(1);    // UART1

// ─── Sensor availability flags ────────────────────────────────────────────────
bool bme_ok     = false;
bool bmp_ok     = false;   // fallback: BMP280 (no humidity)
bool adxl_ok    = false;
bool compass_ok = false;
bool fuel_ok    = false;
bool ina_ok     = false;
bool sd_ok      = false;
bool lora_ok    = false;

// ─── Runtime state ────────────────────────────────────────────────────────────
uint32_t packet_id    = 0;
uint32_t start_ms     = 0;
uint32_t last_send    = 0;
uint32_t last_lora_ms = 0;

float    peak_alt   = 0.0f;
float    prev_alt   = 0.0f;
int      flight_status = STATUS_ASCENDING;
bool     deployed   = false;

// PM sensor buffer
uint8_t  pms_buf[32];
uint8_t  pms_idx = 0;
float    pm1_0 = -1, pm2_5 = -1, pm10 = -1;
bool     pms_ok     = false;
bool     pms_warned = false;

// SD write buffer — 20 rows per file
#define SD_FLUSH_EVERY  20
char     sd_buffer[SD_FLUSH_EVERY][180];
uint8_t  sd_buf_count = 0;
uint16_t sd_file_index = 0;     // ต่อจากไฟล์สุดท้ายที่มีอยู่ใน SD (scan ใน setup)

// Non-blocking beep state
struct { int dur; int rem; bool on; uint32_t next_ms; } bq = {0, 0, false, 0};

// Apogee hold timer
uint32_t apogee_enter_ms = 0;
#define  APOGEE_HOLD_MS  3000   // STATUS_APOGEE อยู่อย่างน้อย 3 วินาที

// Altitude smoother state (3-sample moving average)
#define  ALT_N  3
float    _alt_buf[ALT_N] = {0};
uint8_t  _alt_i  = 0;
bool     _alt_full = false;


// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

// บล็อก — ใช้ได้เฉพาะใน setup() ก่อน loop เริ่ม
void beepBlocking(int duration_ms, int times = 1) {
    for (int i = 0; i < times; i++) {
        digitalWrite(BUZZER_PIN, HIGH);
        delay(duration_ms);
        digitalWrite(BUZZER_PIN, LOW);
        if (times > 1) delay(100);
    }
}
// Non-blocking — ใช้ใน loop() และ state machine
void beepStart(int duration_ms, int times) {
    bq = {duration_ms, times, false, (uint32_t)millis()};
}
void beepTick() {
    if (!bq.rem) return;
    uint32_t now = millis();
    if (now < bq.next_ms) return;
    if (!bq.on) {
        digitalWrite(BUZZER_PIN, HIGH);
        bq.on = true;
        bq.next_ms = now + bq.dur;
    } else {
        digitalWrite(BUZZER_PIN, LOW);
        bq.on = false;
        bq.rem--;
        bq.next_ms = now + (bq.rem ? 100 : 0);
    }
}

// ─── Altitude smoother (3-sample moving average) ──────────────────────────────
float smoothAlt(float v) {
    _alt_buf[_alt_i] = v;
    _alt_i = (_alt_i + 1) % ALT_N;
    if (_alt_i == 0) _alt_full = true;
    int n = _alt_full ? ALT_N : _alt_i;
    float s = 0;
    for (int i = 0; i < n; i++) s += _alt_buf[i];
    return n > 0 ? s / n : v;
}

// ─── PMSA003 binary frame parser ─────────────────────────────────────────────
void parsePMS() {
    while (pmsSerial.available()) {
        uint8_t b = pmsSerial.read();

        if (pms_idx == 0 && b != 0x42) continue;
        if (pms_idx == 1 && b != 0x4D) { pms_idx = 0; continue; }

        pms_buf[pms_idx++] = b;

        if (pms_idx < 32) continue;
        pms_idx = 0;

        // Verify checksum
        uint16_t sum = 0;
        for (int i = 0; i < 30; i++) sum += pms_buf[i];
        uint16_t ck = ((uint16_t)pms_buf[30] << 8) | pms_buf[31];
        if (sum != ck) continue;

        // Atmospheric concentration (CF=ATM, bytes 10-15)
        pm1_0  = ((uint16_t)pms_buf[10] << 8) | pms_buf[11];
        pm2_5  = ((uint16_t)pms_buf[12] << 8) | pms_buf[13];
        pm10   = ((uint16_t)pms_buf[14] << 8) | pms_buf[15];
        pms_ok = true;
    }
}

// ─── Flight status state machine ─────────────────────────────────────────────
int updateFlightStatus(float alt, float acc_y) {
    float dAlt = alt - prev_alt;

    if (flight_status == STATUS_LANDED) return STATUS_LANDED;

    if (alt > peak_alt) peak_alt = alt;

    switch (flight_status) {
        case STATUS_ASCENDING:
            if (peak_alt > APOGEE_MIN_ALT_M && (peak_alt - alt) >= 2.0f && acc_y < 500.0f) {
                deployServo.write(90);
                deployed = true;
                beepStart(200, 3);
                flight_status = STATUS_APOGEE;
            }
            break;

        case STATUS_APOGEE:
            if (!apogee_enter_ms) apogee_enter_ms = millis();
            if (millis() - apogee_enter_ms >= APOGEE_HOLD_MS) {
                apogee_enter_ms = 0;
                flight_status = STATUS_DEPLOYMENT;
            }
            break;

        case STATUS_DEPLOYMENT:
            if (dAlt < -0.5f) flight_status = STATUS_DESCENDING;
            break;

        case STATUS_DESCENDING:
            if (alt <= LANDED_THRESH_M && fabsf(dAlt) < 0.15f) {
                flight_status = STATUS_LANDED;
                beepStart(1000, 5);
            }
            break;
    }

    return flight_status;
}

// ─── Flush buffer → ไฟล์ใหม่ 1 ไฟล์ต่อ 20 แถว ────────────────────────────────
void sdFlush() {
    if (!sd_ok || sd_buf_count == 0) return;
    sd_file_index++;
    char fname[24];
    snprintf(fname, sizeof(fname), "/log_%03u.csv", sd_file_index);
    File f = SD.open(fname, FILE_WRITE);
    if (!f) { sd_buf_count = 0; return; }
    f.println("team_id,wall_clock,time,packet_id,lat,lon,sat,temp,humidity,alt_baro,"
              "acc_x,acc_y,acc_z,heading,pm1_0,pm2_5,pm10,"
              "voltage,current,watt,battery_percent,status");
    for (uint8_t i = 0; i < sd_buf_count; i++) {
        f.println(sd_buffer[i]);
    }
    f.close();
    sd_buf_count = 0;
}

// ─── Buffer one CSV row; flush (= new file) every SD_FLUSH_EVERY rows ─────────
void sdWrite(const char* line) {
    if (!sd_ok) return;
    strncpy(sd_buffer[sd_buf_count], line, sizeof(sd_buffer[0]) - 1);
    sd_buffer[sd_buf_count][sizeof(sd_buffer[0]) - 1] = '\0';
    sd_buf_count++;
    if (sd_buf_count >= SD_FLUSH_EVERY) sdFlush();
}


// ═══════════════════════════════════════════════════════════════════════════════
// Setup
// ═══════════════════════════════════════════════════════════════════════════════

void setup() {
    Serial.begin(BAUD_USB);
    delay(300);

    pinMode(BUZZER_PIN, OUTPUT);
    digitalWrite(BUZZER_PIN, LOW);

    // I2C
    Wire.begin(I2C_SDA, I2C_SCL);
    delay(100);

    // I2C Scanner — พิมพ์ address ทุกตัวที่ตอบสนองบน bus
    Serial.print("# I2C scan: ");
    bool anyFound = false;
    for (uint8_t addr = 1; addr < 127; addr++) {
        Wire.beginTransmission(addr);
        if (Wire.endTransmission() == 0) {
            Serial.printf("0x%02X ", addr);
            anyFound = true;
        }
    }
    if (!anyFound) Serial.print("(none)");
    Serial.println();

    // BME280 (try 0x76 then 0x77) — fallback to BMP280 (same address, no humidity)
    bme_ok = bme.begin(0x76) || bme.begin(0x77);
    if (!bme_ok) {
        bmp_ok = bmp.begin(0x76) || bmp.begin(0x77);
        if (bmp_ok) Serial.println("# [INFO] BMP280 found (no humidity)");
        else        Serial.println("# [WARN] BME/BMP280 not found");
    }

    // ADXL345
    adxl_ok = adxl.begin();
    if (adxl_ok) {
        adxl.setRange(ADXL345_RANGE_16_G);
    } else {
        Serial.println("# [WARN] ADXL345 not found");
    }

    // QMC5883L compass — probe I2C address 0x0D before init
    Wire.beginTransmission(0x0D);
    compass_ok = (Wire.endTransmission() == 0);
    if (compass_ok) {
        compass.init();
    } else {
        Serial.println("# [WARN] QMC5883L not found");
    }

    // MAX17043 fuel gauge
    fuel_ok = fuelGauge.begin();
    if (fuel_ok) {
        fuelGauge.quickStart();
        fuelGauge.setThreshold(20);     // alert เมื่อ battery < 20%
    } else {
        Serial.println("# [WARN] MAX17043 not found");
    }

    // INA219 current sensor
    ina_ok = ina219.begin();
    if (!ina_ok) Serial.println("# [WARN] INA219 not found");

    // GPS
    gpsSerial.begin(115200, SERIAL_8N1, GPS_RX, GPS_TX);

    // PMSA003
    pmsSerial.begin(9600, SERIAL_8N1, PMS_RX, PMS_TX);

    // Deployment servo (เริ่มต้นในตำแหน่งปิด = 0°)
    deployServo.attach(SERVO_PIN);
    deployServo.write(0);

    // SD Card
    sd_ok = SD.begin(SD_CS_PIN);
    if (!sd_ok) {
        Serial.println("# [WARN] SD card failed");
    } else {
        // หาไฟล์สุดท้ายที่มีอยู่แล้ว → ต่อ index เพื่อไม่ overwrite
        for (uint16_t i = 1; i <= 9999; i++) {
            char fname[24];
            snprintf(fname, sizeof(fname), "/log_%03u.csv", i);
            if (!SD.exists(fname)) { sd_file_index = i - 1; break; }
            if (i == 9999) sd_file_index = 9999;
        }
        Serial.printf("# SD ready — next file: log_%03u.csv\n", sd_file_index + 1);
    }

    // LoRa RFM95W — ทีม 14: 923.75 MHz, BW 125 kHz, SF 11
    LoRa.setPins(LORA_NSS_PIN, LORA_RST_PIN, LORA_DIO0_PIN);
    lora_ok = LoRa.begin(LORA_FREQ_HZ);
    if (lora_ok) {
        LoRa.setSignalBandwidth(LORA_BW_HZ);
        LoRa.setSpreadingFactor(LORA_SF);
    } else {
        Serial.println("# [WARN] LoRa not found");
    }

    start_ms = millis();
    beepBlocking(100, 2);
    Serial.println("# CanSat NAJA ready");
}


// ═══════════════════════════════════════════════════════════════════════════════
// Main Loop
// ═══════════════════════════════════════════════════════════════════════════════

void loop() {
    while (gpsSerial.available()) gps.encode(gpsSerial.read());
    parsePMS();
    beepTick();     // non-blocking beep — ต้องเรียกทุก iteration

    if (millis() - last_send < SEND_INTERVAL_MS) return;
    last_send = millis();

    // PMSA003 warning — warn once after 5s if still no valid frame
    if (!pms_ok && !pms_warned && millis() - start_ms > 5000) {
        Serial.println("# [WARN] PMSA003 not found");
        pms_warned = true;
    }

    // ── BME280 / BMP280 ───────────────────────────────────────────────────────
    float temp     = bme_ok ? bme.readTemperature()            : (bmp_ok ? bmp.readTemperature()  : -999.0f);
    float humidity = bme_ok ? bme.readHumidity()               : 0.0f;   // BMP280 ไม่มี humidity
    float alt_baro = bme_ok ? bme.readAltitude(SEA_LEVEL_HPA) : (bmp_ok ? bmp.readAltitude(SEA_LEVEL_HPA) : 0.0f);

    // ── ADXL345 ───────────────────────────────────────────────────────────────
    float acc_x = 0.0f, acc_y = 0.0f, acc_z = 0.0f;
    if (adxl_ok) {
        sensors_event_t evt;
        adxl.getEvent(&evt);
        // แปลง m/s² → mg  (1g = 9.80665 m/s²)
        const float G = 9.80665f;
        acc_x = evt.acceleration.x / G * 1000.0f;
        acc_y = evt.acceleration.y / G * 1000.0f;
        acc_z = evt.acceleration.z / G * 1000.0f;
    }

    // ── QMC5883L ──────────────────────────────────────────────────────────────
    float heading = 0.0f;
    if (compass_ok) {
        compass.read();
        heading = (float)compass.getAzimuth();
    }

    // ── MAX17043 ──────────────────────────────────────────────────────────────
    float bat_pct = fuel_ok ? (float)fuelGauge.getSOC() : -1.0f;

    // ── INA219 ────────────────────────────────────────────────────────────────
    float voltage = ina_ok ? ina219.getBusVoltage_V()  : -1.0f;
    float current = ina_ok ? ina219.getCurrent_mA()    : -1.0f;
    float watt    = ina_ok ? voltage * current / 1000.0f : -1.0f;

    // ── GPS ───────────────────────────────────────────────────────────────────
    double lat = gps.location.isValid() ? gps.location.lat()      : -1.0;
    double lon = gps.location.isValid() ? gps.location.lng()      : -1.0;
    int    sat = gps.satellites.isValid() ? (int)gps.satellites.value() : 0;

    // ── Time & packet ─────────────────────────────────────────────────────────
    float t = (millis() - start_ms) / 1000.0f;
    packet_id++;

    // ── Flight status (ใช้ alt smoothed เพื่อลด noise ก่อน detect) ──────────
    float alt_smooth = smoothAlt(alt_baro);
    int status = updateFlightStatus(alt_smooth, acc_y);
    prev_alt   = alt_smooth;

    // ── Get GPS wall-clock time (HH:MM:SS) ────────────────────────────────────
    char wall_clock[10] = "--:--:--";
    if (gps.time.isValid() && gps.time.age() < 2000) {
        snprintf(wall_clock, sizeof(wall_clock), "%02d:%02d:%02d",
                 gps.time.hour(), gps.time.minute(), gps.time.second());
    }

    // ── Build CSV line for Serial → server.py (21 fields, no wall_clock) ─────
    char line[160];
    snprintf(line, sizeof(line),
        "%s,%.1f,%lu,%.7f,%.7f,%d,"
        "%.2f,%.2f,%.1f,"
        "%.1f,%.1f,%.1f,%.1f,"
        "%.1f,%.1f,%.1f,"
        "%.2f,%.1f,%.3f,%.1f,%d",
        TEAM_ID, t, packet_id,
        lat, lon, sat,
        temp, humidity, alt_baro,
        acc_x, acc_y, acc_z, heading,
        pm1_0, pm2_5, pm10,
        voltage, current, watt, bat_pct,
        status
    );

    // ── Build SD line (22 fields — เพิ่ม wall_clock หลัง team_id) ────────────
    char sd_line[180];
    snprintf(sd_line, sizeof(sd_line),
        "%s,%s,%.1f,%lu,%.7f,%.7f,%d,"
        "%.2f,%.2f,%.1f,"
        "%.1f,%.1f,%.1f,%.1f,"
        "%.1f,%.1f,%.1f,"
        "%.2f,%.1f,%.3f,%.1f,%d",
        TEAM_ID, wall_clock, t, packet_id,
        lat, lon, sat,
        temp, humidity, alt_baro,
        acc_x, acc_y, acc_z, heading,
        pm1_0, pm2_5, pm10,
        voltage, current, watt, bat_pct,
        status
    );

    // ── Output ────────────────────────────────────────────────────────────────
    Serial.println(line);    // → server.py via USB (21 fields)
    sdWrite(sd_line);        // → SD card (22 fields with wall_clock)

    // SF11 BW125 ToA ~2s — throttle to prevent packets merging in FIFO (min 2200ms)
    if (lora_ok && (millis() - last_lora_ms >= 2200)) {
        LoRa.beginPacket();
        LoRa.print(line);
        LoRa.endPacket(true);
        last_lora_ms = millis();
    }
}
