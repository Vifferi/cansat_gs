/*
 * CanSat NAJA — Ground Station ESP32 Firmware
 * =============================================
 * รับ CSV packet จาก CanSat ผ่าน LoRa RFM95W
 * แล้วส่งต่อผ่าน Serial USB → server.py
 *
 * Wiring:
 *   LoRa NSS   → D5
 *   LoRa RST   → D14
 *   LoRa DIO0  → D2
 *   LoRa SCK   → D18  (VSPI)
 *   LoRa MOSI  → D23  (VSPI)
 *   LoRa MISO  → D19  (VSPI)
 *   LoRa 3.3V  → 3V3
 *   LoRa GND   → GND
 *
 * Library:
 *   - LoRa (by Sandeep Mistry)
 */

#include <SPI.h>
#include <LoRa.h>

// ─── Pin Definitions ──────────────────────────────────────────────────────────
#define LORA_NSS_PIN    5
#define LORA_RST_PIN    14
#define LORA_DIO0_PIN   2

// ─── LoRa Config (ทีม 14 — UNISEC Thailand 2026) ─────────────────────────────
#define LORA_FREQ_HZ    923.75E6    // Main Center Frequency
#define LORA_BW_HZ      125E3       // Main BW 125 kHz
#define LORA_SF         11          // Main SF

#define BAUD_USB        115200


// ═══════════════════════════════════════════════════════════════════════════════
// Setup
// ═══════════════════════════════════════════════════════════════════════════════

void setup() {
    Serial.begin(BAUD_USB);
    delay(300);

    LoRa.setPins(LORA_NSS_PIN, LORA_RST_PIN, LORA_DIO0_PIN);
    if (!LoRa.begin(LORA_FREQ_HZ)) {
        Serial.println("# [ERROR] LoRa init failed — check wiring");
        while (true);
    }
    LoRa.setSignalBandwidth(LORA_BW_HZ);
    LoRa.setSpreadingFactor(LORA_SF);

    Serial.println("# GS LoRa ready — 923.75 MHz SF11 BW125");
}


// ═══════════════════════════════════════════════════════════════════════════════
// Main Loop
// ═══════════════════════════════════════════════════════════════════════════════

void loop() {
    int packetSize = LoRa.parsePacket();
    if (packetSize == 0) return;

    String packet = "";
    while (LoRa.available()) {
        packet += (char)LoRa.read();
    }
    packet.trim();
    if (packet.length() == 0) return;

    // Forward CSV to server.py (same format as direct USB from CanSat)
    Serial.println(packet);
}
