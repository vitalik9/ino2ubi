#include <Arduino.h>

float In = 0.0f;                // in
float Out = 0.0f;               // out
uint8_t Level = 200;           // par
uint32_t Period = 1000UL;      // par
float Gain = 2.5f;             // par
bool Enable = true;            // par

void setup() {}
void loop() {
  if (Enable) {
    Out = In * Gain + Level;
  }
}
