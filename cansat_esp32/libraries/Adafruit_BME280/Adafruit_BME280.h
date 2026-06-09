#ifndef ADAFRUIT_BME280_H
#define ADAFRUIT_BME280_H

#include <Arduino.h>

class Adafruit_BME280 {
public:
  Adafruit_BME280() {}
  bool begin(uint8_t addr = 0x77) {
    (void)addr;
    return false;
  }
  float readTemperature(void) { return 0.0f; }
  float readHumidity(void) { return 0.0f; }
  float readAltitude(float seaLevel = 1013.25f) { (void)seaLevel; return 0.0f; }
};

#endif // ADAFRUIT_BME280_H
