/* Тест Code Professional: выход Out равен входу In, умноженному на gain. */
#include <Arduino.h>
float In = 0;  // in
float Out = 0; // out
float gain = 2.0f; // par

float scaleValue(float value, float scale) {
  return value * scale;
}

void setup() {
}

void loop() {
  Out = scaleValue(In, gain);
}
