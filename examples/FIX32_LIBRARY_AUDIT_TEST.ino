// FIX32: diagnostic sample only; remove absent libraries before compilation.
#include <Arduino.h>
#include "flprogUtilites.h"
#include <flprogModbusRTU.h>
#include <flprogModbusRTU.h>
#include <RT_HW_TEST_NOT_INSTALLED.h>

float Input = 0.0f;  // in
float Output = 0.0f; // out

void setup() {}
void loop() { Output = Input * 2.0f; }
