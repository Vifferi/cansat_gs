#include <ESP32Servo.h>

#define SERVO_PIN 33
#define TRIGGER_MS  (3UL * 60 * 1000)  // 3 minutes
// #define TRIGGER_MS  (3UL * 1000)        // 3 seconds (test)
#define HOLD_MS     (3UL * 1000)        // 3 seconds

Servo servo;

enum State { WAITING, DEPLOYED, RETURNING };
State state = WAITING;
unsigned long triggerTime = 0;

void setup() {
  Serial.begin(115200);
  servo.attach(SERVO_PIN);
  servo.write(0);
  Serial.println("Servo at 0. Will move to 45 deg after 3 minutes.");
  triggerTime = millis();
}

void loop() {
  unsigned long now = millis();

  if (state == WAITING && now - triggerTime >= TRIGGER_MS) {
    servo.write(45);
    Serial.println("3 min elapsed -> moving to 45 degrees");
    triggerTime = now;
    state = DEPLOYED;
  }

  if (state == DEPLOYED && now - triggerTime >= HOLD_MS) {
    servo.write(0);
    Serial.println("3 sec elapsed -> returning to 0 degrees");
    state = RETURNING;
  }
}
