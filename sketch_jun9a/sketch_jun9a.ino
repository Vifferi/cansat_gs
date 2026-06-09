#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>

#define SEALEVELPRESSURE_HPA (1013.25)  

Adafruit_BME280 bme;  

void setup() {
  Serial.begin(9600);
  while(!Serial);    

  Serial.println(F("BME280 test"));
  if (!bme.begin(0x76)) {  
    Serial.println("Could not find a valid BME280 sensor");
    while (1);  
  }
  Serial.println("-- Sensor Ready --");
  Serial.println();
}

void loop() {
  printValues();
  delay(2000);  
}

void printValues() {
  Serial.print("Temperature = ");
  Serial.print(bme.readTemperature());
  Serial.println(" *C");
  Serial.print("Pressure = ");
 // Serial.print(bme.readPressure() / 100.0F); // แปลงหน่วยเป็น hPa
  Serial.println(" hPa");
  Serial.print("Approx. Altitude = ");
  Serial.print(bme.readAltitude(SEALEVELPRESSURE_HPA));
  Serial.println(" m");
  Serial.print("Humidity = ");
  Serial.print(bme.readHumidity());
  Serial.println(" %");
  Serial.println("------------------------------------");
}