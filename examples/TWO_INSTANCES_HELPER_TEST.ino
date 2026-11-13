#include <Arduino.h>

float In = 0.0f;     // in
bool Reset = false;  // in
float Out = 0.0f;    // out
float accumulator = 0.0f;
unsigned long counter = 0;

float accumulate(float value) {
  accumulator += value;
  counter++;
  return accumulator;
}

void clearState() {
  accumulator = 0.0f;
  counter = 0;
}

void setup() {
  clearState();
}

void loop() {
  if (Reset) {
    clearState();
  } else {
    Out = accumulate(In);
  }
}
